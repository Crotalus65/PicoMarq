const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const work = path.join(__dirname, 'tmp', 'close-restore');
const profile = path.join(work, 'data');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let application;
let display;
let completed = false;
const errors = [];
const watchdog = setTimeout(() => { console.error('Close/restore checks timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!completed) process.exitCode = 1; });
async function until(check, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await pause(50); }
  throw new Error(message);
}
async function session() { return JSON.parse(await fs.readFile(path.join(profile, 'session.json'), 'utf8')); }
async function seed(documents, startupBehavior = 'restore') {
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'session.json'), JSON.stringify({ version: 1, settings: { theme: { mode: 'light' }, startupBehavior }, documents, activeDocumentId: documents[0]?.id ?? null, settingsOpen: false, recentFiles: documents.flatMap(doc => doc.path ? [doc.path] : []) }));
}
async function launch(files = []) {
  application = await _electron.launch({ executablePath: require('electron'), args: [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), path.join(__dirname, 'startup-harness.cjs'), ...files], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: profile }, timeout: 20000 });
  const watch = page => page.on('pageerror', error => errors.push(String(error)));
  application.windows().forEach(watch); application.on('window', watch);
  return application.firstWindow();
}
async function pages(count) {
  let result;
  await until(async () => {
    result = [];
    for (const page of application.windows()) {
      if (page.isClosed()) continue;
      try {
        if (!await page.locator('[data-document-id]').count()) continue;
        result.push({ page, doc: (await page.evaluate(() => window.desktop.invoke('get_session'))).documents[0] });
      } catch {}
    }
    return result.length === count;
  }, `Expected ${count} initialized windows`);
  return result;
}
async function close(page, shortcut = false) {
  const win = await application.browserWindow(page);
  await win.evaluate((window, shortcut) => {
    if (!shortcut) { window.close(); return; }
    window.focus(); window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'w', modifiers: ['control'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'w', modifiers: ['control'] });
  }, shortcut);
}
async function closeLast(page, shortcut = false) {
  const closed = application.waitForEvent('close', { timeout: 20000 });
  await close(page, shortcut);
  await closed;
  application = null;
}
async function source(page) {
  const field = page.getByRole('textbox', { name: 'Markdown source' });
  if (!await field.isVisible()) await (await application.browserWindow(page)).evaluate(win => win.webContents.send('scratch:command', { action: 'source' }));
  await field.waitFor();
  return field;
}
async function responses(values) { await application.evaluate((_electron, values) => { global.startupResponses = values; }, values); }
async function assertNoErrors() {
  assert.deepEqual(errors, []);
  assert.deepEqual(await application.evaluate(() => global.startupErrors), []);
}
async function main() {
  await fs.mkdir(profile, { recursive: true });
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const number = process.env.SCRATCH_DISPLAY_NUMBER || '14740';
    display = spawn(process.env.SCRATCH_XVFB || 'Xvfb', [':' + number, '-screen', '0', '1440x1000x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + number;
    await pause(500);
  }
  const alpha = path.join(work, 'Alpha.md');
  const beta = path.join(work, 'Beta.md');
  const saved = path.join(work, 'Saved untitled.md');
  await fs.writeFile(alpha, 'Alpha saved text');
  await fs.writeFile(beta, 'Beta saved text');
  const doc = (file, id) => ({ id, path: file, content: file === alpha ? 'Alpha saved text' : 'Beta saved text', diskContent: file === alpha ? 'Alpha saved text' : 'Beta saved text', view: { sourceMode: true } });

  // The user's two-document sequence, in both close orders.
  for (const [first, last] of [[alpha, beta], [beta, alpha]]) {
    await seed([doc(alpha, 'alpha'), doc(beta, 'beta')]);
    await launch();
    let windows = await pages(2);
    await close(windows.find(entry => entry.doc.path === first).page);
    windows = await pages(1);
    assert.equal(windows[0].doc.path, last);
    await closeLast(windows[0].page);
    assert.deepEqual((await session()).documents.map(doc => doc.path), [last], 'Closing the final document erased the session');
    await launch();
    windows = await pages(1);
    assert.equal(windows[0].doc.path, last, 'The final document was not restored');
    assert.equal(await (await source(windows[0].page)).inputValue(), last === alpha ? 'Alpha saved text' : 'Beta saved text');
    await assertNoErrors();
    await closeLast(windows[0].page);
  }
  console.log('PASS: two documents, close either one first, close the final window, relaunch restores the remaining document');

  // A cold file-association launch closed before waiting for editor readiness.
  await seed([]);
  const immediate = await launch([alpha]);
  await closeLast(immediate);
  assert.deepEqual((await session()).documents.map(doc => doc.path), [alpha]);
  await launch();
  let windows = await pages(1);
  assert.equal(windows[0].doc.path, alpha);
  await closeLast(windows[0].page);
  console.log('PASS: immediate title-bar close after a file launch preserves the final document');

  // Rapid close requests must be serialized so one of them is the final exit.
  await seed([doc(alpha, 'alpha'), doc(beta, 'beta')]);
  await launch();
  windows = await pages(2);
  const ids = [];
  for (const file of [alpha, beta]) ids.push(await (await application.browserWindow(windows.find(entry => entry.doc.path === file).page)).evaluate(win => win.id));
  const ended = application.waitForEvent('close', { timeout: 20000 });
  await application.evaluate(({ BrowserWindow }, ids) => { for (const id of ids) BrowserWindow.fromId(id).close(); }, ids);
  await ended; application = null;
  assert.deepEqual((await session()).documents.map(doc => doc.path), [beta]);
  await launch(); windows = await pages(1);
  assert.equal(windows[0].doc.path, beta);
  await closeLast(windows[0].page);
  console.log('PASS: simultaneous window-close requests retain the final document');

  // The first restored window can be closed before the second has loaded.
  await seed([doc(alpha, 'alpha'), doc(beta, 'beta')]);
  const early = await launch();
  const earlyClosed = early.waitForEvent('close');
  await close(early); await earlyClosed;
  windows = await pages(1);
  assert.equal(windows[0].doc.path, beta);
  await closeLast(windows[0].page);
  assert.deepEqual((await session()).documents.map(doc => doc.path), [beta]);
  await launch(); windows = await pages(1);
  assert.equal(windows[0].doc.path, beta);
  await closeLast(windows[0].page);

  // Application Exit during startup must also wait for the complete workspace.
  await seed([doc(alpha, 'alpha'), doc(beta, 'beta')]);
  await launch();
  const earlyQuit = application.waitForEvent('close', { timeout: 20000 });
  await application.evaluate(({ app }) => app.quit());
  await earlyQuit; application = null;
  assert.deepEqual((await session()).documents.map(doc => doc.path), [alpha, beta]);
  await launch(); windows = await pages(2);
  await close(windows.find(entry => entry.doc.path === alpha).page);
  windows = await pages(1); await closeLast(windows[0].page);
  console.log('PASS: closing a window or exiting during startup waits for the entire restored workspace');

  // Cancel and immediate Save on the final named document.
  await seed([doc(alpha, 'alpha')]);
  await launch(); windows = await pages(1);
  let field = await source(windows[0].page);
  await field.fill('Final text captured without waiting for the recovery timer');
  await responses([2]);
  await close(windows[0].page);
  await until(async () => !(await windows[0].page.locator('[aria-busy="true"]').count()) && await application.evaluate(() => global.startupPrompts.length === 1), 'Cancel did not leave the last window open');
  assert.equal(await field.inputValue(), 'Final text captured without waiting for the recovery timer');
  await responses([0]);
  await closeLast(windows[0].page);
  assert.equal(await fs.readFile(alpha, 'utf8'), 'Final text captured without waiting for the recovery timer');
  await launch(); windows = await pages(1);
  field = await source(windows[0].page);
  assert.equal(await field.inputValue(), 'Final text captured without waiting for the recovery timer');
  await field.fill('Discard this last-window edit');
  await responses([1]);
  await closeLast(windows[0].page);
  await launch(); windows = await pages(1);
  assert.equal(await (await source(windows[0].page)).inputValue(), 'Final text captured without waiting for the recovery timer');
  await assertNoErrors(); await closeLast(windows[0].page);
  console.log('PASS: last-window Cancel, immediate Save, and Discard preserve the appropriate document and text');

  // Final untitled Save As cancellation, successful Save As, and Discard.
  await seed([]);
  await launch(); windows = await pages(1);
  field = await source(windows[0].page);
  await field.fill('Untitled final text');
  await application.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await responses([0]); await close(windows[0].page);
  await until(async () => !(await windows[0].page.locator('[aria-busy="true"]').count()) && await application.evaluate(() => global.startupPrompts.length === 1), 'Cancelled Save As closed the final window');
  assert.equal(await field.inputValue(), 'Untitled final text');
  await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, saved);
  await responses([0]); await closeLast(windows[0].page);
  await launch(); windows = await pages(1);
  assert.equal(windows[0].doc.path, saved);
  assert.equal(await (await source(windows[0].page)).inputValue(), 'Untitled final text');
  await closeLast(windows[0].page);
  await seed([]); await launch(); windows = await pages(1);
  field = await source(windows[0].page); await field.fill('Discard this untitled final draft');
  await responses([1]); await closeLast(windows[0].page);
  assert.deepEqual((await session()).documents, []);
  console.log('PASS: last-window Save As cancellation and saving, with explicit untitled Discard still respected');

  await seed([doc(beta, 'beta')], 'new');
  await launch([beta]); windows = await pages(1); await closeLast(windows[0].page);
  assert.deepEqual((await session()).documents.map(doc => doc.path), [beta]);
  await launch(); windows = await pages(1);
  assert.equal(windows[0].doc.path, null);
  assert.equal(windows[0].doc.content, '');
  assert.equal((await session()).settings.startupBehavior, 'new');
  await assertNoErrors(); await closeLast(windows[0].page);
  console.log('PASS: Start New Session remains an intentional blank startup');
  completed = true;
  console.log('ALL CLOSE/RESTORE CHECKS PASSED');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) try { await application.evaluate(({ app }) => app.exit(1)); } catch {}
  display?.kill(); clearTimeout(watchdog);
});
