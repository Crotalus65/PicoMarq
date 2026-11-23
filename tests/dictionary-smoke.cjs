// Settings > Spelling > Clear Custom Dictionary, in the real Electron app,
// with the words added the way a user adds them: right-click, Add to
// Dictionary. Needs a graphical session or Xvfb, and a US English dictionary
// (see tests/spelling-harness.cjs). Without one it is skipped.
//
// What it guards: the button asks first and Cancel changes nothing; Clear
// removes every added word, and the words are underlined again in every open
// document (Chromium does not mark them again by itself), also in the
// document behind Settings, which is hidden when the words are cleared; an
// empty dictionary is reported without asking; words ignored with Ignore All
// stay ignored.
// Usage: node tests/dictionary-smoke.cjs
const assert = require('node:assert/strict');
const { startSpellingApp, active, pause } = require('./spelling-harness.cjs');
let app;

const FIRST = `# Dictionary Check

Qarth is a walled city. The peeple of Qarth recieve few visitors, says Zorblat.

Zorblat adds that Qarth has one definately tall gate, and that Vexil is far.
`;
const SECOND = `# Second Document

Here Zorblat writes about Qarth again, with an occured error.
`;

async function main() {
  app = await startSpellingApp({ name: 'dictionary-smoke', display: process.env.SCRATCH_DISPLAY_NUMBER || '128' });
  if (!app) { console.log('SKIP: no US English dictionary (set PICOMARQ_TEST_BDIC or install hunspell-en-us)'); return; }
  const { expectMarks, rightClick, choose, command } = app;
  const second = await app.open(await app.write('Second Document.md', SECOND));
  await expectMarks({ Zorblat: 'red', Qarth: 'red', occured: 'red' }, 'second document opened', 10000);
  const first = await app.open(await app.write('Dictionary Check.md', FIRST));
  await expectMarks({ Qarth: 'red', Zorblat: 'red', Vexil: 'red', peeple: 'red', recieve: 'red', definately: 'red' }, 'first document opened', 10000);
  assert.deepEqual(await app.dictionaryWords(), []);

  // Settings in the current window, and the Spelling section's parts.
  const button = () => app.page.getByRole('button', { name: 'Clear Custom Dictionary…' });
  const status = () => app.page.locator('[data-dictionary-status]');
  const openSettings = async () => { await command('settings'); await button().waitFor({ timeout: 5000 }); };
  const closeSettings = async () => { await app.page.keyboard.press('Escape'); await app.page.waitForSelector(`${active} .tiptap`, { state: 'visible' }); };

  // 1. Nothing added yet: no question, just a note.
  await openSettings();
  assert.deepEqual(await app.page.locator('h2').allTextContents().then(headings => headings.slice(-2)), ['Startup', 'Spelling'], 'Spelling should be the last section of Settings');
  await button().click();
  await status().waitFor({ timeout: 5000 });
  assert.equal(await status().innerText(), 'The custom dictionary is empty.');
  assert.deepEqual(await app.dialogs(), [], 'An empty dictionary needs no question');
  await closeSettings();
  console.log('PASS: Settings ends with a Spelling section; an empty custom dictionary is reported without asking');

  // 2. Add two words from the right-click menu, and ignore a third.
  for (const word of ['Qarth', 'Zorblat']) {
    const menu = await rightClick(word, 0);
    assert(menu.includes('Add to Dictionary'), `Menu for ${word}: ${menu.join(', ')}`);
    await choose('Add to Dictionary');
    await expectMarks({ [word]: 'plain' }, `${word} added to the dictionary`);
  }
  await rightClick('Vexil', 0);
  await choose('Ignore All');
  await expectMarks({ Qarth: 'plain', Zorblat: 'plain', Vexil: 'ignored', peeple: 'red', recieve: 'red', definately: 'red' }, 'two words added, one ignored');
  assert.deepEqual((await app.dictionaryWords()).sort(), ['Qarth', 'Zorblat']);
  await app.use(second);
  await expectMarks({ Qarth: 'plain', Zorblat: 'plain', occured: 'red' }, 'added words in the other open document');
  await app.use(first);
  console.log('PASS: Add to Dictionary removes the underlines in every open document; Ignore All adds nothing to the dictionary');

  // 3. Clear asks first; Cancel is the default and changes nothing.
  await openSettings();
  await app.answer(1);
  await button().click();
  await pause(600);
  const [question, ...extra] = await app.dialogs();
  assert.equal(extra.length, 0);
  assert.equal(question.title, 'Clear Custom Dictionary');
  assert.equal(question.message, 'Clear the custom dictionary?');
  assert.deepEqual(question.detail.split('\n'), ['This removes all 2 words you added with Add to Dictionary:', '', 'Qarth, Zorblat', '', 'They will be marked as misspelled again. This cannot be undone.']);
  assert.deepEqual(question.buttons, ['Clear', 'Cancel']);
  assert.equal(question.defaultId, 1);
  assert.equal(question.cancelId, 1);
  assert.equal(await status().count(), 0, 'Cancel should leave no message');
  assert.deepEqual((await app.dictionaryWords()).sort(), ['Qarth', 'Zorblat']);
  await closeSettings();
  await expectMarks({ Qarth: 'plain', Zorblat: 'plain', Vexil: 'ignored', peeple: 'red' }, 'after Cancel');
  console.log('PASS: Clear Custom Dictionary asks first, lists the words, and Cancel (the default) changes nothing');

  // 4. Clear removes the words; they are underlined again in both documents.
  await openSettings();
  await app.answer(0);
  await button().click();
  await status().waitFor({ timeout: 5000 });
  assert.equal(await status().innerText(), 'Removed 2 words from the custom dictionary.');
  assert.equal((await app.dialogs()).length, 1);
  assert.deepEqual(await app.dictionaryWords(), []);
  assert.equal(await button().count(), 1, 'Settings should stay open after clearing');
  // A person stays in Settings longer than Chromium waits before it looks at
  // the document (0.2 s). The document is hidden then, and Chromium gives up.
  await pause(700);
  await closeSettings();
  const back = await expectMarks({ Qarth: 'red', Zorblat: 'red', Vexil: 'ignored', peeple: 'red', recieve: 'red', definately: 'red' }, 'after Clear, back in the document');
  await app.use(second);
  await expectMarks({ Qarth: 'red', Zorblat: 'red', occured: 'red' }, 'after Clear, in the other open document');
  console.log(`PASS: Clear removes every added word; they are underlined again in both open documents (${back} ms after leaving Settings); the word ignored with Ignore All stays ignored`);

  // 5. The cleared words stay cleared: adding one again starts from one word.
  await app.use(first);
  await rightClick('Qarth', 0);
  await choose('Add to Dictionary');
  await expectMarks({ Qarth: 'plain', Zorblat: 'red' }, 'a word added again after clearing');
  assert.deepEqual(await app.dictionaryWords(), ['Qarth']);
  await openSettings();
  await app.answer(0);
  await button().click();
  await status().waitFor({ timeout: 5000 });
  assert.equal(await status().innerText(), 'Removed 1 word from the custom dictionary.');
  assert.equal((await app.dialogs())[0].detail.split('\n')[0], 'This removes the 1 word you added with Add to Dictionary:');
  await pause(700);
  await closeSettings();
  await expectMarks({ Qarth: 'red', Zorblat: 'red' }, 'after clearing one word');
  console.log('PASS: the dictionary can be filled and cleared again');
  assert.equal(app.errors.length, 0, app.errors.join('\n'));
}

const watchdog = setTimeout(() => { console.error('Dictionary checks timed out'); process.exit(1); }, 240000);
main().then(() => console.log('DICTIONARY CHECKS DONE')).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await app?.stop();
  clearTimeout(watchdog);
});
