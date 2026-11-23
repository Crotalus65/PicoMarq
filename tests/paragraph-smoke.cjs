// Red lines in long paragraphs, in the real app (Electron with a US English
// dictionary), read off the screen like tests/ignore-smoke.cjs.
//
// What it guards. Chromium rechecks by itself only around the caret: a whole
// paragraph of up to 1,024 characters, otherwise 512 characters either side.
// Through 1.3.2 a paragraph longer than that lost its red lines away from
// the caret whenever the editor changed text itself: Smart Typography
// putting in a curly apostrophe, Undo, Bold, Italic, a paragraph split.
// Now (1) the editor changes only the characters that differ, so typing with
// Smart Typography and Undo of typing lose nothing, and (2) after changes
// that rebuild text, the editor asks for a whole-document check that leaves
// the other red lines in place. The filler that check works with must not
// show anywhere: not in the text, the saved file, a copy, or at the caret.
//
// Run with: npm run test:paragraph. Needs a dictionary: see tests/spelling-smoke.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startSpellingApp, active, pause } = require('./spelling-harness.cjs');

const sentence = 'The road went on through the hills and the travelers kept walking toward the far city. ';
// The long paragraph: 1,672 characters. Its two misspellings are 800
// characters before and 820 characters after the word MIDDLE.
const LONG = `# The Heading has a mispelled word

First paragraph: a recieve error at the start.

Longstart has an acommodate error. ${sentence.repeat(9)}MIDDLE of the paragraph is here. ${sentence.repeat(9)}There is an embarass error at the end.

Third paragraph: a wierd word.
`;
const WORDS = ['mispelled', 'recieve', 'acommodate', 'embarass', 'wierd'];
const QUOTED = `# The Heading has a mispelled word

"Quoted at the start," she said. ${sentence.repeat(8)}Here is an acommodate error. ${sentence.repeat(8)}And it ends with "a quotation."

Third paragraph: a wierd word.
`;
const SHORT = `# The Heading has a mispelled word

Second paragraph: a seperate mistake, then plain words, and an occured error.

Third paragraph: a wierd word.
`;

