import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertTypography, convertMarkdownTypography, keystrokeReplacement, insideProtectedMarkdown } from '../src/lib/smart-typography.ts';

test('quotes, dashes and ellipses in plain prose', () => {
  assert.equal(convertTypography(`"Hello," she said -- "it's Ruth's book..."`).text, `“Hello,” she said — “it’s Ruth’s book…”`);
  assert.equal(convertTypography(`'Tis the '90s ('quoted')`).text, `‘Tis the ‘90s (‘quoted’)`);
  assert.equal(convertTypography(`a--b ---rule--- ----`).text, `a—b ---rule--- ----`);
  assert.equal(convertTypography(`wait.... and ...`).text, `wait…. and …`);
  assert.equal(convertTypography(`"`, 'a').text, '”');
  assert.equal(convertTypography(`"`, '—').text, '“');
  assert.equal(convertTypography('no changes here').count, 0);
  assert.equal(convertTypography(`"x" -- ...`).count, 4);
});

test('as-you-type replacements in the source view', () => {
  assert.deepEqual(keystrokeReplacement('ab--', 4), { from: 2, to: 4, text: '—' });
  assert.deepEqual(keystrokeReplacement('ab—-', 4), { from: 2, to: 4, text: '---' });
  assert.equal(keystrokeReplacement('ab---', 5), null);
  assert.deepEqual(keystrokeReplacement('so...', 5), { from: 2, to: 5, text: '…' });
  assert.equal(keystrokeReplacement('so....', 6), null);
  assert.deepEqual(keystrokeReplacement('say "', 5), { from: 4, to: 5, text: '“' });
  assert.deepEqual(keystrokeReplacement('say "hi"', 8), { from: 7, to: 8, text: '”' });
  assert.deepEqual(keystrokeReplacement(`it'`, 3), { from: 2, to: 3, text: '’' });
  assert.deepEqual(keystrokeReplacement(`('`, 2), { from: 1, to: 2, text: '‘' });
  assert.equal(keystrokeReplacement('plain', 5), null);
});

test('backslash escapes in Markdown source are left alone', () => {
  // The typed character is escaped.
  assert.equal(keystrokeReplacement('say \\"', 6), null);
  assert.equal(keystrokeReplacement("it\\'", 4), null);
  assert.equal(keystrokeReplacement('a\\-', 3), null);
  // The first of a pair is escaped: "\--" and "\..." are Pandoc's literal hyphens and periods.
  assert.equal(keystrokeReplacement('a\\--', 4), null);
  assert.equal(keystrokeReplacement('so\\...', 6), null);
  // An escaped backslash does not escape what follows it.
  assert.deepEqual(keystrokeReplacement('C:\\\\"', 5), { from: 4, to: 5, text: '”' });
  assert.deepEqual(keystrokeReplacement('a\\\\--', 5), { from: 3, to: 5, text: '—' });
  // Whole-document conversion copies each escape and its character through.
  assert.equal(convertMarkdownTypography('He said \\"no\\" -- then \\-- and \\... wait...').text, 'He said \\"no\\" — then \\-- and \\... wait…');
  assert.equal(convertMarkdownTypography('1986\\. "Year" of C:\\\\Users "x"').text, '1986\\. “Year” of C:\\\\Users “x”');
  assert.equal(convertMarkdownTypography('\\`not code "x"` and \\$\\$ "y"').text, '\\`not code “x”` and \\$\\$ “y”');
});

test('protected regions while typing Markdown', () => {
  assert.equal(insideProtectedMarkdown('---\ntitle: "x"\n', 13), true);
  assert.equal(insideProtectedMarkdown('---\ntitle: x\n---\n"', 18), false);
  assert.equal(insideProtectedMarkdown('```js\nvar x = "', 15), true);
  assert.equal(insideProtectedMarkdown('```js\nx\n```\n"', 13), false);
  assert.equal(insideProtectedMarkdown('use `code "', 11), true);
  assert.equal(insideProtectedMarkdown('use `code` "', 12), false);
  assert.equal(insideProtectedMarkdown("$5 and '", 8), false);
  assert.equal(insideProtectedMarkdown("$$f'", 4), true);
  assert.equal(insideProtectedMarkdown('[t](http://x/"', 14), true);
  assert.equal(insideProtectedMarkdown('[t](http://x/) "', 16), false);
  assert.equal(insideProtectedMarkdown('<a href="', 9), true);
  assert.equal(insideProtectedMarkdown('| a | b |\n|--', 13), true);
  assert.equal(insideProtectedMarkdown('[ref]: http://x "', 17), true);
  assert.equal(insideProtectedMarkdown('<!-- note --', 12), true);
});

test('whole-document conversion leaves Markdown syntax alone', () => {
  const md = [
    '---', 'title: "Front matter stays"', '---', '', '# "Heading"', '',
    `Ruth's "quote" -- and more...`, '', '```', 'code "stays" -- ...', '```', '',
    'Inline `code "x"` and $5 \'or\' $10 and $$f\'(x)$$ and [link "t"](http://e.com/a--b "title") <b class="c">x</b>.', '',
    '| A | B |', '| -- | --- |', '| "x" | y |', '', '[ref]: http://example.com "Title"', '',
    '$$', "f'(x)", '$$', '', '<!--', 'comment "x"', '-->', '', '---', '', 'Last "one"', '[[Ruth\'s note]]',
  ].join('\n');
  const result = convertMarkdownTypography(md);
  const expected = [
    '---', 'title: "Front matter stays"', '---', '', '# “Heading”', '',
    `Ruth’s “quote” — and more…`, '', '```', 'code "stays" -- ...', '```', '',
    'Inline `code "x"` and $5 ‘or’ $10 and $$f\'(x)$$ and [link “t”](http://e.com/a--b "title") <b class="c">x</b>.', '',
    '| A | B |', '| -- | --- |', '| “x” | y |', '', '[ref]: http://example.com "Title"', '',
    '$$', "f'(x)", '$$', '', '<!--', 'comment "x"', '-->', '', '---', '', 'Last “one”', '[[Ruth\'s note]]',
  ].join('\n');
  assert.equal(result.text, expected);
  assert.equal(result.count, 15);
  assert.equal(convertMarkdownTypography(expected).count, 0);
  assert.equal(convertMarkdownTypography('').text, '');
});
