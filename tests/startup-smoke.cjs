const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const work = path.join(__dirname, 'tmp', 'startup-smoke');
const profile = path.join(work, 'data');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let application;
let display;
const pageErrors = [];

async function until(test, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await test()) return;
    await pause(75);
  }
  throw new Error(message);
}
async function session() { return JSON.parse(await fs.readFile(path.join(profile, 'session.json'), 'utf8')); }
async function seed(state) {
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'session.json'), JSON.stringify(state));
}
async function launch({ files = [], responses = [] } = {}) {
  application = await _electron.launch({
    executablePath: require('electron'),
    args: [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), path.join(__dirname, 'startup-harness.cjs'), ...files],
    env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: profile, PICOMARQ_STARTUP_TEST_RESPONSES: JSON.stringify(responses) },
    timeout: 20000,
  });
  const watch = page => page.on('pageerror', error => pageErrors.push(String(error)));
  application.windows().forEach(watch);
  application.on('window', watch);
  await application.firstWindow();
}
async function documents(expected) {
  let result;
  await until(async () => {
    result = [];
    for (const page of application.windows()) {
      if (page.isClosed()) continue;
      try {
        if (!await page.locator('[data-document-id]').count()) continue;
        const state = await page.evaluate(() => window.desktop.invoke('get_session'));
        result.push({ page, document: state.documents[0] });
      } catch {}
    }
    return result.length === expected;
  }, `Expected ${expected} initialized document windows`);
  return result;
}
async function dispatch(page, action) {
  const window = await application.browserWindow(page);
  await window.evaluate((win, action) => win.webContents.send('scratch:command', { action }), action);
}
async function quit() {
  const closed = application.waitForEvent('close', { timeout: 20000 });
  await application.evaluate(({ app }) => app.quit());
  await closed;
  application = null;
}
async function crash() {
  const closed = application.waitForEvent('close');
  await application.evaluate(({ app }) => app.exit(0));
  await closed;
  application = null;
}
async function errors() {
  assert.deepEqual(await application.evaluate(() => global.startupErrors), []);
  assert.deepEqual(pageErrors, []);
}

