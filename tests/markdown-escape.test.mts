import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lexer } from 'marked';
import { escapeMarkdownText } from '../src/lib/markdown-escape.ts';

// What marked (the parser behind TipTap's Markdown extension) reads back from
// a paragraph: the text of every inline token, or null if any token is not
// plain text or an escape, or if the source did not parse as one paragraph.
function readBack(markdown: string): string | null {
  const blocks = new Lexer().lex(markdown);
  if (blocks.length !== 1 || blocks[0].type !== 'paragraph') return null;
  const paragraph = blocks[0] as { tokens: Array<{ type: string; text: string }> };
  let text = '';
  for (const token of paragraph.tokens) {
    if (token.type !== 'text' && token.type !== 'escape') return null;
    text += token.text;
  }
  return text;
}

test('characters that are syntax anywhere are escaped', () => {
  assert.equal(escapeMarkdownText('5 * 3 = 15 and *not italic*'), '5 \\* 3 = 15 and \\*not italic\\*');
  assert.equal(escapeMarkdownText('C:\\Users\\Ruth'), 'C:\\\\Users\\\\Ruth');
  assert.equal(escapeMarkdownText('a [sic] b [link](http://x) ![img](y) [[note]]'), 'a \\[sic\\] b \\[link\\](http://x) !\\[img\\](y) \\[\\[note\\]\\]');
  assert.equal(escapeMarkdownText('use `code` and ~~gone~~ and ~5'), 'use \\`code\\` and \\~\\~gone\\~\\~ and \\~5');
  assert.equal(escapeMarkdownText('snake_case_name but _emphasis_ and foo_ bar _baz'), 'snake_case_name but \\_emphasis\\_ and foo\\_ bar \\_baz');
  assert.equal(escapeMarkdownText('p < .05, a <b>bold</b> tag, <!-- c -->, <https://x.y>, 3 <5'), 'p < .05, a \\<b>bold\\</b> tag, \\<!-- c -->, \\<https://x.y>, 3 <5');
  assert.equal(escapeMarkdownText('$5 and $10, but $$math$$'), '$5 and $10, but \\$\\$math\\$\\$');
  assert.equal(escapeMarkdownText('a | b'), 'a | b');
  assert.equal(escapeMarkdownText('a | b', { inTableCell: true }), 'a \\| b');
  assert.equal(escapeMarkdownText('plain prose, with "quotes" & ampersands -- fine...'), 'plain prose, with "quotes" & ampersands -- fine...');
});

test('what would start a block is escaped only at the start of a line', () => {
  const start = { lineStart: true };
  assert.equal(escapeMarkdownText('# Not a heading', start), '\\# Not a heading');
  assert.equal(escapeMarkdownText('#hashtag and #1', start), '#hashtag and #1');
  assert.equal(escapeMarkdownText('####### seven', start), '####### seven');
  assert.equal(escapeMarkdownText('> quoted', start), '\\> quoted');
  assert.equal(escapeMarkdownText('- item', start), '\\- item');
  assert.equal(escapeMarkdownText('+ item', start), '\\+ item');
  assert.equal(escapeMarkdownText('-', start), '\\-');
  assert.equal(escapeMarkdownText('-5 degrees', start), '-5 degrees');
  assert.equal(escapeMarkdownText('1986. A good year.', start), '1986\\. A good year.');
  assert.equal(escapeMarkdownText('12) twelve', start), '12\\) twelve');
  assert.equal(escapeMarkdownText('1.5 is a number', start), '1.5 is a number');
  assert.equal(escapeMarkdownText('1234567890. ten digits', start), '1234567890. ten digits');
  assert.equal(escapeMarkdownText('---', start), '\\---');
  assert.equal(escapeMarkdownText('- - -', start), '\\- - -');
  assert.equal(escapeMarkdownText('===', start), '\\===');
  assert.equal(escapeMarkdownText('  # indented', start), '  \\# indented');
  // Mid-line, none of these mean anything.
  assert.equal(escapeMarkdownText('# Not a heading'), '# Not a heading');
  assert.equal(escapeMarkdownText('1986. A good year.'), '1986. A good year.');
  // Every line after a newline is a line start.
  assert.equal(escapeMarkdownText('first\n# second\n1. third\n---'), 'first\n\\# second\n1\\. third\n\\---');
});

test('a trailing run of # at the end of a heading is kept', () => {
  const end = { headingEnd: true };
  assert.equal(escapeMarkdownText('Topic #', end), 'Topic \\#');
  assert.equal(escapeMarkdownText('Topic ###  ', end), 'Topic \\###  ');
  assert.equal(escapeMarkdownText('#', end), '\\#');
  assert.equal(escapeMarkdownText('C#', end), 'C#');
  assert.equal(escapeMarkdownText('Topic #', {}), 'Topic #');
});

test('marked reads escaped prose back as the same text', () => {
  const samples = [
    '5 * 3 = 15 and *not italic* and **not bold**',
    'C:\\Users\\Ruth\\Documents\\draft.md',
    // (A bare URL is an autolink in GFM, as in every Markdown editor, so none appears here.)
    'A [bracketed] aside and a [link](page.html) and [[wikilink]]',
    'Budget: $1,200 and $$500$$ for books',
    'Significant at p < .05* and <b>not bold</b> <!-- not a comment -->',
    'snake_case and _not emphasis_ and __not bold__',
    '`not code` and ~~not struck~~',
    '# Not a heading',
    '> Not a quote',
    '- Not a list',
    '* Not a list',
    '+ Not a list',
    '1986. Not a list',
    '1) Not a list',
    '---',
    '***',
    '___',
    '===',
    'line one\n# line two\n- line three\n1. line four\n---',
    'Trailing backslash \\',
    'A \\* already escaped asterisk',
    'Mixed *_`[]~\\$$<>#- soup',
  ];
  for (const text of samples) {
    const escaped = escapeMarkdownText(text, { lineStart: true });
    assert.equal(readBack(escaped), text, `escaped as ${JSON.stringify(escaped)}`);
  }
});

test('random prose round-trips through marked', () => {
  const pieces = ['word', 'two words', ' ', ' ', '\n', '*', '**', '_', '__', '`', '[', ']', '(', ')', '!', '~', '~~', '\\', '$', '$$', '<', '>', '#', '##', '-', '--', '+', '1.', '12)', '.', '=', '|', '"', "'", 'a_b', 'x*y', '://', 'é', '日本'];
  let seed = 11;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let checked = 0;
  for (let i = 0; i < 4000; i++) {
    const n = 1 + Math.floor(rand() * 9);
    let text = Array.from({ length: n }, () => pieces[Math.floor(rand() * pieces.length)]).join('');
    // marked drops leading blank lines and trailing whitespace of a paragraph
    // and treats a line of only spaces as a paragraph break, as any Markdown
    // tool would; those are not escaping questions.
    text = text.replace(/^\s+|\s+$/g, '').replace(/\n[ \t]*\n/g, '\n');
    if (!text || /[ \t]+\n|\n[ \t]+/.test(text)) continue;
    const escaped = escapeMarkdownText(text, { lineStart: true });
    assert.equal(readBack(escaped), text, `text ${JSON.stringify(text)} escaped as ${JSON.stringify(escaped)}`);
    checked++;
  }
  assert.ok(checked > 3000, `only ${checked} samples checked`);
});
