import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { countWords, countDocumentWords, countSelectedWords, wordCountLabel } from '../src/lib/word-count.ts';

// The node shapes that matter to counting: text blocks, containers, a table,
// a block without content (rule), and inline nodes without text (image, break).
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
    codeBlock: { group: 'block', content: 'text*', code: true, marks: '' },
    horizontalRule: { group: 'block' },
    table: { group: 'block', content: 'tableRow+' },
    tableRow: { content: 'tableCell+' },
    tableCell: { content: 'paragraph+' },
    image: { group: 'inline', inline: true, atom: true },
    hardBreak: { group: 'inline', inline: true, selectable: false },
    text: { group: 'inline' },
  },
  marks: { bold: {}, italic: {} },
});
const n = (type: string, ...content: (ProseMirrorNode | string)[]) =>
  schema.node(type, null, content.filter(item => item !== '').map(item => typeof item === 'string' ? schema.text(item) : item));
const p = (...content: (ProseMirrorNode | string)[]) => n('paragraph', ...content);
const bold = (text: string) => schema.text(text, [schema.mark('bold')]);

const sample = n('doc',
  n('heading', 'A short title'),
  p('First paragraph, with ', bold('bold words'), ' and a half-selected wordbreak.'),
  p(),
  p(n('image')),
  n('horizontalRule'),
  p('Line one', n('hardBreak'), 'line two — and “quotes”, 1,234 numbers.'),
  n('bulletList', n('listItem', p('Item one')), n('listItem', p('Item two'), n('bulletList', n('listItem', p('Nested item'))))),
  n('blockquote', p('Quoted text here.'), p('   ')),
  n('codeBlock', 'let x = 1;\n\nreturn x;'),
  n('table',
    n('tableRow', n('tableCell', p('Name')), n('tableCell', p('Two words'))),
    n('tableRow', n('tableCell', p()), n('tableCell', p('Last cell text')))),
  p('...'),
  p('Résumé naïve café.'),
);

const range = (doc: ProseMirrorNode, from: number, to: number) => ({ $from: doc.resolve(from), $to: doc.resolve(to) });
// The slow definitions the fast function must match.
const slowWords = (doc: ProseMirrorNode, from: number, to: number) => countWords(doc.textBetween(from, to, '\n', '\n'));
const slowHasText = (doc: ProseMirrorNode, from: number, to: number) => doc.textBetween(from, to, '', () => '') !== '';

function checkEveryRange(doc: ProseMirrorNode) {
  const size = doc.content.size;
  let checked = 0;
  for (let from = 0; from <= size; from++) {
    for (let to = from; to <= size; to++) {
      const expected = slowHasText(doc, from, to) ? slowWords(doc, from, to) : null;
      const actual = countSelectedWords(doc, [range(doc, from, to)]);
      if (actual !== expected) assert.fail(`range ${from}-${to}: got ${actual}, expected ${expected} for ${JSON.stringify(doc.textBetween(from, to, '\n', '\n'))}`);
      checked++;
    }
  }
  return checked;
}

test('selected words match the slow count for every range of a mixed document', () => {
  assert.equal(countDocumentWords(sample), slowWords(sample, 0, sample.content.size));
  const checked = checkEveryRange(sample);
  assert(checked > 20000, `only ${checked} ranges checked`);
});

test('selecting everything gives the document count', () => {
  const total = countDocumentWords(sample);
  assert(total > 40);
  assert.equal(countSelectedWords(sample, new AllSelection(sample).ranges), total);
  // From the first to the last text position, as a mouse drag or Shift+Ctrl+End gives.
  assert.equal(countSelectedWords(sample, TextSelection.create(sample, 1, sample.content.size - 1).ranges), total);
});

test('no text selected gives null; text without words gives 0', () => {
  const at = (text: string) => { let found = -1; sample.descendants((node, pos) => { if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text); }); return found; };
  // A caret.
  assert.equal(countSelectedWords(sample, TextSelection.create(sample, 3, 3).ranges), null);
  // An image, a horizontal rule, and an empty paragraph: nothing with text.
  let image = -1, rule = -1;
  sample.descendants((node, pos) => { if (node.type.name === 'image') image = pos; if (node.type.name === 'horizontalRule') rule = pos; });
  assert.equal(countSelectedWords(sample, NodeSelection.create(sample, image).ranges), null);
  assert.equal(countSelectedWords(sample, NodeSelection.create(sample, rule).ranges), null);
  const title = sample.child(0).nodeSize;
  const first = title + sample.child(1).nodeSize;
  assert.equal(countSelectedWords(sample, [range(sample, first, first + sample.child(2).nodeSize)]), null);
  // From the end of one paragraph across the empty one, the image and the rule.
  assert.equal(countSelectedWords(sample, [range(sample, first - 1, rule + 1)]), null);
  // Spaces and punctuation are text, but not words.
  const comma = at(', with ');
  assert.equal(countSelectedWords(sample, [range(sample, comma, comma + 2)]), 0);
  const dots = at('...');
  assert.equal(countSelectedWords(sample, [range(sample, dots, dots + 3)]), 0);
  // Part of a word is a word. "half-selected word" is three: the document
  // count also takes the two halves of a hyphenated word as two words.
  const word = at('wordbreak');
  assert.equal(countSelectedWords(sample, [range(sample, word + 2, word + 6)]), 1);
  assert.equal(sample.textBetween(word - 14, word + 4), 'half-selected word');
  assert.equal(countSelectedWords(sample, [range(sample, word - 14, word + 4)]), 3);
  assert.equal(countSelectedWords(sample, [range(sample, word - 2, word + 4)]), 2);
  // A selection that runs through bold text counts across the mark.
  const boldText = at('bold words');
  assert.equal(countSelectedWords(sample, [range(sample, boldText - 5, boldText + 4)]), 2);
});