async function main() {
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(profile, { recursive: true });
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const number = process.env.SCRATCH_DISPLAY_NUMBER || '124';
    display = spawn(process.env.SCRATCH_XVFB || 'Xvfb', [':' + number, '-screen', '0', '1440x1000x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + number;
    await pause(500);
  }
  const alpha = path.join(work, 'Alpha.md');
  const beta = path.join(work, 'Beta.md');
  const requested = path.join(work, 'Requested.md');
  await fs.writeFile(alpha, 'Alpha saved text');
  await fs.writeFile(beta, 'Beta saved text');
  await fs.writeFile(requested, 'Requested file text');
  const savedDocuments = [alpha, beta].map((file, index) => ({
    id: ['alpha', 'beta'][index], path: file, content: ['Alpha saved text', 'Beta saved text'][index], diskContent: ['Alpha saved text', 'Beta saved text'][index],
    view: { sourceMode: true, sourceSelection: { start: 2, end: 5 } },
  }));
  const original = { version: 1, settings: { theme: { mode: 'dark' }, editorFont: { baseFontSize: 18 }, interfaceZoom: 1.2 }, documents: savedDocuments, activeDocumentId: 'alpha', settingsOpen: false, window: { x: 15, y: 25, width: 850, height: 650 }, recentFiles: [beta, alpha] };
  await seed(original);
  await launch();
  let windows = await documents(2);
  const alphaWindow = windows.find(entry => entry.document.id === 'alpha');
  assert.equal(await alphaWindow.page.getByRole('textbox', { name: 'Markdown source' }).inputValue(), 'Alpha saved text');
  assert.deepEqual(await application.evaluate(() => global.startupPrompts), []);
  await dispatch(alphaWindow.page, 'settings');
  const startup = alphaWindow.page.getByLabel('When PicoMarQ starts', { exact: true });
  await startup.waitFor();
  assert.equal(await startup.inputValue(), 'restore');
  assert.deepEqual(await startup.locator('option').allTextContents(), ['Restore previous session', 'Start new session']);
  assert.equal(await startup.evaluate(el => el.closest('section').querySelector('h2').textContent), 'Startup');
  await startup.selectOption('new');
  await until(async () => (await session()).settings.startupBehavior === 'new', 'Startup preference was not saved');
  assert.equal((await documents(2)).length, 2, 'Changing startup preference closed the current session');
  await alphaWindow.page.screenshot({ path: path.join(work, 'settings.png') });
  const betaWindow = windows.find(entry => entry.document.id === 'beta');
  await dispatch(betaWindow.page, 'settings');
  assert.equal(await betaWindow.page.getByLabel('When PicoMarQ starts', { exact: true }).inputValue(), 'new');
  for (const entry of windows) await entry.page.getByRole('button', { name: 'Back to document', exact: true }).click();
  await errors();
  await quit();
  assert.equal((await session()).documents.length, 2);
  console.log('PASS: old profiles default to Restore, Startup selector persists and synchronizes, current session stays open');

  await launch();
  windows = await documents(1);
  assert.equal(windows[0].document.path, null);
  assert.equal(windows[0].document.content, '');
  assert.deepEqual(await application.evaluate(() => global.startupPrompts), []);
  const freshState = await session();
  assert.equal(freshState.documents.length, 1);
  assert.deepEqual(freshState.recentFiles, [beta, alpha]);
  assert.deepEqual(freshState.settings.editorFont, original.settings.editorFont);
  assert.equal(freshState.settings.theme.mode, 'dark');
  assert.equal(freshState.settings.interfaceZoom, 1.2);
  assert.equal(await fs.readFile(alpha, 'utf8'), 'Alpha saved text');
  assert.equal(await fs.readFile(beta, 'utf8'), 'Beta saved text');
  await errors();
  await quit();
  console.log('PASS: Start new session opens exactly one blank document and retains saved files, appearance, and recent files');

  // An initial file-association launch must open its requested file instead of
  // creating a blank window or restoring the last saved documents.
  await seed({ ...original, settings: { ...original.settings, startupBehavior: 'new' } });
  await launch({ files: [requested] });
  windows = await documents(1);
  assert.equal(windows[0].document.path, requested);
  assert.equal(windows[0].document.content, 'Requested file text');
  await errors();
  await quit();
  console.log('PASS: file-association startup honors the requested file under Start new session');

  // Create real recovery snapshots, terminate the app, then accept recovery.
  await seed({ ...original, settings: { ...original.settings, startupBehavior: 'new' } });
  await launch({ files: [alpha] });
  windows = await documents(1);
  await dispatch(windows[0].page, 'source');
  const source = windows[0].page.getByRole('textbox', { name: 'Markdown source' });
  await source.waitFor();
  await source.fill('Alpha unsaved recovery text');
  await dispatch(windows[0].page, 'new');
  windows = await documents(2);
  const untitled = windows.find(entry => !entry.document.path);
  await untitled.page.locator('.tiptap').fill('Untitled recovery text');
  await until(async () => (await session()).documents.some(doc => doc.content.includes('Untitled recovery text')) && (await session()).documents.some(doc => doc.content === 'Alpha unsaved recovery text'), 'Recovery drafts did not persist');
  await crash();
  const crashedState = await session();
  await launch({ responses: [0] });
  windows = await documents(2);
  const recoveredAlpha = windows.find(entry => entry.document.path === alpha);
  assert.equal(await recoveredAlpha.page.getByRole('textbox', { name: 'Markdown source' }).inputValue(), 'Alpha unsaved recovery text');
  assert((await windows.find(entry => !entry.document.path).page.locator('.tiptap').innerText()).includes('Untitled recovery text'));
  const prompts = await application.evaluate(() => global.startupPrompts);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].title, 'Recover Unsaved Work');
  assert.deepEqual(prompts[0].buttons, ['Restore Session', 'Start New Session']);
  assert.equal(prompts[0].defaultId, 0);
  assert.equal(prompts[0].cancelId, 0);
  assert(prompts[0].detail.includes('discards those recovered edits'));
  assert.equal((await session()).settings.startupBehavior, 'new', 'One-time recovery changed the saved startup preference');
  assert.equal(await fs.readFile(alpha, 'utf8'), 'Alpha saved text');
  await errors();
  await quit();
  console.log('PASS: interrupted named and untitled drafts prompt for recovery in New mode, restore safely, and retain the startup preference');

  // Explicitly choosing New acknowledges discarding recovered edits.
  await seed(crashedState);
  await launch({ responses: [1] });
  windows = await documents(1);
  assert.equal(windows[0].document.path, null);
  assert.equal(windows[0].document.content, '');
  assert.equal((await session()).documents.length, 1);
  assert.equal(await fs.readFile(alpha, 'utf8'), 'Alpha saved text');
  await errors();
  await quit();
  console.log('PASS: explicit Start New Session after recovery prompt discards only recovered edits');

  // The recovery decision also respects a file supplied by the shell.
  await seed(crashedState);
  await launch({ responses: [1], files: [requested] });
  windows = await documents(1);
  assert.equal(windows[0].document.path, requested);
  await quit();
  await seed(crashedState);
  await launch({ responses: [0], files: [requested] });
  windows = await documents(3);
  assert(windows.some(entry => entry.document.path === requested));
  assert(windows.some(entry => entry.document.content === 'Alpha unsaved recovery text'));
  await errors();
  await quit();
  console.log('PASS: requested files open after either recovery choice without an extra blank window');

  await seed({ ...crashedState, settings: { ...crashedState.settings, startupBehavior: 'restore' } });
  await launch();
  windows = await documents(2);
  assert.equal(await application.evaluate(() => global.startupPrompts.length), 0);
  assert(windows.some(entry => entry.document.content === 'Alpha unsaved recovery text'));
  const page = windows[0].page;
  await dispatch(page, 'settings');
  await page.getByLabel('When PicoMarQ starts', { exact: true }).selectOption('new');
  await page.getByLabel('When PicoMarQ starts', { exact: true }).selectOption('restore');
  await until(async () => (await session()).settings.startupBehavior === 'restore', 'Switching back to Restore did not persist');
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  await errors();
  await quit();
  console.log('PASS: Restore retains existing automatic draft recovery, and the preference can be switched back');
  console.log('ALL STARTUP CHECKS PASSED');
}
main().catch(async error => {
  console.error(error);
  if (application) console.error(await application.evaluate(() => ({ prompts: global.startupPrompts, errors: global.startupErrors })));
  process.exitCode = 1;
}).finally(async () => {
  if (application) try { await application.evaluate(({ app }) => app.exit(1)); } catch {}
  display?.kill();
});
