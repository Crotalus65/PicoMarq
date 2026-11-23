// Undo and the text a document was opened with, in the real app.
//
// What it guards: putting a file's text into the editor is not an edit.
// Through 1.3.2 it was the first step of the undo history: Ctrl+Z in a
// document that had just been opened, or once more than there were changes,
// took the whole text out, and a save in that state wrote an empty file.
//
// Run with: npm run test:undo. Uses tests/spelling-harness.cjs (it needs the
// same dictionary as tests/spelling-smoke.cjs, although no spelling is read).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startSpellingApp, active, pause } = require('./spelling-harness.cjs');

const DOCUMENT = '# A Heading\n\nFirst paragraph of the document.\n\nSecond paragraph of the document.\n';
const TEXT = 'A Heading\n\nFirst paragraph of the document.\n\nSecond paragraph of the document.';

(async () => {
  const watchdog = setTimeout(() => { console.error('Undo test timed out'); process.exit(1); }, 180000);
  const app = await startSpellingApp({ name: 'undo', display: process.env.SCRATCH_DISPLAY_NUMBER || '132' });
  const key = name => app.page.keyboard.press(name);
  const state = () => app.page.evaluate(active => {
    const editor = document.querySelector(`${active} .tiptap`).editor;
    return { text: editor.getText(), canUndo: editor.can().undo(), canRedo: editor.can().redo() };
  }, active);
  const inEditor = () => app.page.waitForFunction(active => document.activeElement === document.querySelector(`${active} .tiptap`), active);
  const caretAtEnd = async () => {
    await app.page.evaluate(active => { document.querySelector(`${active} .tiptap`).editor.chain().focus('end').run(); }, active);
    await inEditor();
  };

  // 1. A document that was just opened: there is nothing to undo.
  const file = await app.write('Undo.md', DOCUMENT);
  await app.open(file);
  await pause(800);
  assert.deepEqual(await state(), { text: TEXT, canUndo: false, canRedo: false }, 'A freshly opened document should have nothing to undo');
  const paragraph = await app.page.locator(`${active} .tiptap p`).first().boundingBox();
  await app.page.mouse.click(paragraph.x + 40, paragraph.y + paragraph.height / 2);
  await inEditor();
  await key('Control+z');
  await pause(300);
  assert.equal((await state()).text, TEXT, 'Ctrl+Z in a freshly opened document changed it');
  await app.command('undo');
  await pause(300);
  assert.equal((await state()).text, TEXT, 'Edit > Undo in a freshly opened document changed it');
  console.log('PASS: a freshly opened document has nothing to undo; Ctrl+Z and Edit > Undo leave its text alone');

  // 2. Undo takes back what was typed and then stops at the opened text.
  await caretAtEnd();
  await app.page.keyboard.type(' More.', { delay: 40 });
  await pause(700);
  assert.equal((await state()).text, `${TEXT} More.`);
  for (let press = 1; press <= 4; press++) {
    await key('Control+z');
    await pause(250);
    assert.equal((await state()).text, TEXT, `Ctrl+Z number ${press} should leave the opened text`);
  }
  assert.equal((await state()).canUndo, false);
  // Save in that state: the file keeps its text.
  await app.command('save');
  await pause(900);
  assert(fs.readFileSync(file, 'utf8').includes('Second paragraph of the document.'), 'Saving after one Undo too many emptied the file');
  await key('Control+y');
  await pause(300);
  assert.equal((await state()).text, `${TEXT} More.`, 'Redo should bring the typed text back');
  console.log('PASS: Undo takes back what was typed and stops at the opened text; a save there keeps the file; Redo still works');

  // 3. After a visit to the Markdown source view, Undo still stops at the opened text.
  await app.command('source');
  await app.page.waitForSelector(`${active} textarea`);
  await app.command('source');
  await app.page.waitForSelector(`${active} .tiptap`, { state: 'visible' });
  await pause(900);
  await inEditor();
  const seen = [];
  for (let press = 1; press <= 5; press++) {
    await key('Control+z');
    await pause(250);
    seen.push((await state()).text);
  }
  assert(seen.includes(TEXT), 'After the source view, Undo should still take the typed text back');
  assert(seen.every(text => text.includes('Second paragraph of the document.')), `After the source view, Undo emptied the document: ${JSON.stringify(seen)}`);
  console.log('PASS: after a visit to the Markdown source view, Undo takes the typed text back and stops at the opened text');

  // 4. Revert to Saved loads the file again: nothing to undo afterward.
  await caretAtEnd();
  await app.page.keyboard.type(' Unsaved words.', { delay: 30 });
  await pause(600);
  await app.answer(0);
  await app.command('revert');
  await app.page.waitForFunction(active => { const element = document.querySelector(`${active} .tiptap`); return element && !element.editor.getText().includes('Unsaved words'); }, active, { timeout: 8000 });
  await pause(800);
  const reverted = await state();
  assert(reverted.text.includes('Second paragraph of the document.') && !reverted.canUndo, `After Revert there should be nothing to undo: ${JSON.stringify(reverted)}`);
  await caretAtEnd();
  await key('Control+z');
  await pause(300);
  assert.equal((await state()).text, reverted.text, 'Ctrl+Z after Revert changed the document');
  console.log('PASS: after Revert to Saved there is nothing to undo, and Ctrl+Z leaves the text alone');

  // 5. A new, empty document (it opens in a window of its own): typing can
  // be undone, and that is all.
  const opening = app.electron.waitForEvent('window', { timeout: 10000 });
  await app.command('new');
  const blank = await opening;
  await blank.waitForSelector(`${active} .tiptap`);
  await pause(800);
  const blankState = () => blank.evaluate(active => {
    const editor = document.querySelector(`${active} .tiptap`).editor;
    return { text: editor.getText(), canUndo: editor.can().undo(), canRedo: editor.can().redo() };
  }, active);
  assert.deepEqual(await blankState(), { text: '', canUndo: false, canRedo: false }, 'A new document should have nothing to undo');
  await blank.evaluate(active => { document.querySelector(`${active} .tiptap`).editor.chain().focus('end').run(); }, active);
  await blank.waitForFunction(active => document.activeElement === document.querySelector(`${active} .tiptap`), active);
  await blank.keyboard.type('abc', { delay: 40 });
  await pause(600);
  await blank.keyboard.press('Control+z');
  await pause(300);
  assert.deepEqual(await blankState(), { text: '', canUndo: false, canRedo: true });
  console.log('PASS: in a new document, typing can be undone and nothing more');

  assert.deepEqual(app.errors, [], `Renderer errors: ${app.errors.join('\n')}`);
  clearTimeout(watchdog);
  await app.stop();
  console.log('UNDO CHECKS DONE');
})().catch(error => { console.error(error); process.exit(1); });
