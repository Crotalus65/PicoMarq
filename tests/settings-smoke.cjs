// Settings checks in the real Electron app: typing in the Point Size and Custom
// Width boxes, and Saved Themes > Restore Default Theme (its confirmation is
// answered by the test). Needs a graphical session or Xvfb.
// Usage: node tests/settings-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const work = path.join(__dirname, 'tmp', 'settings-smoke');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let virtualDisplay;
let electron;
let page;
const errors = [];

const settings = () => page.evaluate(() => window.desktop.invoke('get_settings'));
async function dispatch(action) {
  const win = await electron.browserWindow(page);
  await win.evaluate((window, action) => window.webContents.send('scratch:command', { action }), action);
}
// Click the box, select its text, type, then press Tab or Enter.
async function typeInto(selector, text, finish = 'Tab') {
  const box = page.locator(selector);
  await box.click();
  await page.keyboard.press('Control+A');
  if (text) await page.keyboard.type(text); else await page.keyboard.press('Backspace');
  const whileTyping = await box.inputValue();
  await page.keyboard.press(finish);
  await pause(300);
  return { whileTyping, after: await box.inputValue() };
}

async function main() {
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(path.join(work, 'data'), { recursive: true });
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const binary = process.env.SCRATCH_XVFB || 'Xvfb';
    const display = process.env.SCRATCH_DISPLAY_NUMBER || '125';
    virtualDisplay = spawn(binary, [':' + display, '-screen', '0', '1440x1000x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { env: process.env, stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + display;
    await pause(500);
  }
  electron = await _electron.launch({ executablePath: require('electron'), args: process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', root] : [root], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: path.join(work, 'data') }, timeout: 20000 });
  page = await electron.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector('[data-document-id][aria-hidden="false"] .tiptap', { timeout: 15000 });
  await dispatch('settings');
  await page.locator('#font-size').waitFor();
  // The size box is labeled with its range (since 1.3).
  assert.equal(await page.locator('label[for="font-size"]').innerText(), 'Point Size (12-24)');
  assert.equal(await page.getByLabel('Point Size (12-24)', { exact: true }).getAttribute('id'), 'font-size');
  assert.equal(await page.getByText('Size', { exact: true }).count(), 0);

  // Point Size: typed numbers take effect; out-of-range numbers move into range.
  let result = await typeInto('#font-size', '18');
  assert.deepEqual(result, { whileTyping: '18', after: '18' });
  assert.equal((await settings()).editorFont.baseFontSize, 18);
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--editor-base-font-size')), '18px');
  assert.deepEqual(await typeInto('#font-size', '20', 'Enter'), { whileTyping: '20', after: '20' });
  assert.equal((await settings()).editorFont.baseFontSize, 20);
  assert.deepEqual(await typeInto('#font-size', '30'), { whileTyping: '30', after: '24' });
  assert.equal((await settings()).editorFont.baseFontSize, 24);
  assert.deepEqual(await typeInto('#font-size', '5', 'Enter'), { whileTyping: '5', after: '12' });
  assert.equal((await settings()).editorFont.baseFontSize, 12);
  assert.deepEqual(await typeInto('#font-size', ''), { whileTyping: '', after: '12' });
  assert.equal((await settings()).editorFont.baseFontSize, 12);
  await page.locator('#font-size').click();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#font-size').inputValue(), '14');
  assert.equal((await settings()).editorFont.baseFontSize, 14);
  console.log('PASS: Settings > Point Size (12-24) is labeled so, accepts typed sizes, moves out-of-range sizes into 12-24, and still steps with the arrow keys');

  // Custom Width has the same kind of box.
  await page.locator('#editor-width').selectOption('custom');
  assert.deepEqual(await typeInto('#custom-width', '900'), { whileTyping: '900', after: '900' });
  assert.equal((await settings()).customEditorWidthPx, 900);
  assert.deepEqual(await typeInto('#custom-width', '5000', 'Enter'), { whileTyping: '5000', after: '3840' });
  assert.equal((await settings()).customEditorWidthPx, 3840);
  console.log('PASS: Settings > Custom Width accepts typed widths');

  // Restore Default Theme: customize everything, then Cancel and Restore.
  await page.evaluate(() => window.desktop.invoke('update_settings', { patch: {
    theme: { mode: 'dark' }, startupBehavior: 'new', smartTypography: false,
    editorFont: { baseFontFamily: 'serif', systemFontFamily: '', baseFontSize: 20, boldWeight: 800, lineHeight: 2 },
    editorWidth: 'custom', customEditorWidthPx: 900, interfaceZoom: 1.25, toolbarIconScale: 1.5,
    customColorsLight: { italic: '#d50000' }, customColorsDark: { italic: '#ff4fa3', bg: '#101820' },
  } }));
  const customized = await settings();
  await electron.evaluate(({ dialog }) => {
    global.restoreDialogs = [];
    global.restoreAnswers = [1, 0]; // Cancel, then Restore
    dialog.showMessageBox = async (_window, options) => { global.restoreDialogs.push(options); return { response: global.restoreAnswers.shift() }; };
  });
  const restore = page.getByRole('button', { name: 'Restore Default Theme…' });
  assert.deepEqual(await page.locator('#picomarq-saved-themes button').allTextContents(), ['Save Theme…', 'Load Theme…', 'Restore Default Theme…']);
  await restore.click();
  await pause(500);
  assert.deepEqual(await settings(), customized);
  await restore.click();
  await page.locator('[data-theme-status]', { hasText: 'Restored the default theme.' }).waitFor();
  const dialogs = await electron.evaluate(() => global.restoreDialogs.map(({ title, message, buttons, defaultId, cancelId }) => ({ title, message, buttons, defaultId, cancelId })));
  assert.deepEqual(dialogs[0], { title: 'Restore Default Theme', message: 'Restore the default theme?', buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1 });
  const restored = await settings();
  assert.equal(restored.theme.mode, 'dark');
  assert.equal(restored.startupBehavior, 'new');
  assert.equal(restored.smartTypography, false);
  assert.deepEqual(restored.editorFont, { baseFontFamily: 'system-sans', systemFontFamily: '', baseFontSize: 15, boldWeight: 600, lineHeight: 1.6 });
  assert.equal(restored.editorWidth, 'full');
  assert.equal(restored.customEditorWidthPx, 768);
  assert.equal(restored.interfaceZoom, 1);
  assert.equal(restored.toolbarIconScale, 1);
  assert.deepEqual(restored.customColorsLight, {});
  assert.deepEqual(restored.customColorsDark, {});
  assert.equal(await page.locator('#font-size').inputValue(), '15');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--color-bg')), 'rgb(22, 20, 19)');
  console.log('PASS: Restore Default Theme asks first, then restores colors, typography and User Interface settings, keeping Dark, Startup and Smart Typography');
  assert.equal(errors.length, 0, errors.join('\n'));
}

const watchdog = setTimeout(() => { console.error('Settings checks timed out'); process.exit(1); }, 120000);
main().then(() => console.log('SETTINGS CHECKS DONE')).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (electron) { try { await electron.evaluate(({ app }) => app.exit()); } catch {} }
  virtualDisplay?.kill();
  clearTimeout(watchdog);
});
