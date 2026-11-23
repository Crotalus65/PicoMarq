// "Ignore All" in the right-click spelling menu, in the real Electron app.
// Needs a graphical session or Xvfb, and a US English dictionary (see
// tests/spelling-harness.cjs). Without one it is skipped.
//
// What it guards: every occurrence of an ignored word loses its underline and
// later ones never get one; the other misspellings keep theirs, although
// wrapping the first letter of the ignored words makes Chromium drop
// underlines near them (the last paragraph is far from the caret, where
// Chromium does not look again by itself); Chromium's background checks go on
// wherever the caret is in the document, and a recheck waits while the caret
// is in the Find panel; the list lasts through Undo, a paste, the Markdown
// source view, Replace All and Revert, and is gone when the document is
// closed; a recheck gets its turn in a window that stands still. The
// Markdown is never changed and nothing is added to the dictionary.
// Usage: node tests/ignore-smoke.cjs
const assert = require('node:assert/strict');
const { startSpellingApp, active, pause } = require('./spelling-harness.cjs');
let app;

const filler = Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} of this long paragraph says nothing of interest about the weather.`).join(' ');
const LONG = `The long paragraph begins with a seperate mistake. ${filler} It ends here`;
const DOCUMENT = `# Ignore All Check

Qarth is a walled city. The peeple of Qarth recieve few visitors, and Qarth's gates are tall.

In bold, **Qarth** counts too. Not the same word: Qarths. One definately wrong word.

${LONG}

