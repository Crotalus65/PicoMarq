// Spelling of opened, pasted and source-edited text, in US English, in the
// real Electron app. Needs a graphical session or Xvfb, and a US English
// dictionary: PICOMARQ_TEST_BDIC=/path/en-US-10-1.bdic, or the system's
// Hunspell en_US files (/usr/share/hunspell/en_US.aff and .dic), which the test
// converts with scripts/hunspell-to-bdic.py. Without either it is skipped.
// It also fails if a later Electron drops the Chromium switch in main.cjs.
// Usage: node tests/spelling-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const work = path.join(__dirname, 'tmp', 'spelling-smoke');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let virtualDisplay;
let electron;
const errors = [];

const DOCUMENT = `# Spelling Check

I will recieve the package tomorrow, and the color of the box does not matter.

We keep the drafts seperate so we can organize the chapters by theme.

The meeting was definately in the center of town, next to the old theater.

Something strange occured after we traveled home. The colour was wrong, and we had to organise everything again.
`;
const ONE_PARAGRAPH = 'It was hard to accomodate everyone at the table, but the dinner went well and the conversation lasted for hours. Later that evening the weather turned wierd, so we stayed inside and played cards by the fire. Nobody wanted to leave untill the rain stopped.';
const THREE_PARAGRAPHS = 'From the begining, the plan was simple.\n\nI beleive the second draft is stronger.\n\nPlease check the calandar before Friday.';
const LONG_TYPOS = ['tommorow', 'neccessary', 'goverment', 'enviroment', 'existance', 'independant', 'occassion', 'persue', 'reccomend', 'truely'];
const LONG_PASTE = LONG_TYPOS.map((word, i) => `Paragraph ${i + 1} of the long paste explains the background of the study, and it contains the word ${word} along with many ordinary words that are spelled correctly.`).join('\n\n');
// "colour" and "organise" are British: US English marks them.
const MISSPELLED = {
  opened: ['recieve', 'seperate', 'definately', 'occured', 'colour', 'organise'],
  oneParagraph: ['accomodate', 'wierd', 'untill'],
  threeParagraphs: ['begining', 'beleive', 'calandar'],
  typed: ['thier'],
  sourceView: ['embarass'],
  longPaste: LONG_TYPOS,
};

function dictionary() {
  if (process.env.PICOMARQ_TEST_BDIC) return process.env.PICOMARQ_TEST_BDIC;
  if (!fsSync.existsSync('/usr/share/hunspell/en_US.dic')) return null;
  const out = path.join(work, 'en-US-10-1.bdic');
  execFileSync('python3', ['-I', path.join(root, 'scripts/hunspell-to-bdic.py'), '/usr/share/hunspell/en_US', out], { stdio: 'ignore' });
  return out;
}

// Red spelling underlines under each listed word, and red pixels anywhere
// else in the editor (underlines under correctly spelled words).
async function underlines(page, words) {
  const { found, editor } = await page.evaluate(words => {
    const root = document.querySelector('[data-document-id][aria-hidden="false"] .tiptap');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = {};
    for (let node; (node = walker.nextNode());) {
      for (const word of words) {
        const index = node.data.indexOf(word);
        if (index < 0 || found[word]) continue;
        const range = document.createRange();
        range.setStart(node, index); range.setEnd(node, index + word.length);
        const r = range.getBoundingClientRect();
        found[word] = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    const e = root.getBoundingClientRect();
    return { found, editor: { x: e.x, y: e.y, w: e.width, h: e.height } };
  }, words);
  const win = await electron.browserWindow(page);
  return win.evaluate(async (window, { found, editor }) => {
    const image = await window.webContents.capturePage();
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap(); // BGRA
    const isRed = i => bitmap[i + 2] > 170 && bitmap[i + 1] < 100 && bitmap[i] < 100;
    const inside = new Uint8Array(width * height);
    const marked = {};
    for (const [word, r] of Object.entries(found)) {
      let count = 0;
      for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(height, Math.ceil(r.y + r.h + 4)); y++)
        for (let x = Math.max(0, Math.floor(r.x) - 1); x < Math.min(width, Math.ceil(r.x + r.w) + 1); x++) {
          inside[y * width + x] = 1;
          if (isRed((y * width + x) * 4)) count++;
        }
      marked[word] = count > 4;
    }
    let stray = 0;
    for (let y = Math.max(0, Math.floor(editor.y)); y < Math.min(height, Math.ceil(editor.y + editor.h)); y++)
      for (let x = Math.max(0, Math.floor(editor.x)); x < Math.min(width, Math.ceil(editor.x + editor.w)); x++)
        if (!inside[y * width + x] && isRed((y * width + x) * 4)) stray++;
    return { marked, stray };
  }, { found, editor });
}

async function expectUnderlined(page, groups, step, timeout = 8000) {
  const words = groups.flatMap(group => MISSPELLED[group]);
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await underlines(page, words);
    if (words.every(word => last.marked[word])) break;
    await pause(200);
  }
  const missing = words.filter(word => !last.marked[word]);
  assert.deepEqual(missing, [], `${step}: not underlined: ${missing.join(', ')}`);
  assert.equal(last.stray, 0, `${step}: underline under a correctly spelled word`);
  console.log(`PASS: ${step} (${words.length} misspellings underlined after ${Date.now() - start} ms, no correct word underlined)`);
}

