// Desktop checks for smart typography, the Heading 4 style, and the settings
// layout. Runs the real Electron app; needs a graphical session or Xvfb.
// Usage: node tests/typography-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const work = path.join(__dirname, 'tmp', 'typography-smoke');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const LDQ = '“', RDQ = '”', LSQ = '‘', RSQ = '’', EM = '—', ELL = '…';
let electron;
let page;
const errors = [];
const active = () => page.locator('[data-document-id][aria-hidden="false"]');
const rich = () => active().locator('.tiptap');
const source = () => active().getByRole('textbox', { name: 'Markdown source' });
async function until(test, message, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await test()) return; await pause(100); }
  throw new Error(message);
}
async function dispatch(action, extra = {}) {
  await electron.evaluate(({ BrowserWindow }, command) => BrowserWindow.getAllWindows()[0].webContents.send('scratch:command', command), { action, ...extra });
}
async function editMenuItem(label) {
  // Click the native Edit menu item through its real handler.
  await electron.evaluate(({ BrowserWindow, Menu }, label) => {
    const item = Menu.getApplicationMenu().getMenuItemById('edit').submenu.items.find(item => (item.label || '').replaceAll('&', '') === label);
    if (!item) throw new Error(`Missing Edit menu item: ${label}`);
    const win = BrowserWindow.getAllWindows()[0];
    item.click(item, win, win.webContents);
  }, label);
}
async function richText() { return rich().evaluate(el => el.innerText); }
async function setSmartTypography(on) {
  await dispatch('settings');
  const toggle = page.getByRole('switch', { name: 'Smart Typography' });
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'), String(on));
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
}

