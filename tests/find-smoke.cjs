// Find, Replace and the spelling marks, in the real app (Electron with a US
// English dictionary), read off the screen like tests/ignore-smoke.cjs.
//
// What it guards: Find paints its matches without touching the text, so the
// red lines of the paragraphs it highlights stay where they are, while Find
// is open and after it closes (through 1.3.1 they vanished and did not come
// back); the highlights stay on their words while the document is edited
// under them; text put in by Replace and Replace All is spell-checked once
// the caret is back in the document; and Find in Markdown source view still
// selects its match.
//
// Run with: npm run test:find. Needs a dictionary: see tests/spelling-smoke.cjs.
const assert = require('node:assert/strict');
const { startSpellingApp, active, pause } = require('./spelling-harness.cjs');

const DOCUMENT = `# The Road to Qarth

Qarth is a walled city. The peeple of Qarth recieve few visitors, and the wall is tall.

Daenerys reached the city wall after a long march. One definately wrong word.

A paragraph without the searched word has a seperate mistake.

The last paragraph has an occured error beside the wall.
`;
const MISSPELLED = ['peeple', 'recieve', 'definately', 'seperate', 'occured'];
const allRed = Object.fromEntries(MISSPELLED.map(word => [word, 'red']));

(async () => {
  const app = await startSpellingApp({ name: 'find-smoke', display: process.env.SCRATCH_DISPLAY_NUMBER || '129' });
  const { expectMarks, watch, command, markdown } = app;
  const page = () => app.page;

  // What Find has painted in this document: the text and place of each
  // range, in reading order.
  const highlights = () => page().evaluate(active => {
    const editor = document.querySelector(`${active} .tiptap`);
    const read = name => [...(CSS.highlights.get(name) ?? [])].filter(range => editor.contains(range.startContainer)).map(range => {
      const r = range.getBoundingClientRect();
      return { text: range.toString(), x: r.x, y: r.y, w: r.width, h: r.height };
    }).sort((a, b) => a.y - b.y || a.x - b.x);
    return { others: read('search-match'), current: read('search-match-active') };
  }, active);
  // How yellow the screen is there: the share of highlight-colored pixels
  // and their average blue (the current match is a deeper yellow).
  const yellow = rect => app.win.evaluate(async (window, r) => {
    const image = await window.webContents.capturePage({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) });
    const bitmap = image.toBitmap(); // BGRA
    let count = 0, blue = 0;
    for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i + 2] > 235 && bitmap[i + 1] > 215 && bitmap[i] < 232) { count++; blue += bitmap[i]; }
    return { share: count / (bitmap.length / 4), blue: count ? blue / count : 255 };
  }, rect);
  const counter = () => page().getByText(/^\d+\/\d+\+?$/).first().innerText();
  const texts = list => list.map(entry => entry.text.toLowerCase());
  const findBox = () => page().getByPlaceholder('Find in note...');
  const replaceBox = () => page().getByPlaceholder('Replace with...');
  const steady = (samples, words) => samples.every(sample => words.every(word => sample[word]?.every(state => state === 'red')));
  const unsteady = (samples, words) => JSON.stringify(samples.find(sample => !words.every(word => sample[word]?.every(state => state === 'red'))));
  // The editor takes the keyboard a frame after it is asked to. Until then
  // the keys would go to the Find box.
  const inEditor = () => page().waitForFunction(active => document.activeElement === document.querySelector(`${active} .tiptap`), active);
  // Select from an offset in the text that holds a passage; no length puts the caret there.
  const select = async (passage, offset, length = 0) => {
    await page().evaluate(({ active, passage, offset, length }) => {
      const editor = document.querySelector(`${active} .tiptap`).editor;
      let from = null;
      editor.state.doc.descendants((node, pos) => { if (from === null && node.isText && node.text.includes(passage)) from = pos + node.text.indexOf(passage) + offset; });
      editor.chain().focus().setTextSelection({ from, to: from + length }).run();
    }, { active, passage, offset, length });
    await inEditor();
  };

  const file = await app.write('The Road to Qarth.md', DOCUMENT);
  await app.open(file);
  await expectMarks({ ...allRed, Qarth: 'red' }, 'opened', 10000);
  const textNodes = () => page().evaluate(active => [...document.querySelectorAll(`${active} .tiptap p`)].map(p => p.childNodes.length), active);
  const untouched = await textNodes();

  // 1. Find paints its matches and the red lines stay.
  await command('find');
  await findBox().waitFor();
  let samples = await watch(MISSPELLED, () => findBox().fill('wall'), { duration: 2500 });
  assert.equal(await counter(), '1/4');
  assert(steady(samples, MISSPELLED), `Red lines disappeared while Find highlighted its matches: ${unsteady(samples, MISSPELLED)}`);
  let shown = await highlights();
  assert.deepEqual([texts(shown.current), texts(shown.others)], [['wall'], ['wall', 'wall', 'wall']], 'Find should paint one current match and three others');
  assert(shown.current[0].y < shown.others[0].y || (shown.current[0].y === shown.others[0].y && shown.current[0].x < shown.others[0].x), 'The first match should be the current one');
  const [currentColor, otherColor] = [await yellow(shown.current[0]), await yellow(shown.others[0])];
  assert(currentColor.share > 0.4 && otherColor.share > 0.4, `The matches should be highlighted on screen: ${JSON.stringify({ currentColor, otherColor })}`);
  assert(currentColor.blue < otherColor.blue - 15, `The current match should be a deeper yellow: ${JSON.stringify({ currentColor, otherColor })}`);
  assert.deepEqual(await textNodes(), untouched, 'Find should not change the text nodes of the document');
  console.log('PASS: Find paints four matches, the first as the current one, and every red line stays, in the paragraphs with matches too; the text of the document is not touched');

  // 2. Next and Previous move the current match.
  await findBox().press('Enter');
  await pause(400);
  assert.equal(await counter(), '2/4');
  const second = await highlights();
  assert.deepEqual([texts(second.current), texts(second.others)], [['wall'], ['wall', 'wall', 'wall']]);
  assert.deepEqual([second.current[0].x, second.current[0].y], [shown.others[0].x, shown.others[0].y], 'Next should make the second match the current one');
  assert.deepEqual([second.others[0].x, second.others[0].y], [shown.current[0].x, shown.current[0].y], 'The first match should be an ordinary match again');
  await findBox().press('Shift+Enter');
  await pause(400);
  assert.equal(await counter(), '1/4');
  assert.deepEqual(await highlights(), shown, 'Previous should bring back the first picture');
  await expectMarks({ ...allRed, Qarth: 'red' }, 'after Next and Previous');
  console.log('PASS: Next and Previous move the current match; the red lines stay');

  // 3. Editing under the highlights: they stay on their words.
  await select('Qarth is a walled city', 0);
  await page().keyboard.type('Old ', { delay: 40 });
  await pause(300);
  let moved = await highlights();
  assert.deepEqual([texts(moved.current), texts(moved.others)], [['wall'], ['wall', 'wall', 'wall']], 'The highlights should still be on their words after typing before them');
  assert(moved.current[0].x > shown.current[0].x + 10, 'The first highlight should have moved right with its word');
  // Typed right against a match, at its start and at its end: not part of it.
  await select('walled', 0);
  await page().keyboard.type('x', { delay: 40 });
  await page().keyboard.press('ArrowRight'); await page().keyboard.press('ArrowRight'); await page().keyboard.press('ArrowRight'); await page().keyboard.press('ArrowRight');
  await page().keyboard.type('y', { delay: 40 });
  await pause(300);
  assert((await markdown()).includes('Old Qarth is a xwallyed city'), `Typing against the match went wrong: ${(await markdown()).split('\n')[2]}`);
  moved = await highlights();
  assert.deepEqual([texts(moved.current), texts(moved.others)], [['wall'], ['wall', 'wall', 'wall']], 'A letter typed against a match should not become part of it');
  // Typed inside a match: it grows, as it did when matches were decorations.
  await page().keyboard.press('ArrowLeft'); await page().keyboard.press('ArrowLeft'); await page().keyboard.press('ArrowLeft');
  await page().keyboard.type('z', { delay: 40 });
  await pause(300);
  moved = await highlights();
  assert.deepEqual(texts(moved.current), ['wazll'], 'A letter typed inside a match should be highlighted with it');
  // Undo redraws the text: the highlights are found again.
  for (let i = 0; i < 4; i++) { await page().keyboard.press('Control+z'); await pause(150); }
  await pause(400);
  assert.equal(await markdown(), DOCUMENT.trim(), 'Undo should bring the document back');
  assert.deepEqual(await highlights(), shown, 'After Undo the highlights should be where they were');
  // Deleting a match takes its highlight away.
  await select('city wall', 4, 5);
  await page().keyboard.press('Delete');
  await pause(300);
  moved = await highlights();
  assert.deepEqual([texts(moved.current), texts(moved.others)], [['wall'], ['wall', 'wall']], 'A deleted match should lose its highlight');
  await page().keyboard.press('Control+z');
  await pause(400);
  console.log('PASS: the highlights follow their words through typing before, against and inside them, through Undo, and go with a deleted match');

  // 4. Closing Find: the highlights go, the red lines do not even blink.
  // (Undo redrew two paragraphs, which cost them their red lines whatever
  // Find does; since 1.3.3 those come back by themselves.)
  await expectMarks({ ...allRed, Qarth: 'red' }, 'before closing Find');
  await findBox().focus();
  await pause(1500);
  samples = await watch(MISSPELLED, () => findBox().press('Escape'), { duration: 2500 });
  shown = await highlights();
  assert.deepEqual([shown.current, shown.others], [[], []], 'Closing Find should remove its highlights');
  assert(steady(samples, MISSPELLED), `Red lines disappeared when Find closed: ${unsteady(samples, MISSPELLED)}`);
  console.log('PASS: closing Find removes the highlights and no red line disappears, not even for a moment');

  // 5. Replace All: the new text is checked when the caret is back in the
  // document. Chromium checks only the text that holds the caret, so until
  // then nothing else may lose its red line.
  await command('replace');
  await replaceBox().waitFor();
  await findBox().fill('wall');
  await replaceBox().fill('wallx');
  await pause(400);
  samples = await watch(['seperate'], () => replaceBox().press('Control+Enter'), { duration: 3000 });
  assert.equal((await markdown()).match(/wallx/g)?.length, 4, 'Replace All should have changed four places');
  assert(steady(samples, ['seperate']), `A red line in an untouched paragraph disappeared while the caret was in the Replace box: ${unsteady(samples, ['seperate'])}`);
  await replaceBox().press('Escape');
  await expectMarks({ wallx: 'red', wallxed: 'red', ...allRed, Qarth: 'red' }, 'back in the document after Replace All');
  console.log('PASS: after Replace All the new text is spell-checked once the caret is back in the document, and the paragraphs it changed have their red lines again');

  // 6. Replace, one match at a time. The caret waits at the top of the
  // document, too far from the new word for Chromium to check it in passing.
  await select('The Road to', 0);
  await command('replace');
  await replaceBox().waitFor();
  await findBox().fill('seperate');
  await replaceBox().fill('seperete');
  await pause(400);
  assert.equal(await counter(), '1/1');
  await replaceBox().press('Enter');
  await pause(300);
  assert((await markdown()).includes('has a seperete mistake'), 'Replace should have changed the word');
  await replaceBox().press('Escape');
  await expectMarks({ seperete: 'red', wallx: 'red', peeple: 'red', recieve: 'red', definately: 'red', occured: 'red' }, 'back in the document after Replace');
  console.log('PASS: after Replace the new word is spell-checked once the caret is back in the document');

  // 7. Find on an ignored word: its first letter sits in a wrapper of its
  // own, and the highlight covers the whole word across it.
  await app.rightClick('Qarth', 1);
  await app.choose('Ignore All');
  await expectMarks({ Qarth: 'ignored', peeple: 'red', recieve: 'red', definately: 'red', occured: 'red' }, 'after Ignore All');
  await command('find');
  await findBox().waitFor();
  samples = await watch(['peeple', 'recieve', 'definately', 'occured'], () => findBox().fill('qarth'), { duration: 2000 });
  assert.equal(await counter(), '1/3');
  shown = await highlights();
  assert.deepEqual([texts(shown.current), texts(shown.others)], [['qarth'], ['qarth', 'qarth']], 'Find should highlight the whole of each ignored word');
  assert(steady(samples, ['peeple', 'recieve', 'definately', 'occured']), `Red lines disappeared when Find highlighted ignored words: ${unsteady(samples, ['peeple', 'recieve', 'definately', 'occured'])}`);
  await findBox().press('Escape');
  await expectMarks({ Qarth: 'ignored', peeple: 'red', recieve: 'red', definately: 'red', occured: 'red' }, 'after Find on an ignored word');
  console.log('PASS: Find highlights ignored words whole, and they stay ignored');

  // 8. Markdown source view: Find selects its match in the text box.
  await command('source');
  await page().waitForSelector(`${active} textarea`);
  await command('find');
  await findBox().waitFor();
  await findBox().fill('occured');
  await pause(500);
  assert.equal(await counter(), '1/1');
  assert.equal(await page().evaluate(active => { const box = document.querySelector(`${active} textarea`); return box.value.slice(box.selectionStart, box.selectionEnd); }, active), 'occured');
  await findBox().press('Escape');
  await command('source');
  await page().waitForSelector(`${active} .tiptap`, { state: 'visible' });
  await expectMarks({ Qarth: 'ignored', peeple: 'red', recieve: 'red', definately: 'red', occured: 'red' }, 'back from the source view');
  console.log('PASS: Find in Markdown source view selects its match, and the formatted view comes back with its red lines');

  // 9. What the keyboard gives finds what Smart Typography makes of it; a
  // typeset character in the Find box finds only itself.
  const fence = '```';
  const TYPESET = [
    '# Find and what is typed', '',
    'She said “don’t stop” and then—after a pause—nothing… at all.', '',
    'A plain line: don\'t stop, said "she" -- and so on...', '',
    'She read the *Odyssey* in a week. He said **stop right there** and left. A [linked phrase](https://example.com) here.', '',
    'Bran went north. Then Bran came back.', '',
    'In code: `Bran here` stays.', '',
    fence, 'Bran in a block -- with "quotes"', fence, '',
  ].join('\n');
  const look = async (query) => {
    await findBox().fill(query);
    await pause(450);
    const painted = await highlights();
    return { count: await counter(), texts: [...painted.current, ...painted.others].map(entry => entry.text) };
  };
  await app.open(await app.write('Typeset.md', TYPESET));
  await command('find');
  await findBox().waitFor();
  assert.deepEqual(await look("don't"), { count: '1/2', texts: ['don’t', "don't"] });
  assert.deepEqual(await look('"'), { count: '1/6', texts: ['“', '”', '"', '"', '"', '"'] });
  assert.deepEqual(await look('--'), { count: '1/4', texts: ['—', '—', '--', '--'] });
  assert.deepEqual(await look('...'), { count: '1/2', texts: ['…', '...'] });
  assert.deepEqual(await look('said "she" --'), { count: '1/1', texts: ['said "she" --'] });
  assert.deepEqual(await look('—'), { count: '1/2', texts: ['—', '—'] });
  assert.deepEqual(await look('…'), { count: '1/1', texts: ['…'] });
  assert.deepEqual(await look('don’t'), { count: '1/1', texts: ['don’t'] });
  assert.deepEqual(await look('“'), { count: '1/1', texts: ['“'] });
  console.log('PASS: a typed apostrophe, quotation mark, two hyphens and three periods find the typeset characters too; a typeset character finds only itself');

  // 10. A phrase is found across a change of formatting, and can be replaced.
  assert.deepEqual(await look('the odyssey in'), { count: '1/1', texts: ['the Odyssey in'] });
  assert.deepEqual(await look('said stop right'), { count: '1/1', texts: ['said stop right'] });
  assert.deepEqual(await look('a linked phrase here'), { count: '1/1', texts: ['A linked phrase here'] });
  await findBox().press('Escape');
  await command('replace');
  await replaceBox().waitFor();
  await findBox().fill('the odyssey in');
  await replaceBox().fill('the Iliad in');
  await pause(450);
  await replaceBox().press('Enter');
  await pause(400);
  assert((await markdown()).includes('She read the Iliad in a week.'), `Replace across formatting gave: ${(await markdown()).split('\n')[6]}`);
  assert.equal(await counter(), '0/0');
  console.log('PASS: a phrase is found although part of it is italic, bold or a link, and Replace replaces the whole of it');

  // 11. What Replace puts in follows Smart Typography, as if typed at that
  // place: curly quotes by what stands before them, an em dash, an ellipsis.
  // Never in code. And exactly as typed when Smart Typography is off.
  await findBox().fill('bran');
  await replaceBox().fill('Bran\'s "wolf" -- so...');
  await pause(450);
  assert.equal(await counter(), '1/4');
  await replaceBox().press('Control+Enter');
  await pause(500);
  let written = await markdown();
  assert.equal(written.split('Bran’s “wolf” — so…').length - 1, 2, `Replace did not typeset its text in prose: ${written.split('\n')[8]}`);
  assert.equal(written.split('Bran\'s "wolf" -- so...').length - 1, 2, 'Replace changed what it puts into code');
  const smartTypography = async (on) => {
    await command('settings');
    const toggle = page().getByRole('switch', { name: 'Smart Typography' });
    await toggle.waitFor();
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
    await page().getByRole('button', { name: 'Back to document', exact: true }).click();
    await pause(400);
  };
  await findBox().press('Escape');
  await smartTypography(false);
  await command('replace');
  await replaceBox().waitFor();
  await findBox().fill('north');
  await replaceBox().fill('"north" -- it\'s...');
  await pause(450);
  await replaceBox().press('Control+Enter');
  await pause(500);
  written = await markdown();
  assert(written.includes('went "north" -- it\'s....'), `With Smart Typography off, Replace should put in what was typed: ${written.split('\n')[8]}`);
  await findBox().press('Escape');
  await smartTypography(true);
  console.log('PASS: Replace typesets its text like typing when Smart Typography is on, leaves code alone, and puts in what was typed when it is off');

  // 12. Replace All replaces every match, also beyond the 500 that Find lists.
  const MANY = '# Many\n\n' + Array.from({ length: 400 }, (_, i) => `Paragraph ${i + 1}: Qarth is far, and Qarth is old, and the road to Qarth is long.`).join('\n\n') + '\n';
  await app.open(await app.write('Many.md', MANY));
  const occurrences = word => page().evaluate(({ active, word }) => document.querySelector(`${active} .tiptap`).editor.getText().split(word).length - 1, { active, word });
  await command('replace');
  await replaceBox().waitFor();
  await findBox().fill('qarth');
  await replaceBox().fill('Meereen');
  await pause(600);
  assert.equal(await counter(), '1/500+');
  await replaceBox().press('Control+Enter');
  await pause(1500);
  assert.deepEqual([await occurrences('Qarth'), await occurrences('Meereen')], [0, 1200], 'Replace All should replace every match');
  assert.equal(await counter(), '0/0');
  await findBox().press('Escape');
  await inEditor();
  await page().keyboard.press('Control+z');
  await pause(1200);
  assert.deepEqual([await occurrences('Qarth'), await occurrences('Meereen')], [1200, 0], 'One Undo should take all of Replace All back');
  console.log('PASS: Replace All replaces all 1,200 matches where Find lists 500 ("1/500+"), and one Undo takes it back');

  // 13. The Markdown source view: the same matching, and Replace typesets
  // in prose but not in code.
  await app.open(await app.write('Typeset source.md', TYPESET));
  await command('source');
  await page().waitForSelector(`${active} textarea`);
  const sourceText = () => page().evaluate(active => document.querySelector(`${active} textarea`).value, active);
  const selected = () => page().evaluate(active => { const box = document.querySelector(`${active} textarea`); return box.value.slice(box.selectionStart, box.selectionEnd); }, active);
  await command('replace');
  await replaceBox().waitFor();
  await findBox().fill("don't");
  await pause(500);
  assert.equal(await counter(), '1/2');
  assert.equal(await selected(), 'don’t');
  await findBox().fill('--');
  await pause(500);
  assert.equal(await counter(), '1/4');
  await findBox().fill('—');
  await pause(500);
  assert.equal(await counter(), '1/2');
  await findBox().fill('bran');
  await replaceBox().fill('Bran\'s "wolf"');
  await pause(500);
  assert.equal(await counter(), '1/4');
  await replaceBox().press('Control+Enter');
  await pause(600);
  written = await sourceText();
  assert.equal(written.split('Bran’s “wolf”').length - 1, 2, 'Replace in source view did not typeset its text in prose');
  assert(written.includes('`Bran\'s "wolf" here`') && written.includes('\nBran\'s "wolf" in a block'), 'Replace in source view changed what it puts into code');
  await findBox().press('Escape');
  console.log('PASS: in Markdown source view the same matches are found, and Replace typesets in prose but not in code');

  assert.deepEqual(app.errors, [], `Renderer errors: ${app.errors.join('\n')}`);
  await app.stop();
  console.log('FIND CHECKS DONE');
})().catch(error => { console.error(error); process.exit(1); });
