// Shared by tests/ignore-smoke.cjs and tests/dictionary-smoke.cjs: starts the
// real Electron app with a US English dictionary and reads the red spelling
// underlines off the screen. Needs a graphical session or Xvfb, and a
// dictionary: PICOMARQ_TEST_BDIC=/path/en-US-10-1.bdic, or the system's
// Hunspell en_US files, which are converted with scripts/hunspell-to-bdic.py.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const active = '[data-document-id][aria-hidden="false"]';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function dictionary(work) {
  if (process.env.PICOMARQ_TEST_BDIC) return process.env.PICOMARQ_TEST_BDIC;
  if (!fsSync.existsSync('/usr/share/hunspell/en_US.dic')) return null;
  const out = path.join(work, 'en-US-10-1.bdic');
  execFileSync('python3', ['-I', path.join(root, 'scripts/hunspell-to-bdic.py'), '/usr/share/hunspell/en_US', out], { stdio: 'ignore' });
  return out;
}

/**
 * Start the app. Returns null when there is no dictionary to test with.
 * `app.page` and `app.win` are the document window that was opened last (or
 * chosen with app.use); every helper works on that window.
 */
async function startSpellingApp({ name, display }) {
  const work = path.join(__dirname, 'tmp', name);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(path.join(work, 'data', 'Dictionaries'), { recursive: true });
  const bdic = dictionary(work);
  if (!bdic) return null;
  // Electron reads an existing dictionary file instead of downloading one.
  await fs.copyFile(bdic, path.join(work, 'data', 'Dictionaries', 'en-US-10-1.bdic'));
  let virtualDisplay;
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    const binary = process.env.SCRATCH_XVFB || 'Xvfb';
    virtualDisplay = spawn(binary, [':' + display, '-screen', '0', '1440x1800x24', '-listen', 'tcp', '-nolisten', 'unix', '-nolisten', 'local', '-ac'], { env: process.env, stdio: 'ignore' });
    process.env.DISPLAY = '127.0.0.1:' + display;
    await pause(500);
  }
  const electron = await _electron.launch({ executablePath: require('electron'), args: process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', root] : [root], env: { ...process.env, SCRATCH_TEST_MODE: '1', SCRATCH_TEST_DATA: path.join(work, 'data') }, timeout: 20000 });
  const first = await electron.firstWindow();
  await first.waitForSelector(`${active} .tiptap`, { timeout: 15000 });
  await electron.evaluate(({ Menu, dialog }) => {
    global.spellingMenus = [];
    global.spellingDialogs = [];
    global.spellingAnswers = [];
    // Keep the real native menus and their handlers; only do not show them.
    Menu.prototype.popup = function () { global.spellingMenus.push(this); };
    // Message boxes are answered from spellingAnswers (Cancel when it is empty).
    dialog.showMessageBox = async (_window, options) => { global.spellingDialogs.push({ ...options, icon: undefined }); return { response: global.spellingAnswers.length ? global.spellingAnswers.shift() : (options.cancelId ?? 1) }; };
  });

  const app = { electron, work, errors: [], page: null, win: null };

  app.stop = async () => {
    try { await electron.evaluate(({ app }) => app.exit()); } catch {}
    virtualDisplay?.kill();
  };

  // Write a Markdown file into the work folder.
  app.write = async (fileName, content) => {
    const file = path.join(work, fileName);
    await fs.writeFile(file, content);
    return file;
  };

  // Make a document window the one the helpers work on.
  app.use = async page => {
    app.page = page;
    app.win = await electron.browserWindow(page);
    await app.win.evaluate(window => window.focus());
    // Finds whole words in the formatted view, block by block: the wrapper of
    // an ignored word splits it into two text nodes, so words are looked for
    // in each block's whole text.
    await page.evaluate(active => {
      window.findWords = words => {
        const root = document.querySelector(`${active} .tiptap`);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const blocks = new Map();
        for (let node; (node = walker.nextNode());) {
          const block = node.parentElement.closest('p, h1, h2, h3, h4, h5, h6, pre, li, td, th') || root;
          if (!blocks.has(block)) blocks.set(block, { text: '', parts: [] });
          const entry = blocks.get(block);
          entry.parts.push({ node, start: entry.text.length });
          entry.text += node.data;
        }
        const out = [];
        for (const { text, parts } of blocks.values()) {
          const at = offset => { for (let i = parts.length - 1; i >= 0; i--) if (parts[i].start <= offset) return { node: parts[i].node, offset: offset - parts[i].start }; };
          const re = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
          for (let m = re.exec(text); m; m = re.exec(text)) {
            if (!words.includes(m[0])) continue;
            const from = at(m.index), to = at(m.index + m[0].length - 1);
            const range = document.createRange();
            range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset + 1);
            out.push({ word: m[0], range, wrapped: !!from.node.parentElement.closest('[data-ignored-spelling]') });
          }
        }
        return out;
      };
    }, active);
  };

  // Open a file the way Windows does when a .md file is double-clicked.
  app.open = async file => {
    const opened = electron.waitForEvent('window', { timeout: 15000 });
    await electron.evaluate(({ app }, { file, dir }) => app.emit('second-instance', {}, [process.execPath, file], dir), { file, dir: path.dirname(file) });
    const page = await opened;
    page.on('pageerror', error => app.errors.push(String(error)));
    await page.waitForSelector(`${active} .tiptap p`, { timeout: 15000 });
    const win = await electron.browserWindow(page);
    await win.evaluate(window => window.setBounds({ x: 0, y: 0, width: 1300, height: 1700 }));
    await app.use(page);
    await pause(500);
    return page;
  };

  // Every whole-word occurrence of the listed words, in document order: 'red'
  // (spelling underline), 'ignored' (no underline, first letter in an
  // ignored-word wrapper) or 'plain' (no underline).
  app.marks = async words => {
    const rects = await app.page.evaluate(words => window.findWords(words).map(({ word, range, wrapped }) => {
      const r = range.getBoundingClientRect();
      return { word, x: r.x, y: r.y, w: r.width, h: r.height, wrapped, onScreen: r.top >= 0 && r.bottom + 4 <= innerHeight };
    }), words);
    return app.win.evaluate(async (window, rects) => {
      const image = await window.webContents.capturePage();
      const { width, height } = image.getSize();
      const bitmap = image.toBitmap(); // BGRA
      const isRed = i => bitmap[i + 2] > 170 && bitmap[i + 1] < 100 && bitmap[i] < 100;
      return rects.map(r => {
        if (!r.onScreen) return { word: r.word, state: 'off-screen' };
        let count = 0;
        for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(height, Math.ceil(r.y + r.h + 4)); y++)
          for (let x = Math.max(0, Math.floor(r.x) - 1); x < Math.min(width, Math.ceil(r.x + r.w) + 1); x++)
            if (isRed((y * width + x) * 4)) count++;
        return { word: r.word, state: count > 4 ? 'red' : r.wrapped ? 'ignored' : 'plain' };
      });
    }, rects);
  };
  app.byWord = list => { const out = {}; for (const mark of list) (out[mark.word] ||= []).push(mark.state); return out; };
  app.describe = list => Object.entries(app.byWord(list)).map(([word, states]) => `${word}: ${states.join(' ')}`).join(' | ');

  // Where the selection is, for failure messages: Chromium's background
  // checks stop while its focus is inside a wrapper.
  app.selectionState = () => app.page.evaluate(active => {
    const selection = document.getSelection();
    const show = (node, offset) => node ? `${node.nodeType === 3 ? JSON.stringify(node.data.slice(0, 16)) : `<${node.nodeName.toLowerCase()}>`}@${offset}${(node.nodeType === 1 ? node : node.parentElement)?.closest('[data-ignored-spelling]') ? ' (in wrapper)' : ''}` : 'none';
    const editor = document.querySelector(`${active} .tiptap`).editor;
    return { anchor: show(selection.anchorNode, selection.anchorOffset), focus: show(selection.focusNode, selection.focusOffset), editor: `${editor.state.selection.anchor}-${editor.state.selection.head}`, focused: document.hasFocus() };
  }, active);

  // Wait until the words are in the expected states, e.g.
  // { Qarth: 'ignored', peeple: 'red' } (every occurrence in that state) or
  // { Qarth: ['ignored', 'red'] }. Returns the time it took.
  app.expectMarks = async (expected, step, timeout = 6000) => {
    const words = Object.keys(expected);
    const start = Date.now();
    for (;;) {
      const last = await app.marks(words);
      const found = app.byWord(last);
      if (words.every(word => {
        const states = found[word] || [];
        const want = expected[word];
        return states.length > 0 && (Array.isArray(want) ? states.length === want.length && states.every((state, i) => state === want[i]) : states.every(state => state === want));
      })) return Date.now() - start;
      if (Date.now() - start > timeout) assert.fail(`${step}: expected ${JSON.stringify(expected)}, found ${app.describe(last)}; selection ${JSON.stringify(await app.selectionState())}`);
      await pause(150);
    }
  };

  // Sample the words' states while something happens and for a while after.
  app.watch = async (words, during, { duration = 2500 } = {}) => {
    const samples = [];
    let running = true;
    const sampler = (async () => { while (running) { samples.push(app.byWord(await app.marks(words))); await pause(60); } })();
    await during();
    await pause(duration);
    running = false;
    await sampler;
    return samples;
  };

  app.pointOf = async (word, nth = 0) => {
    const point = await app.page.evaluate(({ word, nth }) => {
      const found = window.findWords([word])[nth];
      if (!found) return null;
      const r = found.range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { word, nth });
    assert(point, `"${word}" (occurrence ${nth + 1}) is not in the document`);
    return point;
  };

  // Right-click a word; the native menu is captured instead of shown.
  // Returns its labels ('-' for a separator).
  app.rightClick = async (word, nth = 0) => {
    const point = await app.pointOf(word, nth);
    await electron.evaluate(() => { global.spellingMenus.length = 0; });
    await app.page.mouse.click(point.x, point.y, { button: 'right' });
    const start = Date.now();
    while (!await electron.evaluate(() => global.spellingMenus.length)) {
      if (Date.now() - start > 5000) assert.fail(`no right-click menu for "${word}"`);
      await pause(50);
    }
    return electron.evaluate(() => global.spellingMenus[0].items.map(item => item.type === 'separator' ? '-' : item.label));
  };
  app.choose = label => electron.evaluate((_electron, label) => { global.spellingMenus[0].items.find(item => item.label === label).click(); }, label);

  // Send a menu command to the current window.
  app.command = (action, extra = {}) => app.win.evaluate((window, command) => window.webContents.send('scratch:command', command), { action, ...extra });
  app.markdown = () => app.page.evaluate(active => document.querySelector(`${active} .tiptap`).editor.getMarkdown(), active);
  app.dictionaryWords = () => electron.evaluate(({ session }) => session.defaultSession.listWordsInSpellCheckerDictionary());
  // Answer the next message box (0 is its first button) and read what was shown.
  app.answer = response => electron.evaluate((_electron, response) => { global.spellingAnswers.push(response); }, response);
  app.dialogs = () => electron.evaluate(() => global.spellingDialogs.splice(0));

  return app;
}

module.exports = { startSpellingApp, active, pause, root };
