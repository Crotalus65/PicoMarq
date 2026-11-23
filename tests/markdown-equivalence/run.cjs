// Checks that the performance paths produce exactly what TipTap's stock code
// produces: Markdown parsing (bounded list tokenizers), Markdown serialization
// (per-block cache), word counting (per-block cache; also the words of a
// selection, for random ranges of every document state), and code highlighting
// (incremental lowlight plugin, compared against a fresh full computation).
// Also checks that what PicoMarQ writes reads back as the same document (the
// backslash escapes it adds on output, and keeps on input).
//
// Usage: npm run test:equivalence   (builds the harness with Vite, then runs
// it inside Electron through Playwright; needs no graphical session).
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright');

const corpus = [];
const add = (name, md) => corpus.push({ name, md });

add('empty', '');
add('blank-lines-only', '\n\n\n');
add('simple-ordered', '1. one\n2. two\n3. three\n');
add('ordered-no-trailing-newline', '1. one\n2. two');
add('ordered-start-5', '5. five\n6. six\n\nparagraph\n');
add('ordered-nested', '1. one\n   1. nested a\n   2. nested b\n2. two\n   - bullet inside\n3. three\n');
add('ordered-continuation', '1. one\n   continued line\n\n   second paragraph in item\n2. two\n');
add('ordered-blank-lines-between', '1. one\n\n2. two\n\n\n3. three\n\nnot a list\n');
add('ordered-then-indented-text', '1. one\n2. two\n   indented but not item\nunindented ends\n');
add('ordered-followed-by-heading', '1. one\n# Heading\nmore\n');
add('ordered-tab-indent', '1. one\n\t1. tab nested\n2. two\n');
add('ordered-at-eof-with-blanks', 'para\n\n1. one\n2. two\n\n\n');
add('number-not-list', '2024. was a year\n\n1.5 is a number\n1.no space\n');
add('ordered-crlf', '1. one\r\n2. two\r\n\r\npara\r\n');
add('ordered-inside-blockquote', '> 1. one\n> 2. two\n>\n> para\n');
add('ordered-with-code', '1. one\n\n   ```js\n   code();\n   ```\n\n2. two\n');
add('ordered-after-paragraph-no-blank', 'para line\n1. one\n2. two\n');
add('task-simple', '- [ ] a\n- [x] b\n- [X] c\n');
add('task-nested', '- [ ] a\n  - [ ] a1\n    - [x] a11\n  - [x] a2\n- [ ] b\n');
add('task-blank-lines', '- [ ] a\n\n- [ ] b\n\n\nparagraph\n');
add('task-continuation', '- [ ] a\n  more text\n\n  another para\n- [ ] b\n');
add('task-leading-blank', '\n\n- [ ] a\n- [ ] b\n');
add('task-then-bullets', '- [ ] a\n- plain bullet\n- [ ] b\n');
add('task-then-indented-nonitem', '- [ ] a\n  - not task\n    deeper\n- [ ] b\nend\n');
add('task-at-eof', 'intro\n\n- [ ] a\n- [ ] b');
add('task-crlf', '- [ ] a\r\n- [x] b\r\n\r\ntext\r\n');
add('task-mixed-markers', '* [ ] star\n+ [x] plus\n- [ ] dash\n');
add('task-inside-ordered', '1. one\n   - [ ] sub task\n   - [x] done\n2. two\n');
add('bullets-plain', '- a\n- b\n  - c\n- d\n');
add('all-indented', '   indented first\n   second\n   third\n');
add('only-indented-after-list', '1. one\n   a\n   b\n   c\n');
add('frontmatter', '---\ntitle: X\n---\n\n# Title\n\n1. one\n2. two\n');
add('frontmatter-only', '---\na: 1\n---\n');
add('hr-and-lists', 'para\n\n---\n\n1. one\n\n***\n\n- [ ] t\n');
add('table', '| A | B |\n| --- | --- |\n| 1. x | - [ ] y |\n');
add('math', '$$\nE = mc^2\n$$\n\nInline $x$ here.\n\n1. one\n');
add('wikilink', 'See [[Other note]] and [[Another]].\n\n- [ ] [[Task note]]\n');
add('html-ish', '<div>html</div>\n\n1. one\n');
add('code-fence-with-list-syntax', '```\n1. not a list\n- [ ] not a task\n```\n\n1. real\n');
add('code-languages', '```python\ndef f():\n    return 1\n```\n\n```\nplain fence\nimport os\n```\n\n```unknownlang\nx = 1\n```\n');
add('deep-nesting', '1. a\n   1. b\n      1. c\n         1. d\n            1. e\n2. f\n');
add('long-list', Array.from({ length: 300 }, (_, i) => `${i + 1}. item ${i}`).join('\n') + '\n');
add('long-task-list', Array.from({ length: 300 }, (_, i) => `- [${i % 2 ? 'x' : ' '}] task ${i}`).join('\n') + '\n');
add('many-paragraphs-no-lists', Array.from({ length: 500 }, (_, i) => `Paragraph ${i} with some words.`).join('\n\n') + '\n');
add('nbsp-paragraphs', 'a\n\n&nbsp;\n\nb\n\n&nbsp;\n');
add('only-nbsp', '&nbsp;\n');
add('unicode', 'Résumé naïve café — 123 !!! 日本語の文章です。\n\n1. 項目\n2. 項目二\n');
add('rtl', 'שלום עולם\n\n1. פריט\n2. פריט\n\nمرحبا بالعالم\n');
add('trailing-spaces', '1. one  \n2. two  \n\npara  \nbreak\n');
add('windows-paths', 'C:\\Users\\ruth\\notes.md\n\n1. C:\\path\n');
add('dollar-signs', 'Price $5 and $10 total\n\n1. $x$ math\n');
add('emphasis-across-lines', '**bold\ntext** here\n\n*em* and _em_\n');
add('links', '[text](https://example.com) and <https://auto.link> and https://bare.example\n');
add('images', '![alt](image.png)\n\n1. ![in list](a.png)\n');
add('headings-all', '# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6\n');
add('setext', 'Title\n=====\n\nSub\n---\n');
add('blockquote-nested', '> quote\n> > nested\n>\n> - [ ] task in quote\n');
add('hardbreak', 'line one  \nline two\\\nline three\n');
add('strike-code', '~~strike~~ and `code` and ``double `tick` code``\n');
add('ordered-two-digit-indent', '10. ten\n11. eleven\n    continued\n12. twelve\n');
add('mixed-sep', '1. a\n\n\n\n- [ ] b\n\n\n\n2. c\n');