async function pasteAtEnd(page, text) {
  await electron.evaluate(({ clipboard }, text) => clipboard.writeText(text), text);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+V');
}

async function main() {
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(path.join(work, 'data', 'Dictionaries'), { recursive: true });
  const bdic = dictionary();
  if (!bdic) { console.log('SKIP: no US English dictionary (set PICOMARQ_TEST_BDIC or install hunspell-en-us)'); return; }
  // Electron reads an existing dictionary file instead of downloading one.
  await fs.copyFile(bdic, path.join(work, 'data', 'Dictionaries', 'en-US-10-1.bdic'));
  const file = path.join(work, 'Spelling Check.md');
  await fs.writeFile(file, DOCUMENT);
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const binary = process.env.SCRATCH_XVFB || 'Xvfb';
    const display = process.env.SCRATCH_DISPLAY_NUMBER || '124';
    virtualDisplay = spawn(binary, [':' + display, '-screen', '0', '1440x1800x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { env: process.env, stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + display;
    await pause(500);
  }
  electron = await _electron.launch({ executablePath: require('electron'), args: process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', root] : [root], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: path.join(work, 'data') }, timeout: 20000 });
  const first = await electron.firstWindow();
  await first.waitForSelector('[data-document-id][aria-hidden="false"] .tiptap', { timeout: 15000 });
  assert.deepEqual(await electron.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages()), ['en-US']);
  console.log('PASS: spelling language is US English');

  // Open the file the way Windows does when a .md file is double-clicked.
  const opened = electron.waitForEvent('window', { timeout: 15000 });
  await electron.evaluate(({ app }, { file, dir }) => app.emit('second-instance', {}, [process.execPath, file], dir), { file, dir: path.dirname(file) });
  const page = await opened;
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForSelector('[data-document-id][aria-hidden="false"] .tiptap p', { timeout: 15000 });
  const win = await electron.browserWindow(page);
  await win.evaluate(window => { window.setBounds({ x: 0, y: 0, width: 1300, height: 1700 }); window.focus(); });
  await pause(500);
  await expectUnderlined(page, ['opened'], 'opened file, before any typing or clicking');

  await pasteAtEnd(page, ONE_PARAGRAPH);
  await expectUnderlined(page, ['opened', 'oneParagraph'], 'one-paragraph paste');
  await pasteAtEnd(page, THREE_PARAGRAPHS);
  await expectUnderlined(page, ['opened', 'oneParagraph', 'threeParagraphs'], 'three-paragraph paste');

  await page.keyboard.press('Control+End');
  await page.keyboard.type(' thier ');
  await expectUnderlined(page, ['opened', 'oneParagraph', 'threeParagraphs', 'typed'], 'typed word');

  // Edit in Markdown source view, then return to the formatted view.
  const source = async () => win.evaluate(window => window.webContents.send('scratch:command', { action: 'source' }));
  await source();
  const textarea = page.locator('[data-document-id][aria-hidden="false"] textarea');
  await textarea.waitFor();
  await textarea.evaluate(t => { t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
  await page.keyboard.type(' embarass');
  await source();
  await page.waitForSelector('[data-document-id][aria-hidden="false"] .tiptap', { state: 'visible' });
  await expectUnderlined(page, ['opened', 'oneParagraph', 'threeParagraphs', 'typed', 'sourceView'], 'text edited in Markdown source view');

  await pasteAtEnd(page, LONG_PASTE);
  await expectUnderlined(page, Object.keys(MISSPELLED), 'ten-paragraph paste');
  assert.equal(errors.length, 0, errors.join('\n'));
}

const watchdog = setTimeout(() => { console.error('Spelling checks timed out'); process.exit(1); }, 180000);
main().then(() => console.log('SPELLING CHECKS DONE')).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (electron) { try { await electron.evaluate(({ app }) => app.exit()); } catch {} }
  virtualDisplay?.kill();
  clearTimeout(watchdog);
});