(async () => {
  const watchdog = setTimeout(() => { console.error('Paragraph test timed out'); process.exit(1); }, 420000);
  const app = await startSpellingApp({ name: 'paragraph', display: process.env.SCRATCH_DISPLAY_NUMBER || '131' });
  const key = name => app.page.keyboard.press(name);
  const type = text => app.page.keyboard.type(text, { delay: 40 });
  const red = words => Object.fromEntries(words.map(word => [word, 'red']));
  const inEditor = () => app.page.waitForFunction(active => document.activeElement === document.querySelector(`${active} .tiptap`), active);
  const select = async (passage, offset, length = 0) => {
    await app.page.evaluate(({ active, passage, offset, length }) => {
      const editor = document.querySelector(`${active} .tiptap`).editor;
      let from = null;
      editor.state.doc.descendants((node, pos) => { if (from === null && node.isText && node.text.includes(passage)) from = pos + node.text.indexOf(passage) + offset; });
      if (from === null) throw new Error(`not in the document: ${passage}`);
      editor.chain().focus().setTextSelection({ from, to: from + length }).run();
    }, { active, passage, offset, length });
    await inEditor();
    await pause(250);
  };
  const open = async (name, text, words) => {
    await app.open(await app.write(name, text));
    await app.expectMarks(red(words), `${name}: opened`, 12000);
  };
  // Every look at the screen while `during` runs and for a while after: these
  // words red each time. One look alone does not count as lost: when a line
  // of text moves (Enter, a word made bold), a look can catch the picture of
  // the moment before. A red line that blinks is away for about a second,
  // which is fifteen looks.
  const neverLost = async (words, during, label, duration = 1800) => {
    const samples = await app.watch(words, during, { duration });
    assert(samples.length > 10, `${label}: only ${samples.length} looks at the screen`);
    const lostIn = sample => words.filter(word => !(sample[word] || []).length || sample[word].some(state => state !== 'red'));
    samples.forEach((sample, index) => {
      const next = samples[index + 1];
      const lost = lostIn(sample).filter(word => !next || lostIn(next).includes(word));
      assert.equal(lost.length, 0, `${label}: red line lost under ${lost.join(', ')} (looks ${index + 1} and ${index + 2} of ${samples.length})`);
    });
  };

  // 1. Typing with Smart Typography in a long paragraph: the conversions
  // rewrite one or two characters, and no red line anywhere goes away.
  await open('Long typing.md', LONG, WORDS);
  for (const [name, text] of [['an apostrophe', "don't "], ['a quotation mark', '"'], ['two hyphens', '--'], ['three periods', '...']]) {
    await select('of the paragraph is here', 0);
    await neverLost(WORDS, () => type(text), `Typing ${name} in a long paragraph`);
  }
  const typed = await app.markdown();
  assert(typed.includes('don’t') && typed.includes('“') && typed.includes('—') && typed.includes('…'), 'Smart Typography did not convert what was typed');
  console.log('PASS: an apostrophe, a quotation mark, two hyphens and three periods typed in a long paragraph cost no red line');

  // 2. Undo of typing, and Backspace taking a conversion back.
  await select('of the paragraph is here', 0);
  await neverLost(WORDS, async () => { await type('some words '); await pause(300); await key('Control+z'); }, 'Typing and Undo in a long paragraph');
  await select('of the paragraph is here', 0);
  await neverLost(WORDS, async () => { await type('--'); await pause(200); await key('Backspace'); }, 'A conversion taken back with Backspace');
  console.log('PASS: Undo of typing and a conversion taken back cost no red line');
  await app.win.evaluate(window => window.destroy());

  // 3. Formatting a word rebuilds the text after it. That red line comes
  // back by itself; the others never go.
  await open('Long formatting.md', LONG, WORDS);
  const others = WORDS.filter(word => word !== 'embarass');
  for (const [name, shortcut] of [['Bold', 'Control+b'], ['Italic', 'Control+i']]) {
    await select('MIDDLE', 0, 6);
    await neverLost(others, () => key(shortcut), `${name} in a long paragraph`, 2600);
    await app.expectMarks(red(WORDS), `${name} in a long paragraph: the red line after the word`, 1500);
  }
  console.log('PASS: Bold and Italic in a long paragraph: the red line after the word comes back, the others stay');

  // 4. A paragraph split and joined again, and Undo of the join.
  await select(' of the paragraph is here', 0);
  await neverLost(['mispelled', 'recieve', 'wierd'], () => key('Enter'), 'Enter in a long paragraph', 2600);
  await app.expectMarks(red(WORDS), 'Enter in a long paragraph', 1500);
  await neverLost(['mispelled', 'recieve', 'wierd'], () => key('Backspace'), 'Joining the paragraph again', 2600);
  await app.expectMarks(red(WORDS), 'Joining the paragraph again', 1500);
  await neverLost(['mispelled', 'recieve', 'wierd'], () => key('Control+z'), 'Undo of the join', 2600);
  await app.expectMarks(red(WORDS), 'Undo of the join', 1500);
  console.log('PASS: Enter in the middle of a long paragraph, joining it again, and Undo: every red line is back, the others stay');
  await app.win.evaluate(window => window.destroy());

  // 5. Edit > Apply Smart Typography changes a text at both ends; the red
  // line in between comes back. The caret is far away, in the heading.
  const quotedWords = ['mispelled', 'acommodate', 'wierd'];
  await open('Quoted.md', QUOTED, quotedWords);
  await select('The Heading', 0);
  await neverLost(['mispelled', 'wierd'], () => app.command('smart-typography'), 'Apply Smart Typography', 2600);
  await app.expectMarks(red(quotedWords), 'Apply Smart Typography', 1500);
  assert(!(await app.markdown()).includes('"'), 'Apply Smart Typography left a straight quotation mark');
  console.log('PASS: Apply Smart Typography: the red line between two changes comes back, the others stay');
  await app.win.evaluate(window => window.destroy());

  // 6. A short paragraph: the two cases that lost red lines until something
  // was typed there.
  const shortWords = ['mispelled', 'seperate', 'occured', 'wierd'];
  await open('Short.md', SHORT, shortWords);
  await select('then plain', 5, 5);
  await key('Delete');
  await pause(300);
  await key('Control+z');
  await app.expectMarks(red(shortWords), 'Undo of a deleted selection', 3000);
  await select('then plain', 5, 5);
  await key('Control+b');
  await pause(300);
  await key('Control+b');
  await app.expectMarks(red(shortWords), 'Bold switched on and off', 3000);
  console.log('PASS: a short paragraph: Undo of a deleted selection, and Bold on and off, keep their red lines');

  // 7. The filler the quiet check works with shows nowhere.
  const file = await app.write('Filler.md', SHORT);
  await app.open(file);
  await app.expectMarks(red(shortWords), 'Filler.md: opened', 12000);
  for (let round = 0; round < 2; round++) {          // long, then short again (it is never empty: see check 10)
    await select('plain', 0, 5);
    await key('Control+i');
    await pause(1800);
    const state = await app.page.evaluate(active => {
      const element = document.querySelector(`${active} .tiptap`);
      const fillers = element.querySelectorAll('[data-spelling-filler]');
      const box = fillers[0]?.getBoundingClientRect();
      return { count: fillers.length, length: fillers[0]?.textContent.length, width: box?.width, height: box?.height, text: element.editor.getText(), scroll: element.scrollWidth - element.clientWidth };
    }, active);
    assert.equal(state.count, 1, 'There is not exactly one filler');
    assert.equal(state.length, round === 0 ? 1101 : 1, `The filler was not made ${round === 0 ? 'long' : 'short again'}`);
    assert(state.width === 0 && state.height === 0, `The filler takes room: ${state.width} x ${state.height}`);
    assert(!state.text.includes(' '), 'The filler is in the document text');
    assert(state.scroll <= 0, 'The filler made the editor wider than its window');
    if (round === 0) {
      // Long: the end of the document is still the end of its last paragraph.
      await key('Control+End');
      await type(' END');
      const end = await app.page.evaluate(active => { const editor = document.querySelector(`${active} .tiptap`).editor; return { last: editor.state.doc.lastChild.textContent, atEnd: editor.state.selection.head === editor.state.doc.content.size - 1 }; }, active);
      assert.equal(end.last, 'Third paragraph: a wierd word. END', 'Typing at the end of the document went elsewhere');
      assert(end.atEnd, 'The caret is not at the end of the last paragraph');
      await key('Control+a');
      await app.page.evaluate(() => document.execCommand('copy'));
      const copied = await app.electron.evaluate(({ clipboard }) => clipboard.readText());
      assert(copied.includes('seperate') && copied.includes('END'), 'Select All and Copy did not copy the document');
      assert(!copied.includes(' '), 'The filler was copied with the document');
    }
  }
  await app.command('save');
  await pause(900);
  const saved = fs.readFileSync(file, 'utf8');
  assert(saved.includes('Third paragraph: a wierd word. END') && !saved.includes(' '), 'The filler is in the saved file');
  console.log('PASS: the filler takes no room and is not in the text, at the caret, in a copy, or in the saved file');

  // 8. Formatting just after a recheck of the kind that blinks (as after a
  // paste). That recheck goes over the document a second after it is asked
  // for. A change made right after that pass is not covered by it, and
  // needs the quiet check like any other.
  await open('After a recheck.md', LONG, WORDS);
  await select('MIDDLE', 0, 6);
  await app.command('recheck-spelling');
  await pause(1100);
  await key('Control+b');
  await app.expectMarks(red(WORDS), 'Bold 1.1 seconds after a recheck', 4000);
  console.log('PASS: Bold in a long paragraph just after a blinking recheck has passed: the red line after the word still comes back');
  await app.win.evaluate(window => window.destroy());

  // 9. A recheck that is cut short. The caret leaves for the Find box right
  // after a recheck is asked for, so Chromium's pass over the document finds
  // it elsewhere and gives up: the red lines outside the caret's paragraph
  // stay away. Nothing is done about that here; Chromium makes a pass of its
  // own when the caret is in the document again, and that pass finds a
  // document it has not checked. This check keeps an eye on that.
  await open('Interrupted.md', SHORT, shortWords);
  await select('plain', 0);
  await app.command('recheck-spelling');
  await app.command('find');
  await app.page.getByPlaceholder('Find in note...').waitFor();
  await pause(1800);
  assert.deepEqual(app.byWord(await app.marks(['mispelled', 'wierd'])), { mispelled: ['plain'], wierd: ['plain'] }, 'The visit to the Find box did not cut the recheck short');
  await app.page.getByPlaceholder('Find in note...').press('Escape');
  await inEditor();
  await key('ArrowRight');
  await app.expectMarks(red(shortWords), 'A recheck cut short by the Find box', 3500);
  console.log('PASS: a recheck cut short by a visit to the Find box is made up for once the caret is back in the document');

  // 10. The end of the document is where it was. The filler is the last
  // thing in the editor element. The caret must not stop at it: an empty
  // filler was a place of its own for Chromium, Ctrl+End went behind it and
  // the window did not follow (the editor puts the caret right a moment
  // later, but scrolls only if that moment is short). And the last paragraph
  // must keep the bottom margin of a last child, none, or every document is
  // a little taller. Looked at with the filler short and long.
  const TALL = `# A tall document has a mispelled word\n\n${Array.from({ length: 90 }, (_, i) => `Paragraph ${i + 1} of the tall document.`).join('\n\n')}\n\nThe last paragraph has a wierd word.\n`;
  await open('Tall.md', TALL, ['mispelled']);
  await app.page.evaluate(active => {
    const root = document.querySelector(`${active} .tiptap`);
    window.caretMoves = [];
    // In the capture phase: before the editor reads the selection.
    document.addEventListener('selectionchange', () => {
      const node = document.getSelection().focusNode;
      window.caretMoves.push(node === root ? 'the editor element itself' : node?.nodeType === 3 && !node.parentElement.closest('[data-spelling-filler]') ? 'text' : 'elsewhere');
    }, true);
  }, active);
  const atEnd = () => app.page.evaluate(active => {
    const root = document.querySelector(`${active} .tiptap`);
    const filler = root.querySelector(':scope > [data-spelling-filler]');
    const blocks = [...root.children].filter(child => child !== filler);
    const last = blocks[blocks.length - 1].getBoundingClientRect();
    const moves = window.caretMoves;
    window.caretMoves = [];
    return {
      moves, filler: filler.textContent.length, fillerIsLast: root.lastElementChild === filler,
      marginBottom: getComputedStyle(blocks[blocks.length - 1]).marginBottom, marginTop: getComputedStyle(blocks[0]).marginTop,
      lastOnScreen: last.top >= 0 && last.bottom <= innerHeight, atEnd: root.editor.state.selection.head === root.editor.state.doc.content.size - 1,
    };
  }, active);
  for (const length of ['short', 'long']) {
    if (length === 'long') { await select('A tall document', 0, 1); await key('Control+b'); await pause(1800); }
    await key('Control+Home');
    await pause(400);
    let end = await atEnd();
    assert(!end.lastOnScreen, 'The document is not taller than its window');
    await key('Control+End');
    await pause(500);
    end = await atEnd();
    assert.equal(end.filler, length === 'short' ? 1 : 1101, `The filler should be ${length}`);
    assert(end.fillerIsLast, 'The filler is not the last thing in the editor element');
    assert.deepEqual(end.moves, ['text'], `Ctrl+End with the filler ${length}: the caret went to ${end.moves.join(', then to ')}`);
    assert(end.atEnd && end.lastOnScreen, `Ctrl+End with the filler ${length}: the caret is ${end.atEnd ? '' : 'not '}at the end of the document and its last line is ${end.lastOnScreen ? '' : 'not '}on screen`);
    assert.equal(end.marginBottom, '0px', 'The last paragraph has a bottom margin, which a last child has not');
    assert.equal(end.marginTop, '0px', 'The first block has a top margin, which a first child has not');
    await key('ArrowDown');
    await key('ArrowRight');
    await pause(400);
    end = await atEnd();
    assert.deepEqual(end.moves, [], `With the filler ${length}, the caret moved at the end of the document, where there is nowhere to go: to ${end.moves.join(', then to ')}`);
  }
  console.log('PASS: Ctrl+End goes straight to the end of the last line and the window follows, the arrow keys stay there, and the last paragraph keeps the margin of a last child, with the filler short and long');

  clearTimeout(watchdog);
  await app.stop();
  console.log('PARAGRAPH CHECKS DONE');
})().catch(error => { console.error(error); process.exit(1); });