The last paragraph has an occured error, a long way from Qarth.
`;

async function main() {
  app = await startSpellingApp({ name: 'ignore-smoke', display: process.env.SCRATCH_DISPLAY_NUMBER || '127' });
  if (!app) { console.log('SKIP: no US English dictionary (set PICOMARQ_TEST_BDIC or install hunspell-en-us)'); return; }
  const { expectMarks, watch, rightClick, choose, command, markdown, selectionState } = app;
  const file = await app.write('Ignore All Check.md', DOCUMENT);
  await app.open(file);
  const page = () => app.page;

  // Put the caret in the text block that contains `block`: at its end, or at
  // an offset into the first occurrence of `word` in it.
  const caret = (block, word, offset = 0) => page().evaluate(({ block, word, offset, active }) => {
    const editor = document.querySelector(`${active} .tiptap`).editor;
    let target = null;
    editor.state.doc.descendants((node, pos) => {
      if (target === null && node.isTextblock && node.textContent.includes(block)) target = word ? pos + 1 + node.textContent.indexOf(word) + offset : pos + node.nodeSize - 1;
      return target === null;
    });
    if (target === null) throw new Error(`No block with "${block}"`);
    editor.chain().focus().setTextSelection(target).run();
    return target;
  }, { block, word, offset, active });
  const head = () => page().evaluate(active => document.querySelector(`${active} .tiptap`).editor.state.selection.head, active);
  // The editor learns of a caret move a moment after the key (selectionchange).
  const headBecomes = async (expected, what) => {
    const start = Date.now();
    let actual;
    while ((actual = await head()) !== expected) {
      if (Date.now() - start > 1000) assert.fail(`${what}: caret at ${actual}, expected ${expected}; ${JSON.stringify(await selectionState())}`);
      await pause(20);
    }
  };

  const others = { peeple: 'red', recieve: 'red', definately: 'red', seperate: 'red', occured: 'red' };
  await expectMarks({ Qarth: 'red', "Qarth's": 'red', Qarths: 'red', ...others }, 'opened file', 10000);
  const original = await markdown();

  // 1. The menu, and Ignore All.
  const menu = await rightClick('Qarth', 1);
  const separator = menu.indexOf('-');
  assert.deepEqual(menu.slice(separator - 2, separator), ['Ignore All', 'Add to Dictionary'], `Spelling items: ${menu.join(', ')}`);
  assert(separator >= 3, `Expected suggestions or "No spelling suggestions" above Ignore All: ${menu.join(', ')}`);
  await choose('Ignore All');
  const blink = await expectMarks({ Qarth: 'ignored', "Qarth's": 'ignored', Qarths: 'red', ...others }, 'Ignore All');
  assert.equal(await markdown(), original, 'Ignore All must not change the Markdown');
  assert.equal(await page().locator('footer').innerText().then(text => text.includes('Unsaved')), false, 'Ignore All must not mark the document as changed');
  assert.deepEqual(await app.dictionaryWords(), [], 'Ignore All must not add to the dictionary');
  assert.equal(await page().locator(`${active} .tiptap [data-ignored-spelling]`).evaluateAll(wrappers => wrappers.every(wrapper => wrapper.textContent.length === 1 && wrapper.getAttribute('spellcheck') === 'false')), true, 'Only the first letter of an ignored word is wrapped');
  console.log(`PASS: Ignore All sits above Add to Dictionary; every "Qarth" (plain, bold, possessive) loses its underline, "Qarths" and the other misspellings keep theirs (back after ${blink} ms); Markdown and dictionary untouched`);

  // 2. An ignored word is no longer a misspelling in the menu, and a
  // double-click still selects all of it.
  const ignoredMenu = await rightClick('Qarth', 0);
  assert.equal(ignoredMenu.includes('Ignore All') || ignoredMenu.includes('Add to Dictionary'), false, `Menu on an ignored word: ${ignoredMenu.join(', ')}`);
  assert.equal(ignoredMenu[0], 'Bold');
  await page().keyboard.press('Escape');
  const point = await app.pointOf('Qarth', 1);
  await page().mouse.dblclick(point.x, point.y);
  await pause(200);
  assert.equal(await page().evaluate(() => document.getSelection().toString()), 'Qarth', 'A double-click should select the whole ignored word');
  console.log('PASS: the right-click menu on an ignored word has no spelling items; a double-click selects the whole word');

  // 3. Chromium stops its background checks while the caret is inside an
  // element with spell checking off. The caret is "inside" a wrapper right
  // after the first letter of an ignored word, and before that letter at the
  // start of a paragraph. The checks must go on there, and the keys must
  // work as usual.
  for (const [place, offset] of [['right after the first letter of an ignored word', 1], ['before an ignored word at the start of a paragraph', 0]]) {
    const at = await caret('walled city', 'Qarth', offset);
    await pause(300);
    const selection = await selectionState();
    assert(!selection.focus.includes('in wrapper'), `Caret ${place}: the selection should be named from outside the wrapper: ${JSON.stringify(selection)}`);
    const seen = await watch(['occured', 'definately'], () => command('recheck-spelling'), { duration: 3000 });
    assert(seen.some(sample => sample.occured?.[0] === 'plain'), `Caret ${place}: the recheck did not start`);
    assert(seen.slice(-5).every(sample => sample.occured?.[0] === 'red' && sample.definately?.[0] === 'red'), `Caret ${place}: the underlines did not come back: ${JSON.stringify(seen.slice(-3))}; ${JSON.stringify(await selectionState())}`);
    assert.equal(await head(), at, `Caret ${place}: the caret moved`);
  }
  const wordStart = await caret('walled city', 'Qarth', 0);
  for (let step = 1; step <= 5; step++) { await page().keyboard.press('ArrowRight'); await headBecomes(wordStart + step, 'Right Arrow through an ignored word'); }
  for (let step = 4; step >= 0; step--) { await page().keyboard.press('ArrowLeft'); await headBecomes(wordStart + step, 'Left Arrow through an ignored word'); }
  // Without waiting between the keys, as with a held-down arrow key.
  for (let step = 1; step <= 5; step++) await page().keyboard.press('ArrowRight');
  await headBecomes(wordStart + 5, 'Five quick Right Arrows');
  for (let step = 1; step <= 5; step++) await page().keyboard.press('ArrowLeft');
  await headBecomes(wordStart, 'Five quick Left Arrows');
  await page().keyboard.press('ArrowRight');
  await page().keyboard.type('x', { delay: 35 });
  await expectMarks({ Qxarth: 'red', peeple: 'red', recieve: 'red' }, 'a letter typed right after the first letter of an ignored word');
  await page().keyboard.press('Backspace');
  await expectMarks({ Qarth: 'ignored', "Qarth's": 'ignored', peeple: 'red', recieve: 'red', ...others }, 'the letter removed again');
  await page().keyboard.press('Home');
  await page().keyboard.type('So ', { delay: 35 });
  for (let i = 0; i < 3; i++) await page().keyboard.press('Backspace');
  await expectMarks({ Qarth: 'ignored', peeple: 'red', recieve: 'red', ...others }, 'typing before an ignored word at the start of a paragraph');
  console.log('PASS: with the caret at either edge of a wrapper the background checks go on (a full recheck completes), the arrow keys step through the word, and typing there works');

  // 4. Typing the word again in a short paragraph: no underline for it, and
  // nothing else blinks (Chromium rechecks the paragraph by itself). A typed
  // possessive, with the curly apostrophe of Smart Typography, counts too.
  await caret('One definately wrong word');
  let samples = await watch(['definately', 'occured', 'seperate'], () => page().keyboard.type(" Then Qarth fell and Qarth's peeple left", { delay: 35 }));
  assert(samples.every(s => s.occured?.every(state => state === 'red') && s.seperate?.every(state => state === 'red')), 'Underlines in other paragraphs blinked while an ignored word was typed in a short paragraph');
  assert(samples.slice(-10).every(s => s.definately?.every(state => state === 'red')), 'The misspelling in the same short paragraph lost its underline');
  await expectMarks({ Qarth: 'ignored', 'Qarth’s': 'ignored', peeple: 'red', definately: 'red' }, 'typed occurrence');
  console.log('PASS: an ignored word typed again in a short paragraph gets no underline (nor does its possessive), and no other underline is lost or blinks');

  // 5. Typing right after an ignored word, mid-paragraph.
  await caret('walled city', 'The peeple of Qarth', 'The peeple of Qarth'.length);
  samples = await watch(['recieve', 'occured'], () => page().keyboard.type(' still', { delay: 35 }));
  assert(samples.every(s => s.occured?.every(state => state === 'red')), 'Underlines in other paragraphs blinked while typing after an ignored word');
  assert(samples.every(s => s.recieve?.every(state => state === 'red')), 'The underline later in the paragraph was lost while typing after an ignored word');
  await expectMarks({ Qarth: 'ignored', peeple: 'red', recieve: 'red' }, 'typing after an ignored word');
  console.log('PASS: typing right after an ignored word keeps the underlines later in the paragraph');

  // 6. The same in a long paragraph, where Chromium only rechecks near the
  // caret: the editor asks for a full recheck once typing has paused.
  await caret('It ends here');
  await page().keyboard.type(' in Qarth', { delay: 35 });
  const healed = await expectMarks({ Qarth: 'ignored', seperate: 'red', ...others }, 'long paragraph');
  console.log(`PASS: in a 2,600-character paragraph the far misspelling has its underline again ${healed} ms after an ignored word was typed`);

  // 7. An ignored word that is edited is a different word; Undo brings the ignored one back.
  await caret('The last paragraph');
  await page().keyboard.type(' Qarth', { delay: 35 });
  await page().keyboard.press('Backspace');
  await page().keyboard.type(' ', { delay: 35 });
  await expectMarks({ Qart: 'red', occured: 'red' }, 'ignored word edited into another word');
  await page().keyboard.press('Backspace');
  await page().keyboard.type('h', { delay: 35 });
  await expectMarks({ Qarth: 'ignored', occured: 'red' }, 'word completed again');
  await page().keyboard.press('Control+z');
  await page().keyboard.press('Control+z');
  await page().keyboard.press('Control+y');
  await expectMarks({ Qarth: 'ignored', ...others }, 'Undo and Redo');
  console.log('PASS: an edited occurrence is checked again as a new word; Undo and Redo keep the other underlines');

  // 8. A paste, the Markdown source view, and a second ignored word.
  await app.electron.evaluate(({ clipboard }) => clipboard.writeText('Pasted: Qarth is far, and tommorow is another day.'));
  await page().keyboard.press('Control+End');
  await page().keyboard.press('Enter');
  await page().keyboard.press('Control+V');
  await expectMarks({ Qarth: 'ignored', tommorow: 'red', ...others }, 'paste');
  await command('source');
  const textarea = page().locator(`${active} textarea`);
  await textarea.waitFor();
  await textarea.evaluate(t => { t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
  await page().keyboard.type('\n\nFrom the source view: Qarth and an embarass error.');
  await command('source');
  await page().waitForSelector(`${active} .tiptap`, { state: 'visible' });
  await expectMarks({ Qarth: 'ignored', embarass: 'red', tommorow: 'red', ...others }, 'back from the Markdown source view');
  await rightClick('peeple', 0);
  await choose('Ignore All');
  await expectMarks({ Qarth: 'ignored', peeple: 'ignored', recieve: 'red', definately: 'red', seperate: 'red', occured: 'red' }, 'second ignored word');
  console.log('PASS: the list holds through a paste and the Markdown source view, and takes a second word');

  // 9. A change made from the Find panel, next to an ignored word, also needs
  // a full recheck. It must wait until the caret is back in the document:
  // Chromium checks only the text that holds the caret, so with the caret in
  // the Replace box it would clear every underline and bring none back.
  await command('replace');
  const replaceBox = page().getByPlaceholder('Replace with...');
  await page().getByPlaceholder('Find in note...').fill('Qarth is far');
  await replaceBox.fill('Qarth was far');
  const elsewhere = ['recieve', 'definately', 'seperate', 'occured'];
  samples = await watch(elsewhere, () => replaceBox.press('Control+Enter'), { duration: 3000 });
  assert((await markdown()).includes('Qarth was far'), 'Replace All should have changed the text');
  assert(samples.every(s => elsewhere.every(word => s[word]?.every(state => state === 'red'))), `Underlines disappeared while the caret was in the Replace box: ${JSON.stringify(samples.find(s => !elsewhere.every(word => s[word]?.every(state => state === 'red'))))}`);
  await page().keyboard.press('Escape');
  await expectMarks({ Qarth: 'ignored', peeple: 'ignored', tommorow: 'red', embarass: 'red', recieve: 'red', definately: 'red', seperate: 'red', occured: 'red' }, 'back in the document after Replace All');
  console.log('PASS: after Replace All next to an ignored word the underlines stay while the caret is in the Find panel, and the document is rechecked when the caret returns');

  // 10. Revert to Saved reloads the file in the same window: the list stays.
  await app.answer(0);
  await command('revert');
  await page().waitForFunction(active => !document.querySelector(`${active} .tiptap`)?.textContent.includes('tommorow'), active, { timeout: 10000 });
  await expectMarks({ Qarth: 'ignored', "Qarth's": 'ignored', peeple: 'ignored', Qarths: 'red', recieve: 'red', definately: 'red', seperate: 'red', occured: 'red' }, 'after Revert to Saved', 10000);
  assert.equal(await markdown(), original, 'Revert should restore the saved Markdown');
  console.log('PASS: Revert to Saved keeps the ignored words of the open document');

  // 11. Closing the document forgets them.
  await app.win.evaluate(window => window.close());
  await pause(800);
  await app.open(file);
  await expectMarks({ Qarth: 'red', "Qarth's": 'red', Qarths: 'red', ...others }, 'reopened document', 10000);
  console.log('PASS: after the document is closed and opened again, the words are underlined again');

  // 12. A recheck gets its turn in a window that stands still. With text
  // selected there is no blinking caret and nothing is drawn, and Chromium
  // then sometimes left its whole-document check undone: in 1.3.1 about
  // four rechecks in ten waited for the mouse to move. So the editor asks
  // for frames while a recheck is due; that is counted here. The window is
  // left alone meanwhile (no questions to the page, no screen capture) and
  // then looked at once.
  await page().evaluate(() => {
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { window.__frames++; return request.call(window, callback); };
  });
  for (let round = 1; round <= 4; round++) {
    await page().evaluate(active => {
      const editor = document.querySelector(`${active} .tiptap`).editor;
      let from = null;
      editor.state.doc.descendants((node, pos) => { if (from === null && node.isText && node.text.includes('walled city')) from = pos + node.text.indexOf('walled city'); });
      editor.chain().focus().setTextSelection({ from, to: from + 6 }).run();
    }, active);
    await page().waitForFunction(active => document.activeElement === document.querySelector(`${active} .tiptap`), active);
    await pause(500);
    await page().evaluate(() => { window.__frames = 0; });
    await command('recheck-spelling');
    await pause(2600);
    const frames = await page().evaluate(() => window.__frames);
    assert(frames >= 40, `Round ${round}: only ${frames} frames were asked for while the recheck was due`);
    const states = app.byWord(await app.marks(Object.keys(others)));
    assert(Object.values(states).every(list => list.every(state => state === 'red')), `Round ${round}: 2.6 s after a recheck in a still window the red lines are not all back: ${app.describe(await app.marks(Object.keys(others)))}`);
  }
  console.log('PASS: a recheck completes in a window that stands still with text selected (4 times)');
  assert.equal(app.errors.length, 0, app.errors.join('\n'));
}

const watchdog = setTimeout(() => { console.error('Ignore All checks timed out'); process.exit(1); }, 300000);
main().then(() => console.log('IGNORE ALL CHECKS DONE')).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await app?.stop();
  clearTimeout(watchdog);
});
