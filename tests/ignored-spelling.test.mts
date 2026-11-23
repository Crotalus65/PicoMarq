import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findIgnoredRanges, forgetIgnoredWords, ignoredForms, ignoredWords, ignoreWord, normalizeIgnoredWord, NO_IGNORED_FORMS } from '../src/lib/ignored-spelling.ts';

// The words found in a text, for a list of ignored words.
const found = (text: string, ...ignored: string[]) => findIgnoredRanges(text, ignoredForms(new Set(ignored.map(normalizeIgnoredWord)))).map(([from, to]) => text.slice(from, to));

test('an ignored word is found as a whole word, wherever punctuation allows', () => {
  assert.deepEqual(found('Qarth is far. In Qarth, "Qarth" (Qarth) Qarth-born; Qarth.', 'Qarth'), ['Qarth', 'Qarth', 'Qarth', 'Qarth', 'Qarth', 'Qarth']);
  assert.deepEqual(findIgnoredRanges('The city of Qarth.', ignoredForms(new Set(['Qarth']))), [[12, 17]]);
  // Not inside a longer word, with letters, digits or an apostrophe-joined part around it.
  assert.deepEqual(found("Qarths aQarth Qarth2 2Qarth O'Qarth Qarth'ian", 'Qarth'), []);
  assert.deepEqual(found('', 'Qarth'), []);
  assert.deepEqual(found('Qarth', ), []);
});

test('a possessive of an ignored word is covered, with a straight or a curly apostrophe', () => {
  assert.deepEqual(found("Qarth's gates and Qarth’s walls, QARTH'S too", 'Qarth'), ["Qarth's", 'Qarth’s', "QARTH'S"]);
  // Ignoring the possessive ignores the word itself: it is kept as its base.
  assert.equal(normalizeIgnoredWord('Qarth’s'), 'Qarth');
  assert.equal(normalizeIgnoredWord("Qarth's"), 'Qarth');
  assert.equal(normalizeIgnoredWord("  don't "), "don't");
  assert.equal(normalizeIgnoredWord("'s"), "'s");
  assert.deepEqual(found("Qarth and Qarth's", "Qarth's"), ['Qarth', "Qarth's"]);
  // An apostrophe inside the word is part of it.
  assert.deepEqual(found("O'Qarth said so; O’Qarth too, but not Qarth", "O'Qarth"), ["O'Qarth", 'O’Qarth']);
});

test('capitals follow the dictionary rule: a lower-case word also matches at the start of a sentence and in capitals', () => {
  assert.deepEqual(found('gonna Gonna GONNA gOnna', 'gonna'), ['gonna', 'Gonna', 'GONNA']);
  // A word with a capital matches as written, and in capitals.
  assert.deepEqual(found('Qarth qarth QARTH QArth', 'Qarth'), ['Qarth', 'QARTH']);
  assert.deepEqual(found('McQarth mcqarth MCQARTH Mcqarth', 'McQarth'), ['McQarth', 'MCQARTH']);
});

test('letters of any alphabet, combining marks and digits belong to a word', () => {
  assert.deepEqual(found('Zoë, Zoe and Zoës; Zoë with a combining mark', 'Zoë'), ['Zoë']);
  assert.deepEqual(found('Zoë and Zoe', 'Zoë'), ['Zoë']);
  assert.deepEqual(found('Москва и Москварека', 'Москва'), ['Москва']);
  assert.deepEqual(found('R2D2 and R2D22', 'R2D2'), ['R2D2']);
  // The placeholder that stands for an image or a line break ends a word.
  assert.deepEqual(found('Qarth￼Qarth', 'Qarth'), ['Qarth', 'Qarth']);
});

test('a spelling with other characters in it is searched for as it is', () => {
  assert.deepEqual(found('See example.con and example.cons, not anexample.con', 'example.con'), ['example.con']);
  assert.deepEqual(found('well-nigh, well-nighs, swell-nigh', 'well-nigh'), ['well-nigh']);
  // Together with ordinary words, in order, and without overlaps.
  assert.deepEqual(found('Qarth has well-nigh no gates. Qarth!', 'well-nigh', 'Qarth'), ['Qarth', 'well-nigh', 'Qarth']);
  assert.deepEqual(findIgnoredRanges('a-b a-b', ignoredForms(new Set(['a-b']))), [[0, 3], [4, 7]]);
});

test('the list belongs to one document and is forgotten when the document is closed', () => {
  assert.equal(ignoredWords('first').size, 0);
  assert.equal(ignoredWords(null).size, 0);
  const one = ignoreWord('first', 'Qarth’s');
  assert.deepEqual([...one], ['Qarth']);
  assert.equal(ignoredWords('first'), one, 'the same set until the list changes');
  assert.equal(ignoreWord('first', 'Qarth'), one, 'a word that is already ignored changes nothing');
  assert.equal(ignoreWord('first', '   '), one);
  assert.equal(ignoreWord('first', 'x'.repeat(101)), one);
  const two = ignoreWord('first', 'peeple');
  assert.notEqual(two, one, 'a new set when the list grows, so that the editor notices');
  assert.deepEqual([...two], ['Qarth', 'peeple']);
  assert.deepEqual([...one], ['Qarth'], 'the earlier set is left as it was');
  ignoreWord('second', 'Zorblat');
  assert.deepEqual([...ignoredWords('second')], ['Zorblat']);
  forgetIgnoredWords(['second']);
  assert.equal(ignoredWords('first').size, 0);
  assert.deepEqual([...ignoredWords('second')], ['Zorblat']);
  forgetIgnoredWords([]);
  assert.equal(ignoredWords('second').size, 0);
  assert.equal(ignoredForms(new Set()), NO_IGNORED_FORMS);
});
