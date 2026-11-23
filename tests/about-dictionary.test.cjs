const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aboutDialog, aboutLink, PICOMARQ_PAGE, SCRATCH_PAGE } = require('../desktop/about.cjs');
const { dictionaryWords, clearDictionaryDialog, MAX_LISTED } = require('../desktop/dictionary.cjs');
const project = require('../package.json');

test('About PicoMarQ shows the version, the acknowledgment and both pages', () => {
  const about = aboutDialog(project.version);
  assert.equal(about.title, 'About PicoMarQ');
  assert.equal(about.message, 'PicoMarQ');
  assert.deepEqual(about.detail.split('\n'), [
    `Version ${project.version}`,
    '',
    'Based on Scratch by Eric Li and contributors.',
    '',
    'PicoMarQ: https://github.com/Crotalus65/PicoMarq',
    'Scratch: https://github.com/erictli/scratch',
  ]);
  assert.match(project.version, /^\d+\.\d+\.\d+$/);
  // No personal name anywhere in the box.
  assert.doesNotMatch(JSON.stringify(about), /copyright|©|\bby (?!Eric Li)/i);
});

test('About PicoMarQ: the buttons open the two pages, Close and Esc open nothing', () => {
  const about = aboutDialog('1.0.0');
  assert.deepEqual(about.buttons, ['PicoMarQ on GitHub', 'Scratch on GitHub', 'Close']);
  assert.equal(about.buttons[about.defaultId], 'Close');
  assert.equal(about.buttons[about.cancelId], 'Close');
  assert.equal(about.noLink, true);
  assert.equal(aboutLink(0), PICOMARQ_PAGE);
  assert.equal(aboutLink(1), SCRATCH_PAGE);
  assert.equal(aboutLink(2), null);
  assert.equal(aboutLink(undefined), null);
  for (const page of [PICOMARQ_PAGE, SCRATCH_PAGE]) assert.equal(new URL(page).protocol, 'https:');
});

test('the custom dictionary is listed without repeats, in alphabetical order whatever the case', () => {
  assert.deepEqual(dictionaryWords(['Zorblat', 'apple', 'Qarth', 'qarth', 'Qarth', '', null, 7]), ['apple', 'Qarth', 'qarth', 'Zorblat']);
  assert.deepEqual(dictionaryWords(undefined), []);
  assert.deepEqual(dictionaryWords(new Set(['a'])), []);
});

test('Clear Custom Dictionary asks first, names the words, and Cancel is the default', () => {
  const two = clearDictionaryDialog(['Zorblat', 'Qarth']);
  assert.equal(two.title, 'Clear Custom Dictionary');
  assert.equal(two.message, 'Clear the custom dictionary?');
  assert.deepEqual(two.detail.split('\n'), ['This removes all 2 words you added with Add to Dictionary:', '', 'Qarth, Zorblat', '', 'They will be marked as misspelled again. This cannot be undone.']);
  assert.deepEqual(two.buttons, ['Clear', 'Cancel']);
  assert.equal(two.buttons[two.defaultId], 'Cancel');
  assert.equal(two.buttons[two.cancelId], 'Cancel');
  const one = clearDictionaryDialog(['Qarth']);
  assert.deepEqual(one.detail.split('\n'), ['This removes the 1 word you added with Add to Dictionary:', '', 'Qarth', '', 'It will be marked as misspelled again. This cannot be undone.']);
});

test('Clear Custom Dictionary lists at most twenty words and counts the rest', () => {
  const words = Array.from({ length: MAX_LISTED + 7 }, (_, i) => `word${String(i).padStart(2, '0')}`);
  const lines = clearDictionaryDialog(words).detail.split('\n');
  assert.equal(lines[0], `This removes all ${MAX_LISTED + 7} words you added with Add to Dictionary:`);
  assert.equal(lines[2], `${words.slice(0, MAX_LISTED).join(', ')}, and 7 more`);
  assert.equal(clearDictionaryDialog(words.slice(0, MAX_LISTED)).detail.split('\n')[2], words.slice(0, MAX_LISTED).join(', '));
});
