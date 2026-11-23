// The status bar's "x of n words" in the real Electron app: selections made
// with the mouse and the keyboard in the formatted view (words, paragraphs,
// everything, table cells, a rule), typing over a selection, and selections in
// Markdown source view, short and long. Needs a graphical session or Xvfb.
// Usage: node tests/word-count-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const work = path.join(__dirname, 'tmp', 'word-count-smoke');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let virtualDisplay;
let electron;
let page;
const errors = [];

// 2 + 9 + 10 + 4 + 4 + 0 (rule) + 3 = 32 words.
const DOCUMENT = `# Field notes

The quick brown fox jumps over the lazy dog.

Second paragraph with **bold words** and a [linked phrase](https://example.com/hidden-address) inside.

- First item
- Second item

| Name | Role |
| --- | --- |
| Ada | Writer |

---

Last line here.
`;
const LONG_PARAGRAPHS = 600; // seven words each, about 27,000 characters in all
const LONG_DOCUMENT = Array.from({ length: LONG_PARAGRAPHS }, (_, i) => `Paragraph ${i + 1} has exactly seven words here.`).join('\n\n') + '\n';

const active = '[data-document-id][aria-hidden="false"]';
const label = (total, selected = null) => {
  const words = `${total.toLocaleString()} ${total === 1 ? 'word' : 'words'}`;
  return selected === null ? words : `${selected.toLocaleString()} of ${words}`;
};
async function expectCount(total, selected, step) {
  const expected = label(total, selected);
  const start = Date.now();
  let shown;
  while (Date.now() - start < 8000) {
    shown = await page.locator('[data-word-count]').innerText();
    if (shown === expected) return;
    await pause(50);
  }
  assert.equal(shown, expected, step);
}
async function dispatch(action) {
  const win = await electron.browserWindow(page);
  await win.evaluate((window, action) => window.webContents.send('scratch:command', { action }), action);
}
// Where a piece of text is on screen in the formatted view.
async function rectNow(text) {
  const rect = await page.evaluate(({ text, active }) => {
    const walker = document.createTreeWalker(document.querySelector(`${active} .tiptap`), NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const index = node.data.indexOf(text);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, y: r.top + r.height / 2, x: r.left + r.width / 2 };
    }
    return null;
  }, { text, active });
  assert(rect, `"${text}" is not in the formatted view`);
  return rect;
}
// A person pauses between gestures, and aims at text that has stopped moving
// (the toolbar slides open after leaving source view). The editor
// (ProseMirror) also ignores selection changes for 50 ms after it has redrawn
// a selection in Chromium, so a script's immediate next click would be lost.
async function rectOf(text) {
  await pause(200);
  let rect = await rectNow(text);
  for (let i = 0; i < 40; i++) {
    await pause(60);
    const next = await rectNow(text);
    if (next.x === rect.x && next.y === rect.y) return next;
    rect = next;
  }
  throw new Error(`"${text}" did not stop moving`);
}
const selectedText = () => page.evaluate(() => window.getSelection().toString());
async function doubleClick(word) {
  const r = await rectOf(word);
  await page.mouse.dblclick(r.x, r.y);
  await page.waitForFunction(word => window.getSelection().toString().trim() === word, word, { timeout: 5000 }).catch(async () => { throw new Error(`Double-click on "${word}" selected ${JSON.stringify(await selectedText())}`); });
}
async function clickBefore(text) { const r = await rectOf(text); await page.mouse.click(r.left + 1, r.y); }
const source = () => page.locator(`${active} textarea`);
async function toSource() { await dispatch('source'); await source().waitFor(); }
// After the switch the editor places the caret and scrolls on the next
// frames; keys pressed in that instant (as only a script can) are overridden.
async function toFormatted() { await dispatch('source'); await page.locator(`${active} .tiptap`).waitFor({ state: 'visible' }); await pause(500); }
// Select the first occurrence of a piece of the Markdown source, as Find does.
async function selectSource(text, length = text.length) {
  await source().evaluate((el, { text, length }) => {
    const start = el.value.indexOf(text);
    if (start < 0) throw new Error(`"${text}" is not in the source`);
    el.focus();
    el.setSelectionRange(start, start + length);
  }, { text, length });
}

