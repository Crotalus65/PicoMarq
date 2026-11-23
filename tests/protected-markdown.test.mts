import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insideProtectedMarkdown, protectedMarkdownPlaces } from '../src/lib/smart-typography.ts';

// protectedMarkdownPlaces must give, at every place of every text, the answer
// insideProtectedMarkdown gives there.
const same = (markdown: string, step = 1) => {
  const places = protectedMarkdownPlaces(markdown);
  for (let caret = 0; caret <= markdown.length; caret += step) {
    assert.equal(places(caret), insideProtectedMarkdown(markdown, caret), `at ${caret} of ${JSON.stringify(markdown.slice(0, 60))}: ${JSON.stringify(markdown.slice(Math.max(0, caret - 25), caret))}|`);
  }
};

test('the same answers as insideProtectedMarkdown in a document with every kind of protected text', () => {
  same([
    '---', 'title: "A Book"', 'dashes: --', '---', '',
    '# Heading', '', 'Prose with "quotes" and `inline "code"` and more "prose".', '',
    '```js', 'const s = "text" -- ...;', '```', '', 'After the fence.', '',
    '~~~', "it's code", '~~~', '',
    '$$', 'x -- y', '$$', '', 'Inline $$a "b"$$ math and $5 for "that".', '',
    '<!-- a "comment" --> after it "prose"', '<!-- open', 'still "inside"', '--> and "out" again', '',
    'A [link "text"](https://example.com/a--b "title") and <span class="x">tag</span> and <https://x.example/a--b>.', '',
    '[ref]: https://example.com "Title"', '',
    '| a | b |', '|---|:-:|', '| "x" | y |', '',
    '---', '', 'A rule above. The end "here".',
  ].join('\n'));
});

test('the same answers without front matter, with an unclosed fence, and with front matter that never closes', () => {
  same('Plain "text".\n\n---\n\n```\nunclosed "fence"\nto the end');
  same('---\ntitle: x\nnever: "closed"\n\n# Heading "here"\n');
  same('--- \nkey: v\n---   \n"After" front matter with spaces after the fences.\n--- \n');
  same('$$\nmath "never" closed\n');
  same('');
  same('---');
  same('---\n---');
});

test('the same answers in generated documents', () => {
  const pieces = ['---', '```', '~~~', '$$', '<!--', '-->', '`', '"', "'", '--', '...', '](', ')', '<a ', '>', '|', '|---|', '[r]: ', ' ', 'word', '\n', '\n', '\n', '   ', '\t', '$', '---   '];
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let round = 0; round < 400; round++) {
    let markdown = round % 3 === 0 ? '---\n' : '';
    const length = 5 + Math.floor(random() * 40);
    for (let i = 0; i < length; i++) markdown += pieces[Math.floor(random() * pieces.length)];
    same(markdown);
  }
});

test('asked only at some places, in ascending order, the answers are the same', () => {
  const markdown = ('Prose "one" with `code "x"` here.\n\n```\ncode "block"\n```\n\n').repeat(40);
  same(markdown, 7);
  same(markdown, 131);
});