// A larger generated document mixing every block type.
{
  const parts = ['---', 'title: Generated', '---', '', '# Generated document', ''];
  for (let section = 0; section < 120; section++) {
    parts.push(`## Section ${section}`, '', `Paragraph ${section} with **bold**, *italic*, \`code\`, a [link](https://example.org/${section}) and $x_${section}$ math.`, '');
    switch (section % 8) {
      case 0: parts.push('- [x] done task', '- [ ] open task', '  - [ ] nested task', ''); break;
      case 1: parts.push('1. first', '2. second', '   continued', '3. third', ''); break;
      case 2: parts.push('| A | B |', '| --- | --- |', '| 1 | 2 |', ''); break;
      case 3: parts.push('```python', `def f${section}():`, `    return ${section}`, '```', ''); break;
      case 4: parts.push('$$', `E_${section} = mc^2`, '$$', ''); break;
      case 5: parts.push('> quoted', '> more', ''); break;
      case 6: parts.push('- bullet', '- another', '', '---', ''); break;
      default: parts.push('```', 'unlabeled fence', 'import os', '```', '');
    }
  }
  add('generated-mixed', parts.join('\n'));
}
for (const file of ['README.md', 'UPSTREAM-README.md']) {
  try { add(file, fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8')); } catch { /* optional */ }
}

// Documents whose prose Markdown would misread unless escaped, and files that
// other programs escaped. Each must read back as the same document after PicoMarQ
// writes it, and the text PicoMarQ shows for a few of them is checked too.
const escapes = [];
const addEscape = (name, md, text) => escapes.push({ name, md, text });
addEscape('pandoc-escapes', 'Budget: \\$1,200 for travel and \\$300 for books.\n\nSignificant at p \\< .05\\* (asterisk = one-tailed).\n\nSaved as chapter\\_one\\_draft.md, tagged \\#revise.\n\nPath: C:\\\\Users\\\\Ruth\\\\Documents\n\n1986\\. A good year.\n\nA \\[bracketed\\] aside.\n',
  ['Budget: $1,200 for travel and $300 for books.', 'Significant at p < .05* (asterisk = one-tailed).', 'Saved as chapter_one_draft.md, tagged #revise.', 'Path: C:\\Users\\Ruth\\Documents', '1986. A good year.', 'A [bracketed] aside.']);
addEscape('escapes-in-structures', '# Heading with \\* star and \\#\n\n- item with \\[brackets\\]\n- \\# not a nested heading\n\n> quote with \\_underscores\\_\n\n1. first\n2. \\> not a quote\n\n| A | B |\n| --- | --- |\n| a \\| pipe | \\*star\\* |\n\n**bold \\*star\\*** and *em \\_u\\_* and [link \\]text](http://e.com) and `code \\* stays`\n',
  ['Heading with * star and #', 'item with [brackets]\n# not a nested heading', 'quote with _underscores_', 'first\n> not a quote', 'A\nB\na | pipe\n*star*', 'bold *star* and em _u_ and link ]text and code \\* stays']);
addEscape('escapes-hard-breaks', 'line one  \n\\# line two  \n\\- line three\\\n1\\. line four\n', ['line one\n# line two\n- line three\n1. line four']);
addEscape('escapes-in-code', '---\ntitle: \\$x\n---\n\n```\n\\* not an escape\n```\n', ['title: \\$x', '\\* not an escape']);
addEscape('literal-backslashes', 'C:\\Users\\Ruth and a\\b and trailing \\\n\nLaTeX-ish \\cite{x} and \\{braces\\}\n', ['C:\\Users\\Ruth and a\\b and trailing \\', 'LaTeX-ish \\cite{x} and {braces}']);
addEscape('all-punctuation', 'Escaped: \\! \\" \\# \\$ \\% \\& \\\' \\( \\) \\* \\+ \\, \\- \\. \\/ \\: \\; \\< \\= \\> \\? \\@ \\[ \\\\ \\] \\^ \\_ \\` \\{ \\| \\} \\~\n',
  ['Escaped: ! " # $ % & \' ( ) * + , - . / : ; < = > ? @ [ \\ ] ^ _ ` { | } ~']);
addEscape('typed-specials', 'Stars: 5 \\* 3 = 15 and a_b_c and \\*literal\\*\n\n\\# Not a heading\n\n\\> Not a quote\n\n\\- Not a list\n\n\\---\n\n1986\\. Not a list\n\nTags \\#1 and \\[sic\\] and \\~5 and \\$\\$x\\$\\$ and \\<b>b\\</b>\n\n## Topic \\#\n',
  ['Stars: 5 * 3 = 15 and a_b_c and *literal*', '# Not a heading', '> Not a quote', '- Not a list', '---', '1986. Not a list', 'Tags #1 and [sic] and ~5 and $$x$$ and <b>b</b>', 'Topic #']);
addEscape('wikilink-and-math-stay', 'See [[Other note]] and\n\n$$\nE = mc^2\n$$\n\nbut \\[\\[not a wikilink\\]\\] and \\$\\$ not math \\$\\$\n', ['See  and', '', 'but [[not a wikilink]] and $$ not math $$']);
// Markdown that PicoMarQ must write back exactly as it read it.
const verbatim = [];
const addVerbatim = (name, md) => verbatim.push({ name, md });
addVerbatim('numbered-headings', '# 1. Introduction\n\n## 2.1 Methods \\#\n\n### 3) Results\n\nText.');
addVerbatim('escaped-prose', 'Stars: 5 \\* 3 = 15, a_b_c, \\_not em\\_, \\[sic\\], C:\\\\Users, \\`tick\\`, \\~5, \\$\\$x\\$\\$, \\<b>b\\</b>, p < .05, #1, 50% off, a & b');
addVerbatim('escaped-line-starts', '\\# Not a heading\n\n\\> Not a quote\n\n\\- Not a list\n\n\\+ Not a list\n\n1986\\. Not a list\n\n\\---\n\n\\===\n\nfirst  \n\\# second  \n1\\. third');
addVerbatim('list-and-quote-prose', '- item with \\[sic\\]\n- \\# not a heading\n\n> quote with \\*star\\*\n\n1. first\n2. \\> not a quote\n\nText.');
addEscape('table-prose', '| 1. x | - y |\n| --- | --- |\n| a \\| b | \\*c\\* |\n', ['1. x\n- y\na | b\n*c*']);
addVerbatim('plain-prose', 'Ruth\'s "draft" -- with 1,200 words... and a (parenthetical) aside; 50% done!\n\nSecond paragraph: see page 12, section 3.4, or [the site](https://example.com/a_b).');
addEscape('underline-html', 'Plain <u>under</u>, **<u>bold under</u>**, *<u>em under</u>*, ~~<u>struck under</u>~~, [<u>linked under</u>](http://e.com) and the old ++plus form++.\n', ['Plain under, bold under, em under, struck under, linked under and the old plus form.']);
addVerbatim('underline-written-as-html', 'Keep <u>this</u> underlined, and **<u>this</u>** too.');
addEscape('dashes-in-prose', 'a---b and a --- b and ---\n\n\\---\n\nx\n\\---\n', ['a---b and a --- b and ---', '---', 'x\n---']);

(async () => {
  const electron = await _electron.launch({
    executablePath: require('electron'),
    args: process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', path.join(__dirname, 'electron-main.cjs')] : [path.join(__dirname, 'electron-main.cjs')],
    timeout: 30000,
  });
  const page = await electron.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForFunction(() => window.ready === true, undefined, { timeout: 30000 });
  let failures = 0;
  let states = 0;
  let stale = 0;
  for (const { name, md } of corpus) {
    const parse = await page.evaluate(md => window.api.compareParse(md), md);
    if (!parse.same) { failures++; console.log(`PARSE MISMATCH ${name}\n  original: ${parse.a}\n  fast:     ${parse.b}`); }
    const edits = md.length > 20000 ? 60 : 52;
    const result = await page.evaluate(([md, edits]) => window.api.compareEdits(md, edits), [md, edits]);
    states += result.steps;
    stale += result.staleOriginal.length;
    if (result.problems.length) { failures++; console.log(`EDIT MISMATCH ${name}: ${result.problems.slice(0, 3).join('\n')}`); }
  }
  const prefixProblems = await page.evaluate(() => {
    const lines = ['1. a', '2. b', '- [ ] t', '- [x] u', '  indented', '\tTabbed', '', '   ', 'plain', '# h', '> q', '10. ten', '  1. nested', '    - [ ] deep', 'end.'];
    let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const problems = [];
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rand() * 8);
      const src = Array.from({ length: n }, () => lines[Math.floor(rand() * lines.length)]).join('\n') + (rand() < 0.5 ? '\n' : '');
      for (const kind of ['ordered', 'task']) {
        const prefix = window.api.listPrefix(src, kind);
        if (prefix !== null && (!src.startsWith(prefix) || (prefix.length < src.length && src[prefix.length] !== '\n'))) problems.push(`bad prefix for ${JSON.stringify(src)} (${kind}): ${JSON.stringify(prefix)}`);
      }
    }
    return problems;
  });
  if (prefixProblems.length) { failures++; console.log('PREFIX PROBLEMS', prefixProblems.slice(0, 5)); }
  for (const { name, md } of verbatim) {
    const result = await page.evaluate(md => window.api.roundTrip(md), md);
    if (result.written !== md) { failures++; console.log(`NOT VERBATIM ${name}\n  input:   ${JSON.stringify(md)}\n  written: ${JSON.stringify(result.written)}`); }
  }
  // Round trips: PicoMarQ's output must read back as the same document, and
  // writing that document again must give the same output. Three documents
  // hit limits of TipTap's own serializer that have nothing to do with
  // escaping: it joins the paragraphs of a list item, writes a code span that
  // contains a backtick with a single-backtick fence, and drops an image's
  // width and height.
  const knownLossy = new Set(['ordered-continuation', 'task-continuation', 'strike-code', 'UPSTREAM-README.md']);
  let roundTrips = 0;
  for (const { name, md, text } of [...corpus, ...escapes, ...verbatim]) {
    const result = await page.evaluate(md => window.api.roundTrip(md), md);
    roundTrips++;
    if (knownLossy.has(name)) { if (result.lossless) console.log(`note: ${name} now round-trips; it can leave knownLossy`); continue; }
    if (!result.lossless) { failures++; console.log(`ROUND TRIP LOSSY ${name}\n  written: ${JSON.stringify(result.written.slice(0, 300))}\n  first:  ${result.first}\n  second: ${result.second}`); }
    else if (!result.stable) { failures++; console.log(`ROUND TRIP UNSTABLE ${name}\n  written:   ${JSON.stringify(result.written.slice(0, 300))}\n  rewritten: ${JSON.stringify(result.rewritten.slice(0, 300))}`); }
    if (text) {
      const shown = await page.evaluate(md => window.api.textOf(md), md);
      if (JSON.stringify(shown) !== JSON.stringify(text)) { failures++; console.log(`SHOWN TEXT ${name}\n  expected: ${JSON.stringify(text)}\n  shown:    ${JSON.stringify(shown)}`); }
    }
  }
  if (errors.length) { failures++; console.log('PAGE ERRORS', errors.slice(0, 5)); }
  console.log(`${corpus.length} documents, ${states} edited states compared; stock highlighter was stale in ${stale} states where the incremental one matched a fresh computation; ${roundTrips} documents round-tripped.`);
  console.log(failures ? `FAIL: ${failures} problem(s)` : 'PASS: parse, serialize, word count, selected-word count, and highlighting match the stock implementations; output reads back as the same document');
  electron.process().kill('SIGKILL');
  process.exit(failures ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