async function main() {
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(path.join(work, 'data'), { recursive: true });
  electron = await _electron.launch({ executablePath: require('electron'), args: process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', root] : [root], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: path.join(work, 'data') }, timeout: 20000 });
  page = await electron.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector('[data-document-id][aria-hidden="false"] .tiptap', { timeout: 15000 });

  // Settings layout: toggle under Typography, interface controls under their own heading.
  await dispatch('settings');
  await page.getByRole('heading', { name: 'User Interface' }).waitFor();
  const sectionOf = async label => page.getByLabel(label, { exact: true }).evaluate(el => el.closest('section').querySelector('h2').textContent);
  assert.equal(await sectionOf('Page Width'), 'User Interface');
  assert.equal(await sectionOf('Icon Size'), 'User Interface');
  assert.equal(await page.getByText('Text Zoom', { exact: true }).evaluate(el => el.closest('section').querySelector('h2').textContent), 'User Interface');
  assert.equal(await page.getByRole('switch', { name: 'Smart Typography' }).evaluate(el => el.closest('section').querySelector('h2').textContent), 'Typography');
  assert.equal(await page.getByRole('switch', { name: 'Smart Typography' }).getAttribute('aria-checked'), 'true', 'Smart typography should start on');
  await page.getByRole('button', { name: 'Back to document', exact: true }).click();
  console.log('PASS: settings layout (Typography toggle, User Interface section)');

  // Heading 4 (since 1.2.6): bold like the other headings, not italic, sized
  // between Heading 3 and body text.
  await rich().click();
  await page.keyboard.type('### Three');
  await page.keyboard.press('Enter');
  await page.keyboard.type('#### Four');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body text');
  await rich().locator('h4').waitFor();
  const styles = await rich().evaluate(el => ['h3', 'h4', 'p'].map(tag => { const css = getComputedStyle(el.querySelector(tag)); return { size: parseFloat(css.fontSize), weight: css.fontWeight, style: css.fontStyle }; }));
  assert(styles[0].size > styles[1].size && styles[1].size > styles[2].size, `Heading 4 size ${styles[1].size} should be between ${styles[0].size} and ${styles[2].size}`);
  assert.equal(styles[1].style, 'normal');
  assert.equal(styles[1].weight, '600');
  console.log('PASS: Heading 4 is bold, not italic, between Heading 3 and body text');

  // As-you-type rules in the formatted view.
  await page.keyboard.press('Enter');
  await page.keyboard.type(`"Hello," she said -- "it's Ruth's book..." ('quoted')`);
  await until(async () => (await richText()).includes(`${LDQ}Hello,${RDQ} she said ${EM} ${LDQ}it${RSQ}s Ruth${RSQ}s book${ELL}${RDQ} (${LSQ}quoted${RSQ})`), 'Typed text was not converted in the formatted view');
  await page.keyboard.press('Enter');
  await page.keyboard.type('---');
  await rich().locator('hr').waitFor();
  await page.keyboard.type('a---b');
  await until(async () => (await richText()).includes('a---b'), 'Three hyphens mid-text should be given back');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  await rich().locator('pre').waitFor();
  await page.keyboard.type('code "x" -- y...');
  await until(async () => (await richText()).includes('code "x" -- y...'), 'Code blocks must stay literal');
  console.log('PASS: curly quotes, em dash, ellipsis, horizontal rule, and literal code while typing in the formatted view');

  // Toggle off: nothing converts.
  await setSmartTypography(false);
  await rich().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(`off "plain" -- ...`);
  await pause(300);
  assert((await richText()).includes(`off "plain" -- ...`), 'Toggle off should leave text literal');
  await setSmartTypography(true);
  console.log('PASS: Settings toggle turns the rules off and on');

  // Source view typing.
  await dispatch('source');
  await source().waitFor();
  await source().focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(`src "quote" it's -- fine... ---`);
  await until(async () => (await source().inputValue()).includes(`src ${LDQ}quote${RDQ} it${RSQ}s ${EM} fine${ELL} ---`), 'Source view typing was not converted');
  await page.keyboard.press('Enter');
  await page.keyboard.type('`code "x"`');
  await until(async () => (await source().inputValue()).includes('`code "x"`'), 'Inline code in source view must stay literal');
  // Ctrl+Z gives the typed characters back (native undo stack).
  await page.keyboard.press('Enter');
  await page.keyboard.type('undo "');
  await until(async () => (await source().inputValue()).includes(`undo ${LDQ}`), 'quote not converted before undo');
  await page.keyboard.press('Control+z');
  await until(async () => (await source().inputValue()).includes('undo "'), 'Ctrl+Z should restore the straight quote');
  console.log('PASS: source view typing converts, skips inline code, keeps three hyphens, and undoes');

  // Whole-document conversion in source view.
  const literal = ['# "Title"', '', `Ruth's "draft" -- see...`, '', '```', 'keep "this" -- ...', '```', '', '| A | B |', '| -- | --- |', '| "x" | y |', '', '[link "t"](http://e.com/a--b "title")', ''].join('\n');
  await source().fill(literal);
  await pause(400);
  await editMenuItem('Apply Smart Typography');
  const expected = ['# “Title”', '', `Ruth’s “draft” — see…`, '', '```', 'keep "this" -- ...', '```', '', '| A | B |', '| -- | --- |', '| “x” | y |', '', '[link “t”](http://e.com/a--b "title")', ''].join('\n');
  await until(async () => (await source().inputValue()) === expected, 'Apply Smart Typography did not convert the source view as expected');
  await page.getByText('Smart typography: 11 changes.').last().waitFor();
  await source().focus();
  await page.keyboard.press('Control+z');
  await until(async () => (await source().inputValue()) === literal, 'Ctrl+Z should undo the whole conversion in source view');
  console.log('PASS: Edit > Apply Smart Typography in source view (code, tables, link targets untouched; single undo)');

  // Whole-document conversion in the formatted view.
  await dispatch('source');
  await rich().waitFor();
  await editMenuItem('Apply Smart Typography');
  await until(async () => { const t = await richText(); return t.includes(`${LDQ}Title${RDQ}`) && t.includes(`Ruth${RSQ}s ${LDQ}draft${RDQ} ${EM} see${ELL}`) && t.includes('keep "this" -- ...') && t.includes(`${LDQ}x${RDQ}`); }, 'Apply Smart Typography did not convert the formatted view');
  await page.getByText('Smart typography: 11 changes.').last().waitFor();
  await editMenuItem('Apply Smart Typography');
  await page.getByText('Nothing to convert', { exact: false }).last().waitFor();
  await rich().click();
  await page.keyboard.press('Control+z');
  await until(async () => (await richText()).includes(`Ruth's "draft" -- see...`), 'Ctrl+Z should undo the formatted conversion');
  // Saved Markdown keeps code and link targets literal after conversion.
  await editMenuItem('Apply Smart Typography');
  await page.getByText('Smart typography: 11 changes.').last().waitFor();
  await dispatch('source');
  await source().waitFor();
  const saved = await source().inputValue();
  assert(saved.includes('keep "this" -- ...') && saved.includes('(http://e.com/a--b "title")') && saved.includes(`Ruth’s “draft” — see…`), `Unexpected Markdown after conversion:\n${saved}`);
  console.log('PASS: Edit > Apply Smart Typography in the formatted view, idempotent, undoable, Markdown preserved');

  assert.deepEqual(errors, [], 'Renderer errors');
  console.log('ALL PASSED');
}

main().then(() => electron.process().kill('SIGKILL')).catch(async error => {
  console.error(error);
  if (page) try { console.error('Formatted text:\n' + await richText()); } catch {}
  if (electron) electron.process().kill('SIGKILL');
  process.exit(1);
});