// Where a character of the first source lines is on screen (the source view
// uses a fixed-width font, and these lines do not wrap). The text box moves up
// when the toolbar closes after entering source view, so wait until it rests.
async function sourcePoint(line, column) {
  await pause(200);
  let point = await sourcePointNow(line, column);
  for (let i = 0; i < 40; i++) {
    await pause(60);
    const next = await sourcePointNow(line, column);
    if (next.x === point.x && next.y === point.y) return next;
    point = next;
  }
  throw new Error('The source view did not stop moving');
}
function sourcePointNow(line, column) {
  return source().evaluate((el, { line, column }) => {
    const style = getComputedStyle(el);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontSize} ${style.fontFamily}`;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + parseFloat(style.paddingLeft) + context.measureText('M').width * column,
      y: rect.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) * (line + 0.5) - el.scrollTop,
    };
  }, { line, column });
}
const sourceSelection = () => source().evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd));
async function expectSourceSelection(expected, step) {
  const start = Date.now();
  let selected;
  while (Date.now() - start < 5000) {
    selected = (await sourceSelection()).trim();
    if (selected === expected) return;
    await pause(50);
  }
  assert.equal(selected, expected, step);
}
// Select the whole source line that contains a piece of text.
async function selectSourceLine(text) {
  return source().evaluate((el, text) => {
    const at = el.value.indexOf(text);
    if (at < 0) throw new Error(`"${text}" is not in the source`);
    const start = el.value.lastIndexOf('\n', at) + 1;
    const end = el.value.indexOf('\n', at);
    el.focus();
    el.setSelectionRange(start, end < 0 ? el.value.length : end);
    return el.value.slice(el.selectionStart, el.selectionEnd);
  }, text);
}

async function main() {
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(path.join(work, 'data'), { recursive: true });
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const binary = process.env.SCRATCH_XVFB || 'Xvfb';
    const display = process.env.SCRATCH_DISPLAY_NUMBER || '126';
    virtualDisplay = spawn(binary, [':' + display, '-screen', '0', '1440x1000x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { env: process.env, stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + display;
    await pause(500);
  }
  electron = await _electron.launch({ executablePath: require('electron'), args: process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', root] : [root], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: path.join(work, 'data') }, timeout: 20000 });
  page = await electron.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector(`${active} .tiptap`, { timeout: 15000 });
  const win = await electron.browserWindow(page);
  await win.evaluate(window => { window.setBounds({ x: 0, y: 0, width: 1300, height: 900 }); window.focus(); });
  await expectCount(0, null, 'empty document');

  await toSource();
  await source().fill(DOCUMENT);
  await expectCount(32, null, 'source view, nothing selected');
  await toFormatted();
  await page.locator(`${active} .tiptap table`).waitFor();
  await expectCount(32, null, 'formatted view, nothing selected');

  // Formatted view: mouse and keyboard selections.
  await doubleClick('quick');
  await expectCount(32, 1, 'one word double-clicked');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.keyboard.press('Control+Shift+ArrowRight');
  assert.equal((await selectedText()).trim(), 'quick brown fox');
  await expectCount(32, 3, 'selection extended by two words');
  const second = await rectOf('Second paragraph');
  await page.mouse.click(second.x, second.y, { clickCount: 3 });
  await expectCount(32, 10, 'a paragraph triple-clicked: bold and linked words counted, the link address not');
  await page.keyboard.press('Control+A');
  await expectCount(32, 32, 'everything selected');
  await clickBefore('jumps');
  await expectCount(32, null, 'a click removes the selection');
  // A drag is counted while it grows, before the mouse button is released.
  const phrase = await rectOf('quick brown fox');
  const oneWord = await rectNow('quick');
  await page.mouse.move(phrase.left, phrase.y);
  await page.mouse.down();
  await page.mouse.move(oneWord.right, phrase.y, { steps: 6 });
  await expectCount(32, 1, 'one word dragged over, mouse button still down');
  await page.mouse.move(phrase.right, phrase.y, { steps: 6 });
  await expectCount(32, 3, 'three words dragged over, mouse button still down');
  await page.mouse.up();
  assert.equal(await selectedText(), 'quick brown fox');
  await expectCount(32, 3, 'the dragged selection');
  await clickBefore('jumps');
  await expectCount(32, null, 'a click removes the selection again');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await selectedText(), 'ju');
  await expectCount(32, 1, 'part of a word is one word');
  await clickBefore('Last line');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ArrowLeft');
  assert.equal(await selectedText(), '.');
  await expectCount(32, 0, 'a selected period is text without words');
  await page.keyboard.press('ArrowRight');
  await expectCount(32, null, 'the caret alone');
  // From the title down through the first paragraph with the keyboard.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+End');
  await expectCount(32, 11, 'title and first paragraph selected with Shift+arrows');
  // A horizontal rule is selected as an object: no text.
  await pause(200);
  await page.locator(`${active} .tiptap hr`).click();
  await page.locator(`${active} .tiptap hr.ProseMirror-selectednode`).waitFor();
  await expectCount(32, null, 'a selected rule has no text');
  // Table cells dragged over.
  const first = await rectOf('Name');
  const last = await rectOf('Writer');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(active => document.querySelectorAll(`${active} .tiptap .selectedCell`).length === 4, active);
  await expectCount(32, 4, 'four table cells selected');
  console.log('PASS: formatted view shows "x of n words" for mouse and keyboard selections, table cells, and none for a caret or a rule');

  // Typing over a selection, and formatting one.
  await doubleClick('lazy');
  await expectCount(32, 1, 'word to replace');
  await page.keyboard.type('sleepy old ');
  await expectCount(33, null, 'typing over the selection updates the total and drops the selected count');
  await clickBefore('brown fox');
  for (let i = 0; i < 'brown fox'.length; i++) await page.keyboard.press('Shift+ArrowRight');
  await expectCount(33, 2, 'two words selected');
  await page.keyboard.press('Control+B');
  await page.locator(`${active} .tiptap strong`, { hasText: 'brown fox' }).waitFor();
  await expectCount(33, 2, 'the selection is kept after Bold');
  console.log('PASS: typing over a selection and formatting it keep the count right');

  // Markdown source view: its own selection.
  await toSource();
  await expectCount(33, null, 'source view opens with a caret, whatever was selected before');
  await page.keyboard.press('Control+A');
  await expectCount(33, 33, 'everything selected in source view');
  await page.keyboard.press('Control+Home');
  await expectCount(33, null, 'caret at the top');
  await page.keyboard.press('Shift+End');
  assert.equal(await sourceSelection(), '# Field notes');
  await expectCount(33, 2, 'a heading line: the # is not a word');
  // The mouse: a double-clicked word, then a drag that is counted while it grows.
  const inField = await sourcePoint(0, 4.5);
  await page.mouse.dblclick(inField.x, inField.y);
  await expectSourceSelection('Field', 'double-click in source view');
  await expectCount(33, 1, 'a word double-clicked in source view');
  // Remove the selection first: pressing the mouse on selected text would drag the text.
  await page.keyboard.press('End');
  await expectCount(33, null, 'caret at the end of the line');
  const fieldStart = await sourcePoint(0, 2);
  const fieldEnd = await sourcePoint(0, 7);
  const lineEnd = await sourcePoint(0, 13.4);
  await pause(400);
  await page.mouse.move(fieldStart.x, fieldStart.y);
  await page.mouse.down();
  await page.mouse.move(fieldEnd.x, fieldEnd.y, { steps: 6 });
  await expectSourceSelection('Field', 'drag over one word');
  await expectCount(33, 1, 'one word, with the mouse button still down');
  await page.mouse.move(lineEnd.x, lineEnd.y, { steps: 6 });
  await expectSourceSelection('Field notes', 'drag over two words');
  await expectCount(33, 2, 'two words, with the mouse button still down');
  await page.mouse.up();
  await expectCount(33, 2, 'the dragged selection');
  await selectSource('Second paragraph with **bold words** and a [linked phrase](https://example.com/hidden-address) inside.');
  await expectCount(33, 10, 'markers and the link address are not counted');
  await selectSource('**bold', 2);
  await expectCount(33, 0, 'two asterisks are text without words');
  assert.match(await selectSourceLine('Ada'), /^\| Ada +\| Writer +\|$/);
  await expectCount(33, 2, 'a table row');
  await page.keyboard.press('ArrowRight');
  await expectCount(33, null, 'caret again');
  // Find selects its match in the source view.
  await dispatch('find');
  await page.getByPlaceholder('Find in note...').fill('sleepy old');
  await page.waitForFunction(active => { const el = document.querySelector(`${active} textarea`); return el.value.slice(el.selectionStart, el.selectionEnd) === 'sleepy old'; }, active);
  await expectCount(33, 2, 'the match that Find selected');
  await page.getByRole('button', { name: 'Close (Esc)', exact: true }).click();
  await source().press('ArrowLeft');
  await expectCount(33, null, 'Find closed, caret');
  console.log('PASS: source view counts the selected Markdown as the formatted view would, for keyboard, mouse, script and Find selections');

  // A long document: selections above the size that is counted at once.
  const total = LONG_PARAGRAPHS * 7;
  await source().fill(LONG_DOCUMENT);
  await expectCount(total, null, 'long document');
  await page.keyboard.press('Control+A');
  await expectCount(total, total, 'everything selected in a long source');
  await source().evaluate((el) => {
    const start = el.value.indexOf('Paragraph 101 ');
    el.setSelectionRange(start, el.value.length);
  });
  await expectCount(total, total - 700, 'a long partial selection');
  await selectSource('Paragraph 300 has exactly seven words here.');
  await expectCount(total, 7, 'a short selection in a long source');
  await source().press('ArrowRight');
  await expectCount(total, null, 'caret');
  await toFormatted();
  await expectCount(total, null, 'back in the formatted view');
  await page.keyboard.press('Control+A');
  await expectCount(total, total, 'everything selected in a long formatted document');
  await page.keyboard.press('ArrowLeft');
  await expectCount(total, null, 'caret');
  console.log('PASS: long selections in both views');
  assert.equal(errors.length, 0, errors.join('\n'));
}

const watchdog = setTimeout(() => { console.error('Word count checks timed out'); process.exit(1); }, 150000);
main().then(() => console.log('WORD COUNT CHECKS DONE')).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (electron) { try { await electron.evaluate(({ app }) => app.exit()); } catch {} }
  virtualDisplay?.kill();
  clearTimeout(watchdog);
});
