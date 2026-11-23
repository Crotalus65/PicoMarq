const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const work = path.join(__dirname, 'tmp', 'close-command');
const profile = path.join(work, 'data');
const file = path.join(work, 'Close target.md');
const saved = path.join(work, 'Saved and closed.md');
const baseline = 'Saved document text';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let application, display;
let completed = false;
const errors = [];
const watchdog = setTimeout(() => { console.error('Close Window checks timed out'); process.exit(1); }, 180000);
process.on('exit', () => { if (!completed) process.exitCode = 1; });
async function until(check, message) {
  const start = Date.now();
  while (Date.now() - start < 15000) { if (await check()) return; await pause(50); }
  throw new Error(message);
}
async function session() { return JSON.parse(await fs.readFile(path.join(profile, 'session.json'), 'utf8')); }
function doc(filePath, id) { return { id, path: filePath, content: baseline, diskContent: baseline, view: { sourceMode: true } }; }
async function seed(documents = [doc(file, 'original')]) {
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(file, baseline);
  await fs.writeFile(path.join(profile, 'session.json'), JSON.stringify({ version: 1, settings: { startupBehavior: 'restore' }, documents, activeDocumentId: documents[0]?.id ?? null, recentFiles: [file] }));
}
async function launch() {
  application = await _electron.launch({ executablePath: require('electron'), args: [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), path.join(__dirname, 'startup-harness.cjs')], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: profile }, timeout: 20000 });
  const watch = page => page.on('pageerror', error => errors.push(String(error)));
  application.windows().forEach(watch); application.on('window', watch);
  await application.firstWindow();
}
async function pages(count = 1) {
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
  }, `Expected ${count} document windows`);
  return result;
}
async function source(page) {
  const field = page.getByRole('textbox', { name: 'Markdown source' });
  if (!await field.isVisible()) await (await application.browserWindow(page)).evaluate(win => win.webContents.send('scratch:command', { action: 'source' }));
  await field.waitFor(); return field;
}
async function respond(responses) {
  await application.evaluate((_electron, responses) => { global.startupResponses = responses; global.startupPrompts = []; }, responses);
}
async function closeCommand(page, method = 'menu') {
  if (method === 'renderer') { await page.evaluate(() => window.desktop.invoke('close_window')); return; }
  const win = await application.browserWindow(page);
  if (method === 'shortcut') {
    await win.evaluate(window => {
      window.focus(); window.webContents.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'w', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'w', modifiers: ['control'] });
    });
    return;
  }
  // Exercise the compact File menu's real native command and owning window.
  await application.evaluate(({ Menu }) => {
    global.originalClosePopup = Menu.prototype.popup;
    Menu.prototype.popup = function(options) { global.closePopup = { menu: this, options }; };
  });
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await until(() => application.evaluate(() => !!global.closePopup), 'File menu did not open');
  await application.evaluate(({ Menu }) => {
    const { menu, options } = global.closePopup;
    const item = menu.getMenuItemById('close-window');
    item.click(item, options.window, options.window.webContents);
    options.callback();
    Menu.prototype.popup = global.originalClosePopup;
    global.closePopup = null;
  });
}
async function replacement(page, method = 'menu') {
  const previous = (await page.evaluate(() => window.desktop.invoke('get_session'))).documents[0];
  const bounds = await (await application.browserWindow(page)).evaluate(win => win.getNormalBounds());
  const closed = page.waitForEvent('close', { timeout: 20000 });
  await closeCommand(page, method); await closed;
  const [next] = await pages();
  await until(async () => await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === 1, 'Close Window left extra native windows');
  assert.notEqual(next.doc.id, previous.id);
  assert.equal(next.doc.name, 'Untitled');
  assert.equal(next.doc.path, null); assert.equal(next.doc.content, '');
  assert.deepEqual(await (await application.browserWindow(next.page)).evaluate(win => win.getNormalBounds()), bounds, 'Replacement moved or resized the window');
  await next.page.locator('.tiptap').waitFor();
  assert.equal((await next.page.locator('.tiptap').innerText()).trim(), '');
  assert.equal(await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('revert').enabled), false);
  await until(async () => (await session()).documents.length === 1 && (await session()).documents[0].id === next.doc.id, 'Closed document remained in the recovery session');
  assert.deepEqual(errors, []);
  assert.deepEqual(await application.evaluate(() => global.startupErrors), []);
  return next.page;
}
async function quit(page, native = false) {
  const ended = application.waitForEvent('close', { timeout: 20000 });
  if (native) await (await application.browserWindow(page)).evaluate(win => win.close());
  else await application.evaluate(({ app }) => app.quit());
  await ended; application = null;
}
async function cancelled(page) {
  await until(async () => !await page.locator('[aria-busy="true"]').count() && await application.evaluate(() => global.startupPrompts.length === 1), 'Cancelled close did not leave the document editable');
  assert.equal((await pages()).length, 1);
}
async function main() {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const number = process.env.SCRATCH_DISPLAY_NUMBER || '14750';
    display = spawn(process.env.SCRATCH_XVFB || 'Xvfb', [':' + number, '-screen', '0', '1440x1000x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + number; await pause(500);
  }
  await seed(); await launch();
  let [{ page }] = await pages();
  await (await application.browserWindow(page)).evaluate(win => win.setBounds({ x: 55, y: 65, width: 850, height: 650 }));
  page = await replacement(page);
  assert.equal(await fs.readFile(file, 'utf8'), baseline);
  for (const method of ['shortcut', 'shortcut', 'renderer']) page = await replacement(page, method);
  const field = await source(page); await field.press('Control+Z'); assert.equal(await field.inputValue(), '', 'Blank document inherited an old undo history');
  await quit(page); await launch();
  [{ page }] = await pages();
  assert.equal((await pages())[0].doc.path, null);
  assert.equal((await pages())[0].doc.content, '');
  await quit(page, true);
  console.log('PASS: File Close Window, native Ctrl+W, renderer close, repeated blank closes, exact bounds, fresh Undo, and no closed-file resurrection');

  await seed(); await launch(); [{ page }] = await pages();
  let text = await source(page); await text.fill('Save this final edit immediately');
  await respond([2]); await closeCommand(page); await cancelled(page);
  assert.equal(await text.inputValue(), 'Save this final edit immediately');
  await respond([0]); page = await replacement(page, 'shortcut');
  assert.equal(await fs.readFile(file, 'utf8'), 'Save this final edit immediately');
  await quit(page);
  await seed(); await launch(); [{ page }] = await pages();
  text = await source(page); await text.fill('Discard this final edit');
  await respond([1]); page = await replacement(page, 'renderer');
  assert.equal(await fs.readFile(file, 'utf8'), baseline);
  await quit(page, true);
  console.log('PASS: final named document Cancel, immediate Save, and Discard with a blank replacement only after confirmation');

  await seed([]); await launch(); [{ page }] = await pages();
  text = await source(page); await text.fill('Save this untitled document before closing');
  await application.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await respond([0]); await closeCommand(page); await cancelled(page);
  assert.equal(await text.inputValue(), 'Save this untitled document before closing');
  await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, saved);
  await respond([0]); page = await replacement(page);
  assert.equal(await fs.readFile(saved, 'utf8'), 'Save this untitled document before closing');
  await quit(page);
  console.log('PASS: cancelled Save As retains the final draft; successful Save As saves it and leaves a blank document');

  await seed(); await launch(); [{ page }] = await pages();
  await application.evaluate(({ BrowserWindow }) => {
    const load = BrowserWindow.prototype.loadURL;
    BrowserWindow.prototype.loadURL = function(...args) {
      BrowserWindow.prototype.loadURL = load;
      return Promise.reject(new Error('Test replacement could not load'));
    };
  });
  await closeCommand(page);
  await until(async () => await application.evaluate(() => global.startupErrors.length === 1) && !await page.locator('[aria-busy="true"]').count(), 'Failed replacement did not retain the original window');
  assert.deepEqual((await session()).documents.map(doc => doc.id), ['original']);
  assert.equal(await (await source(page)).inputValue(), baseline);
  assert.equal((await pages())[0].doc.path, file);
  await application.evaluate(() => { global.startupErrors = []; });
  await quit(page, true);
  console.log('PASS: a replacement-load failure keeps the original document, window and recovery data');

  const other = path.join(work, 'Other.md'); await fs.writeFile(other, baseline);
  await seed([doc(file, 'first'), doc(other, 'last')]); await launch();
  const windows = await pages(2);
  const ids = [];
  for (const id of ['first', 'last']) ids.push(await (await application.browserWindow(windows.find(entry => entry.doc.id === id).page)).evaluate(win => win.id));
  await (await application.browserWindow(windows.find(entry => entry.doc.id === 'last').page)).evaluate(win => win.setBounds({ x: 75, y: 85, width: 800, height: 600 }));
  const oldClosed = windows.map(entry => entry.page.waitForEvent('close'));
  await application.evaluate(({ BrowserWindow, Menu }, ids) => {
    const item = Menu.getApplicationMenu().getMenuItemById('close-window');
    for (const id of ids) { const win = BrowserWindow.fromId(id); item.click(item, win, win.webContents); }
  }, ids);
  await Promise.all(oldClosed); [{ page }] = await pages();
  assert.equal((await pages())[0].doc.path, null);
  assert.deepEqual(await (await application.browserWindow(page)).evaluate(win => win.getNormalBounds()), { x: 75, y: 85, width: 800, height: 600 });
  assert.equal((await session()).documents.length, 1);
  assert.deepEqual(errors, []); assert.deepEqual(await application.evaluate(() => global.startupErrors), []);
  await quit(page, true);
  console.log('PASS: rapid Close Window commands close the selected documents and leave one blank at the last window position');
  completed = true; console.log('ALL CLOSE WINDOW CHECKS PASSED');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) try { await application.evaluate(({ app }) => app.exit(1)); } catch {}
  display?.kill(); clearTimeout(watchdog);
});
