const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const work = path.join(__dirname, 'tmp', 'desktop-smoke');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let virtualDisplay;
let electron;
let page;
const errors = [];
let completed = false;
process.on('exit', () => { if (!completed) { console.error('Desktop checks exited before completion'); process.exitCode = 1; } });
const watchdog = setTimeout(() => { console.error('Desktop checks timed out before completion'); process.exit(1); }, 180000);
async function clipboardText() {
  // Run the synchronous native request outside the inspector evaluation stack.
  return electron.evaluate(({ clipboard }) => new Promise(resolve => setImmediate(() => resolve(clipboard.readText()))));
}
async function dispatch(action, extra = {}) {
  const win = await electron.browserWindow(page);
  await win.evaluate((window, command) => window.webContents.send('scratch:command', command), { action, ...extra });
}
async function until(test, message, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await test()) return;
    await pause(100);
  }
  throw new Error(message);
}
async function readSession() { const session = JSON.parse(await fs.readFile(path.join(work, 'data/session.json'), 'utf8')); return { ...session, document: session.documents.find(doc => doc.id === session.activeDocumentId) }; }
async function assertWordCount(count) {
  await until(async () => await page.locator('[data-word-count]').innerText() === `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`, `Word count did not update to ${count}`);
}
async function recentPaths() {
  return electron.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('open-recent').submenu.items.filter(item => item.enabled && item.type !== 'separator' && item.id !== 'clear-recent').map(item => item.label.replace(/^&\d /, '').replaceAll('&&', '&')));
}
async function openRecent(file) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await until(async () => await page.getByRole('button', { name: 'File', exact: true }).getAttribute('aria-expanded') === 'true', 'File menu did not open');
  await electron.evaluate(({ BrowserWindow }, file) => {
    const entry = global.testContextMenus.at(-1);
    const item = entry.menu.getMenuItemById('open-recent').submenu.items.find(item => (item.label || '').endsWith(file.replaceAll('&', '&&')));
    if (!item) throw new Error(`Missing recent file: ${file}`);
    const win = entry.options.window;
    item.click(item, win, win.webContents);
    entry.options.callback();
  }, file);
  await until(async () => await page.getByRole('button', { name: 'File', exact: true }).getAttribute('aria-expanded') === 'false', 'File menu did not close');
}
async function menuItem(menu, label) {
  await page.getByRole('button', { name: menu, exact: true }).click();
  await until(async () => await page.getByRole('button', { name: menu, exact: true }).getAttribute('aria-expanded') === 'true', `${menu} menu did not open`);
  await electron.evaluate(({ BrowserWindow }, label) => {
    const entry = global.testContextMenus.at(-1);
    const item = entry.menu.items.find(item => item.label.replaceAll('&', '') === label);
    if (!item) throw new Error(`Missing menu command: ${label}`);
    const win = entry.options.window;
    item.click(item, win, win.webContents);
    entry.options.callback();
  }, label);
  await until(async () => await page.getByRole('button', { name: menu, exact: true }).getAttribute('aria-expanded') === 'false', 'Menu did not close');
}
async function zoomKeys(control, native = false) {
  await control.focus();
  // Source view hides the formatting bar with a short transition.
  if (await control.evaluate(el => el.tagName === 'TEXTAREA')) await until(async () => await page.locator('[data-document-id][aria-hidden="false"] [data-format-bar]').evaluate(el => el.getBoundingClientRect().height === 0), 'Source toolbar did not finish hiding');
  const baseFontSize = await control.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const controls = () => page.evaluate(() => {
    const selectors = ['[data-editor-header]', '[data-format-bar]', 'footer', 'nav[aria-label="Application menus"] button', '[data-format-bar] button', '[aria-label="Find in document"]'];
    return selectors.flatMap(selector => [...document.querySelectorAll(selector === 'footer' ? selector : '[data-document-id][aria-hidden="false"] ' + selector)].map(el => {
      const rect = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fontSize: css.fontSize };
    }));
  });
  const originalControls = await controls();
  const pageWidth = await control.evaluate(el => el.getBoundingClientRect().width);
  for (const [key, zoom, nativeKey] of [
    ['Control+Equal', '1.1', '='], ['Control+Shift+Equal', '1.2', '+'],
    ['Control+NumpadAdd', '1.3', 'numadd'], ['Control+Minus', '1.2', '-'],
    ['Control+Shift+Minus', '1.1', '_'], ['Control+NumpadSubtract', '1', 'numsub'],
    ['Control+Equal', '1.1', '='], ['Control+0', '1', '0'],
  ]) {
    if (native) await electron.evaluate(({ BrowserWindow }, { nativeKey, shift }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.focus();
      win.webContents.focus();
      const modifiers = shift ? ['control', 'shift'] : ['control'];
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: nativeKey, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: nativeKey, modifiers });
    }, { nativeKey, shift: key.includes('Shift') });
    else await page.keyboard.press(key);
    await until(async () => await page.evaluate(expected => document.documentElement.style.getPropertyValue('--editor-text-zoom') === expected, zoom), `${key} did not produce zoom ${zoom}`);
    // Ensure the native accelerator did not apply a second increment.
    await pause(100);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--editor-text-zoom')), zoom);
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).zoom), '1');
    assert.deepEqual(await controls(), originalControls, 'Menus, icons, Find, or status bar changed size during text zoom');
    const actualFontSize = await control.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert(Math.abs(actualFontSize - baseFontSize * Number(zoom)) < 0.01, `Document font did not scale for ${key}`);
    assert.equal(await control.evaluate(el => el.getBoundingClientRect().width), pageWidth, 'Text zoom changed page width');
  }
}
async function launch() {
  electron = await _electron.launch({ executablePath: require('electron'), args: process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', root] : [root], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: path.join(work, 'data') }, timeout: 20000 });
  page = await electron.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector('[data-document-id][aria-hidden="false"] .tiptap, [data-document-id][aria-hidden="false"] textarea[aria-label="Markdown source"]', { timeout: 15000 });
  await electron.evaluate(({ BrowserWindow, Menu, dialog }) => {
    global.testPrompts = [];
    global.testResponses = [];
    global.testErrors = [];
    dialog.showErrorBox = (title, message) => global.testErrors.push({ title, message });
    dialog.showMessageBox = async (_window, options) => { global.testPrompts.push(options); return { response: global.testResponses.length ? global.testResponses.shift() : 1 }; };
    global.testInputs = [];
    BrowserWindow.getAllWindows()[0].webContents.on('before-input-event', (_event, input) => global.testInputs.push(input));
    // Keep real native Menu instances and their handlers while suppressing popups.
    global.testContextMenus = [];
    Menu.prototype.popup = function(options) { global.testContextMenus.push({ menu: this, options }); };
  });
}
async function closeNormally() {
  const closed = electron.waitForEvent('close', { timeout: 15000 });
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  electron = null;
}
async function main() {
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const binary = process.env.SCRATCH_XVFB || 'Xvfb';
    const display = process.env.SCRATCH_DISPLAY_NUMBER || '121';
    virtualDisplay = spawn(binary, [':' + display, '-screen', '0', '1440x1000x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { env: process.env, stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + display;
    await pause(500);
  }
  await launch();
  const labels = await electron.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label));
  assert.deepEqual(labels, ['&File', '&Edit', '&View', '&Help']);
  assert.equal(await electron.evaluate(({ app }) => app.getName()), 'PicoMarQ');
  assert((await page.title()).endsWith('PicoMarQ'));
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--editor-max-width')), '100%');
  assert.deepEqual(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('view').submenu.items.filter(item => item.type !== 'separator' && item.enabled && !item.id?.startsWith('document-')).map(item => item.label.replaceAll('&', ''))), ['Markdown Source', 'Zoom In', 'Zoom Out', 'Actual Size']);
  assert.deepEqual(await recentPaths(), []);
  assert.deepEqual(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('open-recent').submenu.items.map(item => ({ label: item.label, enabled: item.enabled }))), [{ label: 'No recent files', enabled: false }]);
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  assert.deepEqual(await page.getByRole('navigation', { name: 'Application menus' }).getByRole('button').allTextContents(), ['File', 'Edit', 'View', 'Help']);
  assert.equal(await page.locator('[data-sidebar]').count(), 0);
  const layout = await page.evaluate(() => {
    const header = document.querySelector('[data-editor-header]').getBoundingClientRect();
    const toolbar = document.querySelector('[data-format-bar]').getBoundingClientRect();
    // The last menu must end before the unsaved-changes dot.
    const view = [...document.querySelectorAll('nav button')].find(button => button.textContent === 'Help').getBoundingClientRect();
    const status = document.querySelector('[data-editor-header] [role="status"]').getBoundingClientRect();
    // The Find magnifier is the last button of the formatting toolbar, at its right end; the menu row has none in the formatted view.
    const find = document.querySelector('[data-formatting-toolbar] [aria-label="Find in document"]').getBoundingClientRect();
    const iconRow = document.querySelector('[data-formatting-toolbar]').getBoundingClientRect();
    const lastFormatting = [...document.querySelectorAll('[data-formatting-toolbar] > button')].slice(-2)[0].getBoundingClientRect();
    return { gap: toolbar.top - header.bottom, headerHeight: header.height, viewRight: view.right, statusLeft: status.left, headerFinds: document.querySelectorAll('[data-editor-header] [aria-label="Find in document"]').length, findRightGap: iconRow.right - find.right, findAfterIcons: find.left - lastFormatting.right, centerDifference: (iconRow.top + iconRow.bottom - find.top - find.bottom) / 2 };
  });
  assert(Math.abs(layout.gap) < 1);
  assert.equal(layout.headerHeight, 32);
  assert(layout.viewRight <= layout.statusLeft);
  assert.equal(layout.headerFinds, 0);
  assert(layout.findRightGap >= 8 && layout.findRightGap <= 16, `Find magnifier is not at the right end of the toolbar (${layout.findRightGap}px)`);
  assert(layout.findAfterIcons > 40, 'Find magnifier is not separated from the formatting icons');
  assert(Math.abs(layout.centerDifference) < 1);
  assert.equal((await page.locator('[data-document-id][aria-hidden="false"] [data-editor-header]').innerText()).replace(/\s/g, ''), 'FileEditViewHelp');
  for (const name of [/Inline Code/, /Code Block/, /Block Math/, /Wikilink/i, /View Markdown Source/, /View Formatted/, /Export/, /Heading 4/]) assert.equal(await page.getByRole('button', { name }).count(), 0);
  const editor = page.locator('[data-document-id][aria-hidden="false"] .tiptap');
  await assertWordCount(0);
  await zoomKeys(editor);
  await zoomKeys(editor, true);
  assert((await electron.evaluate(() => global.testInputs.length)) > 0, 'Native input tests did not reach Electron');
  console.log('PASS: compact menu/status/find row, no toolbar gap or removed controls, text-only zoom with fixed menus/icons/status bar and page width, plus/minus/keypad/reset shortcuts in formatted view');
  await editor.click();
  await page.keyboard.type('Clipboard selection');
  await assertWordCount(2);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await until(async () => (await clipboardText()).includes('Clipboard selection'), 'Native Copy did not update the clipboard');
  await page.keyboard.press('Control+X');
  await until(async () => !(await editor.innerText()).includes('Clipboard selection'), 'Native Cut did not delete the selection');
  await assertWordCount(0);
  await page.keyboard.press('Control+V');
  await until(async () => (await editor.innerText()).includes('Clipboard selection'), 'Native Paste did not insert text');
  await assertWordCount(2);
  console.log('PASS: File/Edit/View menus, no sidebar, native Cut/Copy/Paste');

  await page.keyboard.press('Control+A');
  const beforeSelection = await page.evaluate(() => getSelection().toString());
  await page.locator('[data-document-id][aria-hidden="false"] .tiptap p').first().click({ button: 'right', position: { x: 40, y: 10 } });
  await until(async () => await electron.evaluate(() => global.testContextMenus.length > 0), 'Context menu did not open');
  assert.equal(await page.evaluate(() => getSelection().toString()), beforeSelection);
  const enabled = await electron.evaluate(() => global.testContextMenus.at(-1).menu.items.filter(item => ['cut','copy','paste'].includes(item.role)).map(item => ({ role: item.role, enabled: item.enabled })));
  assert(enabled.every(item => item.enabled));
  assert.equal(enabled.length, 3);
  await electron.evaluate(({ BrowserWindow }) => {
    const entry = global.testContextMenus.at(-1);
    const item = entry.menu.items.find(item => item.role === 'copy');
    const win = entry.options.window;
    item.click(item, win, win.webContents);
    entry.options.callback();
  });
  assert((await clipboardText()).includes('Clipboard selection'));
  console.log('PASS: right-click retains the selection and enables clipboard menu items');

  await page.keyboard.press('Control+E');
  await page.locator('[data-document-id][aria-hidden="false"] .tiptap p code').waitFor();
  await page.keyboard.press('Control+E');
  assert.equal(await page.locator('[data-document-id][aria-hidden="false"] .tiptap p code').count(), 0);
  await menuItem('Edit', 'Copy');
  assert((await clipboardText()).includes('Clipboard selection'));
  await menuItem('Edit', 'Cut');
  await until(async () => !(await editor.innerText()).includes('Clipboard selection'), 'Relocated Edit > Cut did not remove selection');
  await menuItem('Edit', 'Paste');
  await until(async () => (await editor.innerText()).includes('Clipboard selection'), 'Relocated Edit > Paste did not insert text');
  // Alt mnemonics open the inline menu while the native bar stays hidden.
  const menuCount = await electron.evaluate(() => global.testContextMenus.length);
  await page.keyboard.press('Alt+v');
  await until(async () => await electron.evaluate(() => global.testContextMenus.length) > menuCount, 'Alt+V did not open View');
  await electron.evaluate(() => global.testContextMenus.at(-1).options.callback());
  await until(async () => await page.getByRole('button', { name: 'View', exact: true }).getAttribute('aria-expanded') === 'false', 'View menu did not close');
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  console.log('PASS: relocated Edit clipboard commands, Ctrl+E, Alt+V, and hidden native menu bar');

  // Help > About PicoMarQ: the version, the acknowledgment, and buttons that
  // open PicoMarQ's page and Scratch's page in the browser.
  const helpCount = await electron.evaluate(() => global.testContextMenus.length);
  await page.keyboard.press('Alt+h');
  await until(async () => await electron.evaluate(() => global.testContextMenus.length) > helpCount, 'Alt+H did not open Help');
  assert.deepEqual(await electron.evaluate(() => global.testContextMenus.at(-1).menu.items.map(item => item.label)), ['&About PicoMarQ']);
  await electron.evaluate(() => global.testContextMenus.at(-1).options.callback());
  await until(async () => await page.getByRole('button', { name: 'Help', exact: true }).getAttribute('aria-expanded') === 'false', 'Help menu did not close');
  await electron.evaluate(({ shell }) => { global.testOpened = []; shell.openExternal = async url => { global.testOpened.push(url); }; });
  const version = require(path.join(root, 'package.json')).version;
  for (const [response, opened] of [[0, ['https://github.com/Crotalus65/PicoMarq']], [1, ['https://github.com/erictli/scratch']], [2, []]]) {
    await electron.evaluate((_electron, response) => { global.testPrompts.length = 0; global.testOpened.length = 0; global.testResponses.push(response); }, response);
    await menuItem('Help', 'About PicoMarQ');
    await until(async () => await electron.evaluate(() => global.testPrompts.length) === 1, 'About PicoMarQ did not open');
    await pause(150);
    const about = await electron.evaluate(() => ({ ...global.testPrompts[0], icon: undefined }));
    assert.equal(about.title, 'About PicoMarQ');
    assert.equal(about.message, 'PicoMarQ');
    assert.deepEqual(about.detail.split('\n'), [`Version ${version}`, '', 'Based on Scratch by Eric Li and contributors.', '', 'PicoMarQ: https://github.com/Crotalus65/PicoMarq', 'Scratch: https://github.com/erictli/scratch']);
    assert.deepEqual(about.buttons, ['PicoMarQ on GitHub', 'Scratch on GitHub', 'Close']);
    assert.equal(about.defaultId, 2);
    assert.equal(about.cancelId, 2);
    assert.deepEqual(await electron.evaluate(() => global.testOpened), opened);
  }
  assert.equal(await electron.evaluate(({ app }) => app.getVersion()), version);
  // Later checks count the message boxes shown.
  await electron.evaluate(() => { global.testPrompts.length = 0; });
  console.log(`PASS: Help menu (Alt+H) with About PicoMarQ: version ${version}, based on Scratch by Eric Li, buttons open the PicoMarQ and Scratch pages`);

  const savedFile = path.join(work, 'My ünicode document.md');
  await electron.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, savedFile);
  await menuItem('File', 'Save');
  await until(async () => { try { return (await fs.readFile(savedFile, 'utf8')).includes('Clipboard selection'); } catch { return false; } }, 'Save did not write Markdown');
  await menuItem('View', 'Markdown Source');
  const source = page.getByRole('textbox', { name: 'Markdown source' });
  await source.waitFor();
  await zoomKeys(source);
  assert.equal(await source.inputValue(), await fs.readFile(savedFile, 'utf8'));
  console.log('PASS: View > Markdown Source and text-only zoom shortcuts with fixed controls in source view');

  // Soft wrapping preserves Markdown while reflowing long lines and unbroken syntax.
  const originalSource = await source.inputValue();
  const wrappedSource = 'Wrapped prose '.repeat(1100) + 'wrap-target ' + 'https://example.com/' + 'x'.repeat(1200);
  await source.fill(wrappedSource);
  const sourceMetrics = () => source.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.scrollHeight, wrap: el.wrap, value: el.value }));
  const wideSource = await sourceMetrics();
  assert.equal(wideSource.wrap, 'soft');
  assert.equal(wideSource.value, wrappedSource);
  assert(wideSource.scrollWidth <= wideSource.width + 1, 'Wide source overflowed horizontally');
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(640, 760));
  await until(async () => (await sourceMetrics()).width < wideSource.width, 'Source did not resize with the window');
  const narrowSource = await sourceMetrics();
  assert(narrowSource.height > wideSource.height, 'Source did not reflow at the narrower width');
  assert(narrowSource.scrollWidth <= narrowSource.width + 1, 'Long source syntax did not wrap');
  assert.equal(narrowSource.value, wrappedSource);
  await dispatch('find');
  const wrappedFind = page.getByPlaceholder('Find in note...');
  await wrappedFind.fill('wrap-target');
  await until(async () => await source.evaluate(el => el.scrollTop > 2000 && el.value.slice(el.selectionStart, el.selectionEnd) === 'wrap-target'), 'Find did not reach a target in one long wrapped line');
  const foundScroll = await source.evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click();
  await source.press('ArrowRight');
  assert(Math.abs((await source.evaluate(el => el.scrollTop)) - foundScroll) < 30, 'Wrapped Find left the selected text outside the visible area');
  await dispatch('save');
  await until(async () => (await fs.readFile(savedFile, 'utf8')) === wrappedSource, 'Soft wrapping changed the saved Markdown');
  await source.fill(originalSource);
  await dispatch('save');
  await until(async () => (await fs.readFile(savedFile, 'utf8')) === originalSource, 'Original source was not restored after the wrapping check');
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 760));
  console.log('PASS: source wraps at wide/narrow window sizes, long unbroken syntax wraps, wrapped Find reaches visible text, Save preserves original line breaks');
  // Formatting markers, link targets, task markers, and table separators are not words.
  await source.fill('# Hello world\n\n**Bold words** and [linked text](https://example.com/hidden-address).\n\n- [x] First task\n\n| A | B |\n| --- | --- |\n| one | two |\n');
  await assertWordCount(13);
  await dispatch('source');
  await page.locator('[data-document-id][aria-hidden="false"] .tiptap h1').waitFor();
  await assertWordCount(13);
  await dispatch('source');
  await source.waitFor();
  await source.fill('Résumé naïve café — 123 !!!');
  await assertWordCount(4);
  await source.fill('Alone');
  await assertWordCount(1);
  await source.fill('# *** --- |');
  await assertWordCount(0);
  await source.fill('# A document\n\n**Bold text** and a paragraph.\n\n- [x] First task\n- [ ] Second task\n\n| A | B |\n| --- | --- |\n| one | two |\n');
  await assertWordCount(15);
  await dispatch('save');
  await until(async () => (await fs.readFile(savedFile, 'utf8')).includes('- [x] First task'), 'Source Save did not write current source');
  await dispatch('source');
  await page.locator('[data-document-id][aria-hidden="false"] .tiptap h1').waitFor();
  assert.equal(await page.locator('[data-document-id][aria-hidden="false"] .tiptap table').count(), 1);
  assert.equal(await page.locator('[data-document-id][aria-hidden="false"] .tiptap strong').innerText(), 'Bold text');
  await assertWordCount(15);
  console.log('PASS: live word count in both views, formatting/link/table exclusions, Unicode, numbers, punctuation, and singular label');
  const copyFile = path.join(work, 'Saved copy.md');
  await electron.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, copyFile);
  await dispatch('save-as');
  await until(async () => { try { return (await fs.readFile(copyFile, 'utf8')).includes('First task'); } catch { return false; } }, 'Save As did not create the second file');
  assert.equal(await fs.readFile(copyFile, 'utf8'), await fs.readFile(savedFile, 'utf8'));
  await until(async () => JSON.stringify(await recentPaths()) === JSON.stringify([copyFile, savedFile]), 'Save/Save As did not update recent files');
  const firstId = (await readSession()).document.id;
  const active = () => page.locator('[data-document-id][aria-hidden="false"]');
  const rich = () => active().locator('.tiptap');
  const text = () => active().getByRole('textbox', { name: 'Markdown source' });
  const promptCount = () => electron.evaluate(() => global.testPrompts.length);
  const respond = responses => electron.evaluate((_electron, responses) => { global.testResponses = responses; global.testPrompts = []; }, responses);
  const openFiles = async files => {
    await electron.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async (_window, options) => { global.testOpenOptions = options; return { canceled: false, filePaths: files }; }; }, files);
    await menuItem('File', 'Open…');
    await until(async () => (await readSession()).document.path === files.at(-1), 'Open did not activate the last chosen document');
  };
  // Opening an already-open path selects the retained editor, including unsaved edits.
  await rich().locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' reopened');
  await openFiles([copyFile]);
  assert.equal((await readSession()).document.id, firstId);
  assert.equal((await readSession()).documents.length, 1);
  assert.equal(await promptCount(), 0);
  assert((await rich().locator('h1').innerText()).endsWith('reopened'));
  assert(!(await fs.readFile(copyFile, 'utf8')).includes('reopened'));
  await dispatch('save');
  await until(async () => (await fs.readFile(copyFile, 'utf8')).includes('reopened'), 'Save did not write the retained draft');
  console.log('PASS: repeat Open selects the retained document without duplicating or discarding unsaved edits');

  await dispatch('settings');
  await page.getByLabel('Font', { exact: true }).waitFor();
  await until(async () => (await page.locator('#font-family optgroup[label="Installed system fonts"] option').count()) > 0, 'Installed fonts were not listed');
  const fontValue = await page.locator('#font-family optgroup[label="Installed system fonts"] option').first().getAttribute('value');
  await page.getByLabel('Font', { exact: true }).selectOption(fontValue);
  assert.equal(await page.getByText('Text Direction', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Integrations', { exact: true }).count(), 0);
  assert.deepEqual(await page.getByLabel('Page Width', { exact: true }).locator('option').allTextContents(), ['Full', 'Custom']);
  await page.getByLabel('Page Width', { exact: true }).selectOption('custom');
  await page.getByLabel('Custom Width', { exact: true }).fill('670');
  await until(async () => await page.evaluate(() => document.documentElement.style.getPropertyValue('--editor-max-width')) === '670px', 'Custom width did not apply');
  await page.getByLabel('Page Width', { exact: true }).selectOption('full');
  assert.equal(await page.getByText('Preview', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Kibble Maximization Protocol', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  await menuItem('View', 'Zoom In');
  await until(async () => await page.evaluate(() => document.documentElement.style.getPropertyValue('--editor-text-zoom')) === '1.1', 'Zoom did not apply');
  assert((await rich().evaluate(el => getComputedStyle(el).fontFamily)).includes(fontValue.slice(5)));
  console.log('PASS: installed fonts, Full/Custom page widths, no settings preview, zoom');

  // 200% is limited to formatting icons; menus, Find, editor text, and footer retain their sizes.
  const iconMetrics = () => active().evaluate(pane => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return {
      icons: [...pane.querySelectorAll('[data-formatting-toolbar] > button > svg')].map(rect),
      buttons: [...pane.querySelectorAll('[data-formatting-toolbar] > button')].map(rect),
      fixed: [...pane.querySelectorAll('[data-editor-header], [data-editor-header] button')].map(rect),
      footer: rect(document.querySelector('footer')),
      font: getComputedStyle(pane.querySelector('.tiptap')).fontSize,
      row: rect(pane.querySelector('[data-formatting-toolbar]')),
    };
  });
  const normalIcons = await iconMetrics();
  await dispatch('settings');
  assert.equal(await page.getByText('Your document, draft, writing position, appearance, and window are restored when you reopen the editor.', { exact: true }).count(), 0);
  assert.deepEqual(await page.getByLabel('Icon Size', { exact: true }).locator('option').allTextContents(), ['100%', '150%', '200%']);
  assert.equal(await page.getByLabel('Icon Size', { exact: true }).inputValue(), '1');
  await page.getByLabel('Icon Size', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  const largeIcons = await iconMetrics();
  assert.equal(largeIcons.icons.length, normalIcons.icons.length);
  normalIcons.icons.forEach((icon, i) => {
    assert.equal(largeIcons.icons[i].width, icon.width * 2);
    assert.equal(largeIcons.icons[i].height, icon.height * 2);
    assert(largeIcons.icons[i].x >= largeIcons.buttons[i].x && largeIcons.icons[i].x + largeIcons.icons[i].width <= largeIcons.buttons[i].x + largeIcons.buttons[i].width, 'An enlarged icon overlaps its button');
    assert(largeIcons.icons[i].y >= largeIcons.row.y && largeIcons.icons[i].y + largeIcons.icons[i].height <= largeIcons.row.y + largeIcons.row.height, 'An enlarged icon was clipped');
  });
  assert.deepEqual(largeIcons.fixed, normalIcons.fixed, 'Icon Size changed the header or menus');
  assert.deepEqual(largeIcons.footer, normalIcons.footer, 'Icon Size moved or resized the footer');
  assert.equal(largeIcons.font, normalIcons.font);
  await page.screenshot({ path: path.join(work, 'icons-200.png') });
  const nativeMenuLabels = await electron.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('view').submenu.items.map(item => item.label));
  assert(!nativeMenuLabels.includes('Open Documents'));
  assert.equal(await active().getByRole('button', { name: /Heading 4/ }).count(), 0);
  await menuItem('View', 'Markdown Source');
  await text().waitFor();
  await text().fill('#### Heading four from syntax');
  await dispatch('source');
  await rich().locator('h4').waitFor();
  await dispatch('source');
  await text().waitFor();
  await text().fill(await fs.readFile(copyFile, 'utf8'));
  await dispatch('source');
  await rich().locator('h1').waitFor();
  await dispatch('settings');
  await page.getByLabel('Icon Size', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  assert.deepEqual(await iconMetrics(), normalIcons);
  console.log('PASS: 100%/200% formatting icons only, unclipped icons, fixed menus/Find/footer/text, removed settings sentence and View heading, Heading 4 remains available through syntax');

  const pagesForDocuments = async () => {
    const result = [];
    for (const candidate of electron.windows()) {
      if (candidate.isClosed()) continue;
      try {
        const session = await candidate.evaluate(() => window.desktop.invoke('get_session'));
        if (session.documents[0]) result.push({ page: candidate, document: session.documents[0] });
      } catch {}
    }
    return result;
  };
  const selectWindow = async file => {
    let match;
    await until(async () => { match = (await pagesForDocuments()).find(entry => entry.document.path === file || entry.document.id === file); return !!match; }, `No window for ${file}`);
    page = match.page;
    const win = await electron.browserWindow(page);
    await win.evaluate(window => { window.show(); window.focus(); });
    await page.waitForSelector('[data-document-id][aria-hidden="false"] .tiptap, [data-document-id][aria-hidden="false"] textarea[aria-label="Markdown source"]');
    return page;
  };
  const windowCount = () => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const sourceMode = async () => { if (!await text().isVisible()) await dispatch('source'); await text().waitFor(); };
  const nativeClose = async () => {
    const win = await electron.browserWindow(page);
    // Every window shares one menu, and the command of a menu shortcut goes to the window that has the
    // focus when the command runs, a moment after the key press. A window that was just created shows
    // itself, and takes the focus, when it is ready. A key pressed in another window at that moment closed
    // the new window instead (seen on a busy machine, on Electron 44.6.0 and 44.11.5 alike). So wait until
    // every window is on the screen and this one has kept the focus, and only then press the key.
    let held = 0;
    await until(async () => {
      const focused = await win.evaluate(window => {
        const BrowserWindow = window.constructor;
        if (BrowserWindow.getAllWindows().every(other => other.isVisible()) && BrowserWindow.getFocusedWindow()?.id === window.id) return true;
        window.focus(); window.webContents.focus();
        return false;
      });
      held = focused ? held + 1 : 0;
      return held === 2;
    }, 'The window did not take and keep the focus');
    await win.evaluate(window => {
      window.webContents.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'w', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'w', modifiers: ['control'] });
    });
  };
  const quit = async () => {
    const closed = electron.waitForEvent('close', { timeout: 20000 });
    await page.evaluate(() => window.desktop.invoke('quit'));
    await closed;
    electron = null;
  };
  const betaFile = path.join(work, 'Plan & ünicode.md');
  const gammaFile = path.join(work, 'Gamma.md');
  await fs.writeFile(betaFile, '# Beta\n\nSaved beta.\n');
  await fs.writeFile(gammaFile, '# Gamma\n\nSaved gamma.\n');
  await openFiles([betaFile, gammaFile]);
  await until(async () => await windowCount() === 3, 'Open did not create one window per file');
  assert.equal(await promptCount(), 0);
  assert.equal(await active().count(), 1, 'Original window retained hidden documents');
  assert.deepEqual(await electron.evaluate(() => global.testOpenOptions.properties), ['openFile', 'multiSelections']);
  const menuDocuments = await electron.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('view').submenu.items.filter(item => item.id?.startsWith('document-')));
  assert.equal(menuDocuments.length, 0);
  const originalPage = page;
  await rich().locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' independent-one');
  await selectWindow(betaFile);
  const betaPage = page;
  await rich().locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' independent-two');
  await selectWindow(copyFile);
  await menuItem('Edit', 'Undo');
  await until(async () => !(await rich().locator('h1').innerText()).includes('independent-one'), 'Undo targeted the wrong window');
  await selectWindow(betaFile);
  assert((await rich().locator('h1').innerText()).includes('independent-two'));
  await openFiles([copyFile]);
  assert.equal(await windowCount(), 3, 'Repeat Open duplicated a document');
  await selectWindow(copyFile);
  assert.equal(page, originalPage);
  const missingFile = path.join(work, 'Missing.md');
  await electron.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, missingFile);
  await menuItem('File', 'Open…');
  await until(async () => await electron.evaluate(() => global.testErrors.some(error => error.title === 'Could not open the file')), 'Failed Open did not report an error');
  assert.equal(await windowCount(), 3, 'Failed Open created a window or replaced an existing document');
  console.log('PASS: independent native windows, no View list, duplicate Open raises existing window, per-window Undo');

  // A source selection copied through the native clipboard reaches another window.
  await sourceMode();
  await text().fill('Copied between document windows');
  await text().focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await selectWindow(gammaFile);
  await sourceMode();
  await text().fill('');
  await text().focus();
  await page.keyboard.press('Control+V');
  await until(async () => await text().inputValue() === 'Copied between document windows', 'Native cross-window paste failed');
  const gammaPage = page;
  await selectWindow(copyFile);
  const longSource = '# Source draft\n\n' + Array.from({ length: 180 }, (_, i) => `Line ${i}: recovery text`).join('\n');
  await text().fill(longSource);
  await text().evaluate(el => { el.setSelectionRange(125, 133, 'backward'); el.scrollTop = 420; });
  const sourcePosition = await text().evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, top: el.scrollTop }));
  await selectWindow(betaFile);
  await sourceMode();
  await text().fill('Beta unsaved draft');
  await until(async () => {
    const state = await readSession();
    return state.documents.find(doc => doc.path === copyFile)?.content === longSource && state.documents.find(doc => doc.path === betaFile)?.content === 'Beta unsaved draft' && state.documents.find(doc => doc.path === gammaFile)?.content === 'Copied between document windows';
  }, 'One window overwrote another window’s recovery snapshot');
  await dispatch('settings');
  await page.getByLabel('Icon Size', { exact: true }).selectOption('1.5');
  await until(async () => await gammaPage.locator('[data-formatting-toolbar]').getAttribute('data-icon-size') === '1.5', 'Shared settings did not reach another window');
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  console.log('PASS: cross-window clipboard, simultaneous recovery snapshots, live shared AppData preferences');

  // Revert keeps the same document/window identity and cannot flush an old draft back.
  await selectWindow(copyFile);
  await respond([1]);
  await dispatch('revert');
  await pause(200);
  assert.equal(await text().inputValue(), longSource, 'Cancelled Revert changed the draft');
  const externalText = '# External revision\n\nSaved by another application.\n';
  await fs.writeFile(copyFile, externalText);
  await respond([0]);
  await dispatch('revert');
  await until(async () => await text().inputValue() === externalText, 'Revert did not reread disk');
  await pause(1200);
  assert.equal(await text().inputValue(), externalText, 'An obsolete editor callback undid Revert');
  assert.equal((await readSession()).documents.find(doc => doc.path === copyFile).id, firstId);
  assert.equal((await readSession()).documents.find(doc => doc.path === copyFile).content, externalText);
  assert.equal(await windowCount(), 3);
  await fs.rm(copyFile);
  await text().fill('Keep this if Revert fails');
  await respond([0]);
  await dispatch('revert');
  await page.getByText(/ENOENT/).waitFor();
  assert.equal(await text().inputValue(), 'Keep this if Revert fails');
  await fs.writeFile(copyFile, externalText);
  await respond([0]);
  await dispatch('revert');
  await until(async () => await text().inputValue() === externalText, 'Second Revert failed');
  await page.keyboard.press('Control+Z');
  assert.equal(await text().inputValue(), externalText, 'Revert retained the discarded undo history');
  await electron.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, betaFile);
  await dispatch('save-as');
  await page.getByText('That file is already open in another window. Choose a different filename or close that window first.').waitFor();
  assert.equal(await fs.readFile(betaFile, 'utf8'), '# Beta\n\nSaved beta.\n');
  console.log('PASS: Revert cancellation, disk reload, stable identity, failed-read protection, undo reset, duplicate Save As protection');

  // Existing launch routing must handle all filenames, including relative paths.
  const deltaFile = path.join(work, 'Delta.markdown');
  const epsilonFile = path.join(work, 'Epsilon.txt');
  await fs.writeFile(deltaFile, 'Delta text');
  await fs.writeFile(epsilonFile, 'Epsilon text');
  await electron.evaluate(({ app }, { directory, files }) => app.emit('second-instance', {}, ['PicoMarQ.exe', ...files], directory), { directory: work, files: ['Delta.markdown', 'Epsilon.txt'] });
  await until(async () => await windowCount() === 5, 'A later file-association launch did not create windows');
  await selectWindow(deltaFile);
  await nativeClose();
  await until(async () => await windowCount() === 4, 'Saved window did not close independently');
  await selectWindow(epsilonFile);
  await nativeClose();
  await until(async () => await windowCount() === 3, 'Second saved window did not close');
  await selectWindow(copyFile);
  await electron.evaluate(({ app }, { file, directory }) => app.emit('second-instance', {}, ['PicoMarQ.exe', file], directory), { file: copyFile, directory: path.dirname(copyFile) });
  await pause(300);
  assert.equal(await windowCount(), 3);
  console.log('PASS: subsequent launch routing, multiple and relative paths, duplicate launch, native Ctrl+W targets one window');

  // A later Cancel must preserve drafts for windows whose earlier answer was Discard.
  await text().fill(longSource);
  await selectWindow(betaFile);
  await text().fill('Beta draft preserved after Exit Cancel');
  await selectWindow(gammaFile);
  await text().fill('Gamma draft preserved after Exit Cancel');
  await respond([1, 2]);
  await page.evaluate(() => window.desktop.invoke('quit'));
  await until(async () => await promptCount() === 2 && !(await originalPage.locator('[aria-busy="true"]').count()), 'Exit cancellation did not release every window');
  assert.equal(await windowCount(), 3);
  assert.equal(await originalPage.getByRole('textbox', { name: 'Markdown source' }).inputValue(), longSource);
  assert.equal(await betaPage.getByRole('textbox', { name: 'Markdown source' }).inputValue(), 'Beta draft preserved after Exit Cancel');
  assert.equal(await gammaPage.getByRole('textbox', { name: 'Markdown source' }).inputValue(), 'Gamma draft preserved after Exit Cancel');
  console.log('PASS: coordinated Exit, sequential prompts, deferred Discard, later Cancel keeps all windows and drafts');

  // Hard termination recovers every draft; normal Exit later restores every saved window.
  await selectWindow(copyFile);
  await text().evaluate(el => { el.setSelectionRange(125, 133, 'backward'); el.scrollTop = 420; });
  const recoveredPosition = await text().evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, top: el.scrollTop }));
  const bounds = { x: 25, y: 35, width: 850, height: 650 };
  await (await electron.browserWindow(page)).evaluate((window, bounds) => window.setBounds(bounds), bounds);
  await until(async () => {
    const state = await readSession();
    const doc = state.documents.find(doc => doc.path === copyFile);
    return doc.content === longSource && doc.view.sourceSelection?.start === 125 && doc.window?.width === 850;
  }, 'The current selection/window bounds were not persisted');
  const crashed = electron.waitForEvent('close');
  await electron.evaluate(({ app }) => app.exit(0));
  await crashed;
  electron = null;
  await launch();
  await until(async () => await windowCount() === 3, 'Crash recovery did not restore each window');
  await selectWindow(copyFile);
  await text().waitFor();
  assert.equal(await text().inputValue(), longSource);
  assert.deepEqual(await text().evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, top: el.scrollTop })), recoveredPosition);
  assert.deepEqual(await (await electron.browserWindow(page)).evaluate(window => window.getNormalBounds()), bounds);
  await selectWindow(betaFile);
  assert.equal(await text().inputValue(), 'Beta draft preserved after Exit Cancel');
  await selectWindow(gammaFile);
  assert.equal(await text().inputValue(), 'Gamma draft preserved after Exit Cancel');
  await respond([0, 0, 0]);
  await quit();
  assert.equal((await readSession()).documents.length, 3);
  assert.equal(await fs.readFile(copyFile, 'utf8'), longSource);
  await launch();
  await until(async () => await windowCount() === 3, 'Exit did not restore each saved window');
  await selectWindow(copyFile);
  assert.equal(await text().inputValue(), longSource);
  console.log('PASS: all windows/drafts recover after termination, independent source selection/scroll/bounds, File Exit saves/restores each document');

  // Save As cancellation blocks close; an immediate Save captures the last keystroke.
  await selectWindow(betaFile);
  await text().fill('Immediate final beta edit');
  await respond([2]);
  await nativeClose();
  await until(async () => await promptCount() === 1 && !(await page.locator('[aria-busy="true"]').count()), 'Window close Cancel failed');
  assert.equal(await windowCount(), 3);
  await dispatch('new');
  await until(async () => await windowCount() === 4, 'New did not create a window');
  let untitled;
  await until(async () => { untitled = (await pagesForDocuments()).find(entry => !entry.document.path); return !!untitled; }, 'New window did not finish loading');
  await selectWindow(untitled.document.id);
  assert.equal(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('revert').enabled), false);
  await rich().click();
  await page.keyboard.type('An untitled draft');
  await electron.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await respond([0]);
  await nativeClose();
  await until(async () => await promptCount() === 1 && !(await page.locator('[aria-busy="true"]').count()), 'Cancelled Save As did not cancel closing');
  assert.equal(await windowCount(), 4);
  await respond([1]);
  await nativeClose();
  await until(async () => await windowCount() === 3, 'Discard did not close the untitled window');
  await selectWindow(betaFile);
  await respond([0]);
  await nativeClose();
  await until(async () => await windowCount() === 2, 'Save did not close beta');
  assert.equal(await fs.readFile(betaFile, 'utf8'), 'Immediate final beta edit');
  await selectWindow(gammaFile);
  await text().fill('Discard this gamma edit');
  await respond([1]);
  await nativeClose();
  await until(async () => await windowCount() === 1, 'Discard did not close only gamma');
  await selectWindow(copyFile);
  assert.equal(await text().inputValue(), longSource);
  const closed = page.waitForEvent('close');
  await nativeClose();
  await closed;
  await until(async () => (await pagesForDocuments()).length === 1, 'Final Close Window did not leave one blank document');
  const blank = (await pagesForDocuments())[0];
  assert.equal(blank.document.path, null);
  assert.equal(blank.document.content, '');
  await selectWindow(blank.document.id);
  await quit();
  assert.deepEqual((await readSession()).documents, [], 'Close Window retained the explicitly closed file');
  console.log('PASS: New window, disabled untitled Revert, individual Save/Discard/Cancel, cancelled Save As, final Close Window leaves a blank document');

  // Migrate a real pre-window v1 profile, including an unsaved untitled document.
  const legacy = {
    version: 1, settings: { theme: { mode: 'dark' }, editorFont: { baseFontSize: 19 }, interfaceZoom: 1.2 },
    documents: [
      { id: 'old-file', path: copyFile, content: 'Legacy unsaved file draft', diskContent: longSource, view: { sourceMode: true, sourceSelection: { start: 2, end: 6 }, sourceScrollTop: 0 } },
      { id: 'old-untitled', name: 'Untitled 2', path: null, content: 'Legacy unsaved untitled draft', diskContent: '', view: { sourceMode: true } },
    ], activeDocumentId: 'old-file', settingsOpen: false, window: bounds,
  };
  await fs.writeFile(path.join(work, 'data/session.json'), JSON.stringify(legacy));
  await launch();
  await until(async () => await windowCount() === 2, 'Old multi-document profile was not migrated');
  await selectWindow(copyFile);
  assert.equal(await text().inputValue(), 'Legacy unsaved file draft');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--editor-text-zoom')), '1.2');
  await selectWindow('old-untitled');
  assert.equal(await text().inputValue(), 'Legacy unsaved untitled draft');
  await respond([1, 1]);
  await quit();
  assert.equal((await readSession()).documents.length, 1);
  assert.equal((await readSession()).documents[0].content, longSource);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: old AppData profiles migrate to separate windows with stable identities, drafts, settings, and view state; Exit Discard removes untitled drafts');
}
main().then(() => { completed = true; console.log('ALL DESKTOP CHECKS PASSED'); }).catch(async error => {
  console.error(error);
  if (electron) console.error('Desktop errors:', await electron.evaluate(() => global.testErrors || []));
  if (page && !page.isClosed()) console.error('Page text:', (await page.locator('body').innerText()).slice(-1800));
  process.exitCode = 1;
}).finally(async () => {
  if (electron) { try { await electron.evaluate(({ app }) => app.exit()); } catch {} }
  virtualDisplay?.kill();
  clearTimeout(watchdog);
});
