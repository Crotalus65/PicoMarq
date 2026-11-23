import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from 'prosemirror-model';
import { findInText, findPattern } from '../src/lib/find-text.ts';
import { findInDocument } from '../src/lib/find-in-document.ts';

const found = (query: string, text: string) => {
  const pattern = findPattern(query);
  return pattern ? findInText(text, pattern).matches.map(match => text.slice(match.from, match.to)) : [];
};

test('capital and small letters count as the same, and the text is looked for as it is', () => {
  assert.deepEqual(found('qarth', 'Qarth, QARTH and qarth.'), ['Qarth', 'QARTH', 'qarth']);
  assert.deepEqual(found('a.b', 'a.b axb'), ['a.b']);
  assert.deepEqual(found('(x)[y]{z}*+?^$|\\', 'see (x)[y]{z}*+?^$|\\ here'), ['(x)[y]{z}*+?^$|\\']);
  assert.deepEqual(found('café 😀', 'A CAFÉ 😀 and a cafe 😀'), ['CAFÉ 😀']);
  assert.equal(findPattern(''), null);
});

test('a straight apostrophe or quotation mark finds the curly ones too', () => {
  assert.deepEqual(found("don't", "Don’t, don't, don‘t, dont"), ['Don’t', "don't", 'don‘t']);
  assert.deepEqual(found('"yes"', 'She said “yes” and "yes" and ”yes“.'), ['“yes”', '"yes"', '”yes“']);
  assert.deepEqual(found("'", "it’s ‘so’ 'x'").length, 5);
});

test('two hyphens find an em dash, three periods an ellipsis', () => {
  assert.deepEqual(found('--', 'a—b a--b a-b'), ['—', '--']);
  assert.deepEqual(found('word--word', 'word—word, word--word'), ['word—word', 'word--word']);
  assert.deepEqual(found('...', 'wait… wait... wait..'), ['…', '...']);
  assert.deepEqual(found('wait....', 'wait…. wait....'), ['wait….', 'wait....']);
  assert.deepEqual(found('......', '…… ......'), ['……', '......']);
});

test('a longer run of hyphens is looked for as it is', () => {
  assert.deepEqual(found('---', '--- —- |---|'), ['---', '---']);
  assert.deepEqual(found('-', 'a-b — c'), ['-']);
  // Two typed hyphens are still found inside a longer run, as before.
  assert.deepEqual(found('--', '---'), ['--']);
});

test('one way only: the typeset characters find themselves', () => {
  assert.deepEqual(found('—', 'a—b a--b |---|'), ['—']);
  assert.deepEqual(found('…', 'wait… wait...'), ['…']);
  assert.deepEqual(found('don’t', "don’t don't"), ['don’t']);
  assert.deepEqual(found('“yes”', '“yes” "yes"'), ['“yes”']);
});

test('matches do not overlap; a limit cuts the list, not the count', () => {
  const pattern = findPattern('aa') as RegExp;
  assert.deepEqual(findInText('aaaaa', pattern).matches, [{ from: 0, to: 2 }, { from: 2, to: 4 }]);
  const many = findInText('x '.repeat(1200), findPattern('x') as RegExp, 500);
  assert.equal(many.matches.length, 500);
  assert.equal(many.total, 1200);
  assert.deepEqual(many.matches[499], { from: 998, to: 999 });
});

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    codeBlock: { group: 'block', content: 'text*', code: true },
    blockquote: { group: 'block', content: 'block+' },
    hardBreak: { group: 'inline', inline: true },
    text: { group: 'inline' },
  },
  marks: { italic: {}, bold: {}, link: { attrs: { href: {} } } },
});
const text = (value: string, ...marks: string[]) => schema.text(value, marks.map(name => schema.mark(name, name === 'link' ? { href: 'https://example.com' } : null)));
const paragraph = (...content: Parameters<typeof schema.node>[2][]) => schema.node('paragraph', null, content as never);

test('a phrase is found across a change of formatting, at the right places', () => {
  const doc = schema.node('doc', null, [
    paragraph(text('She read the '), text('Odyssey', 'italic'), text(' in a week.')),
    schema.node('blockquote', null, [paragraph(text('He said '), text('stop', 'bold'), text(' right there. A '), text('linked phrase', 'link'), text('.'))]),
    paragraph(text('Plain: read the Odyssey in a week.')),
  ]);
  const look = (query: string) => findInDocument(doc, findPattern(query) as RegExp).matches.map(match => doc.textBetween(match.from, match.to));
  assert.deepEqual(look('the odyssey in'), ['the Odyssey in', 'the Odyssey in']);
  assert.deepEqual(look('said stop right'), ['said stop right']);
  assert.deepEqual(look('a linked'), ['A linked']);
  assert.deepEqual(look('odyssey'), ['Odyssey', 'Odyssey']);
  // The positions are those of the document: the first paragraph starts at 1.
  assert.deepEqual(findInDocument(doc, findPattern('read the Odyssey') as RegExp).matches[0], { from: 5, to: 21 });
});

test('a match does not run across a line break or from one paragraph into the next', () => {
  const doc = schema.node('doc', null, [
    paragraph(text('one'), schema.node('hardBreak'), text('two')),
    paragraph(text('three')),
    schema.node('codeBlock', null, [text('git log --oneline')]),
  ]);
  const look = (query: string) => findInDocument(doc, findPattern(query) as RegExp).matches.map(match => doc.textBetween(match.from, match.to));
  assert.deepEqual(look('onetwo'), []);
  assert.deepEqual(look('twothree'), []);
  assert.deepEqual(look('two'), ['two']);
  assert.deepEqual(findInDocument(doc, findPattern('two') as RegExp).matches[0], { from: 5, to: 8 });
  assert.deepEqual(look('--oneline'), ['--oneline']);
  assert.deepEqual(look('—'), []);
});

test('in a document too, a limit cuts the list and not the count', () => {
  const doc = schema.node('doc', null, Array.from({ length: 300 }, () => paragraph(text('Qarth and Qarth and '), text('Qarth', 'italic'))));
  const result = findInDocument(doc, findPattern('qarth') as RegExp, 500);
  assert.equal(result.matches.length, 500);
  assert.equal(result.total, 900);
  assert(result.matches.every((match, index) => index === 0 || match.from >= result.matches[index - 1].to));
});