test('several ranges (selected table cells) add up', () => {
  const cells: Array<{ from: number; to: number; words: number }> = [];
  sample.descendants((node, pos) => {
    if (node.type.name === 'tableCell') cells.push({ from: pos + 1, to: pos + node.nodeSize - 1, words: countWords(node.textContent) });
  });
  assert.deepEqual(cells.map(cell => cell.words), [1, 2, 0, 3]);
  const ranges = cells.map(cell => range(sample, cell.from, cell.to));
  assert.equal(countSelectedWords(sample, ranges), 6);
  assert.equal(countSelectedWords(sample, [ranges[1], ranges[3]]), 5);
  // An empty cell alone has no text.
  assert.equal(countSelectedWords(sample, [ranges[2]]), null);
  assert.equal(countSelectedWords(sample, [ranges[2], ranges[0]]), 1);
  assert.equal(countSelectedWords(sample, []), null);
});

test('random documents and edits keep the fast and slow counts equal', () => {
  // A small fixed pseudo-random sequence, so a failure can be reproduced.
  let seed = 20261121;
  const random = (limit: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % limit; };
  const words = ['alpha', 'beta', 'gamma', "don't", 'co-op', '3.14', 'naïve', '—', '...', 'x', 'and', 'the', '', ' ', 'word,', '(aside)'];
  const sentence = () => Array.from({ length: random(7) }, () => words[random(words.length)]).join(' ');
  const inline = () => {
    const parts: (ProseMirrorNode | string)[] = [];
    for (let i = random(4); i >= 0; i--) parts.push([sentence(), bold(sentence() || 'b'), n('image'), n('hardBreak')][random(4)]);
    return parts;
  };
  const block = (depth = 0): ProseMirrorNode => {
    switch (random(depth > 1 ? 4 : 8)) {
      case 0: return n('heading', ...inline());
      case 1: return p();
      case 2: return n('horizontalRule');
      case 3: return p(...inline());
      case 4: return n('blockquote', ...Array.from({ length: 1 + random(2) }, () => block(depth + 1)));
      case 5: return n('bulletList', ...Array.from({ length: 1 + random(3) }, () => n('listItem', p(...inline()), ...(random(3) === 0 ? [block(depth + 1)] : []))));
      case 6: return n('codeBlock', [sentence(), sentence()].join('\n'));
      default: return n('table', ...Array.from({ length: 1 + random(2) }, () => n('tableRow', ...Array.from({ length: 1 + random(3) }, () => n('tableCell', p(...inline()))))));
    }
  };
  let ranges = 0;
  for (let round = 0; round < 40; round++) {
    let doc = n('doc', ...Array.from({ length: 1 + random(8) }, () => block()));
    for (let edit = 0; edit < 4; edit++) {
      const size = doc.content.size;
      assert.equal(countDocumentWords(doc), slowWords(doc, 0, size));
      assert.equal(countSelectedWords(doc, new AllSelection(doc).ranges), slowHasText(doc, 0, size) ? countDocumentWords(doc) : null);
      for (let i = 0; i < 150; i++) {
        const a = random(size + 1), b = random(size + 1);
        const from = Math.min(a, b), to = Math.max(a, b);
        const expected = slowHasText(doc, from, to) ? slowWords(doc, from, to) : null;
        assert.equal(countSelectedWords(doc, [range(doc, from, to)]), expected, `round ${round}, edit ${edit}, range ${from}-${to}`);
        ranges++;
      }
      // Replace one block; the others keep their identity and cached counts.
      const index = random(doc.childCount);
      const children: ProseMirrorNode[] = [];
      doc.forEach((child, _offset, i) => { children.push(i === index ? block() : child); });
      doc = schema.node('doc', null, children);
    }
  }
  assert.equal(ranges, 40 * 4 * 150);
});

test('status bar label', () => {
  assert.equal(wordCountLabel(0, null), '0 words');
  assert.equal(wordCountLabel(1, null), '1 word');
  assert.equal(wordCountLabel(2, null), '2 words');
  assert.equal(wordCountLabel(1234, null), `${(1234).toLocaleString()} words`);
  assert.equal(wordCountLabel(1234, 56), `56 of ${(1234).toLocaleString()} words`);
  assert.equal(wordCountLabel(23456, 1234), `${(1234).toLocaleString()} of ${(23456).toLocaleString()} words`);
  assert.equal(wordCountLabel(12, 0), '0 of 12 words');
  assert.equal(wordCountLabel(12, 12), '12 of 12 words');
  assert.equal(wordCountLabel(1, 1), '1 of 1 word');
  assert.equal(wordCountLabel(1, 0), '0 of 1 word');
});
