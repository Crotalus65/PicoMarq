const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, shell, nativeImage, nativeTheme, screen, session } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createStore, readDocument, writeDocument, restoreBounds } = require('./store.cjs');
const { installedFonts } = require('./fonts.cjs');
const { refusesRequest } = require('./shared-folders.cjs');
// The last requests that were refused; read by tests/pictures-smoke.cjs.
const refusedRequests = [];
globalThis.picomarqRefusedRequests = refusedRequests;
const { captureTheme, parseTheme, fallbackFont, defaultAppearance } = require('./theme-presets.cjs');
const { recentFiles } = require('./recent.cjs');
const { profileDirectory } = require('./profile.cjs');
const { contextMenuTemplate, sanitizeExtras } = require('./context-menu.cjs');
const { shouldRestoreSession } = require('./startup.cjs');
const { aboutDialog, aboutLink } = require('./about.cjs');
const { dictionaryWords, clearDictionaryDialog } = require('./dictionary.cjs');

app.setName('PicoMarQ');
app.setAppUserModelId('io.picomarq.markdown');
// Spell-check opened files and pasted text, not only what is typed. Recent
// Chromium versions skip spelling in a text box that a script focused and in
// text the user did not type, so that websites cannot probe the words in
// the user's dictionary (explainers-by-googlers.github.io/user-dictionary-leaks).
// PicoMarQ focuses its editor itself when a document opens and inserts pastes
// itself, so neither was checked. PicoMarQ shows no websites, so the rule
// protects nothing here. This Chromium switch lifts it (Electron 44.6.0,
// Chromium 152; tests/spelling-smoke.cjs fails if a later Electron drops it).
app.commandLine.appendSwitch('enable-features', 'UnrestrictSpellingAndGrammarForTesting');
const userData = process.env.SCRATCH_TEST_DATA || profileDirectory(app.getPath('appData'));
fsSync.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setPath('sessionData', userData);
const store = createStore(userData);
const windows = new Map(); // webContents id -> one independently owned document
const savingPaths = new Map();
let initialized = false;
let pendingLaunches = [];
let openQueue = Promise.resolve();
let closeQueue = Promise.resolve();
let startupReady = Promise.resolve();
let quitting = null;
let quitCommitted = false;

function pathKey(file) {
  let resolved = path.resolve(file);
  try { resolved = fsSync.realpathSync.native(resolved); } catch { /* A Save As target may not exist yet. */ }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function recordFor(window) { return window && windows.get(window.webContents?.id); }
function focusedRecord() { return recordFor(BrowserWindow.getFocusedWindow()) || [...windows.values()].find(record => record.id === store.get().activeDocumentId) || windows.values().next().value; }
function command(record, action, extra = {}) {
  if (!record || record.window.isDestroyed()) return;
  const value = { action, ...extra };
  if (record.ready) record.window.webContents.send('scratch:command', value);
  else record.commands.push(value);
}
function grant(record, file) {
  if (file) { file = path.resolve(file); record.allowed.add(pathKey(file)); }
  return file;
}
function approvedPath(record, file) {
  if (typeof file !== 'string' || !record.allowed.has(pathKey(file))) throw new Error('Choose this file with Open or Save As first.');
  return path.resolve(file);
}
function currentDocument(record) { return store.get().documents.find(doc => doc.id === record.id); }
function geometry(record) { return { ...record.window.getNormalBounds(), maximized: record.window.isMaximized() }; }
function validateSnapshot(record, args) {
  const doc = args.documents?.[0];
  if (args.documents?.length !== 1 || !doc || doc.id !== record.id || typeof doc.content !== 'string' || typeof doc.diskContent !== 'string') throw new Error('Invalid document session.');
  if (doc.path) approvedPath(record, doc.path);
  if ((doc.path ? pathKey(doc.path) : null) !== (record.path ? pathKey(record.path) : null)) throw new Error('A document path can only change through Save As.');
  return { ...doc, path: record.path, view: { ...doc.view, settingsOpen: args.settingsOpen === true }, window: geometry(record) };
}
function assertOpeningAllowed() { if (quitting) throw new Error('Finish closing the application before opening another document.'); }
function enqueueOpen(task) {
  const result = openQueue.catch(() => {}).then(task);
  openQueue = result.catch(() => {});
  return result;
}

function menuFor(record) {
  // Native accelerators target their invoking window; popups retain their owner.
  const action = name => (_item, window) => command(recordFor(window) || record, name);
  const recents = store.get().recentFiles;
  return Menu.buildFromTemplate([
    { id: 'file', label: '&File', submenu: [
      { label: '&New', accelerator: 'CmdOrCtrl+N', click: action('new') },
      { label: '&Open…', accelerator: 'CmdOrCtrl+O', click: action('open') },
      { id: 'open-recent', label: 'Open &Recent', submenu: recents.length
        ? [...recents.map((file, index) => ({ label: `&${index + 1} ${file.replaceAll('&', '&&')}`, click: (_item, window) => {
          const target = recordFor(window) || record;
          command(target, 'open-path', { path: grant(target, file) });
        } })), { type: 'separator' }, { id: 'clear-recent', label: '&Clear', click: () => { void store.update({ recentFiles: [] }).then(buildMenu).catch(error => dialog.showErrorBox('Could not clear recent files', error.message)); } }]
        : [{ label: 'No recent files', enabled: false }] },
      { type: 'separator' },
      { label: '&Save', accelerator: 'CmdOrCtrl+S', click: action('save') },
      { label: 'Save &As…', accelerator: 'F12', click: action('save-as') },
      { id: 'revert', label: 'Revert to Saved…', enabled: !!record?.path, click: action('revert') },
      { id: 'close-window', label: '&Close Window', accelerator: 'CmdOrCtrl+W', click: (_item, window) => enqueueClose(recordFor(window) || record, { replaceLast: true }) },
      { type: 'separator' },
      { label: '&Print…', accelerator: 'CmdOrCtrl+P', click: action('print') },
      { type: 'separator' },
      { label: 'E&xit', accelerator: 'CmdOrCtrl+Shift+Q', click: () => { void requestQuit(); } },
    ] },
    { id: 'edit', label: '&Edit', submenu: [
      { label: '&Undo', accelerator: 'CmdOrCtrl+Z', click: action('undo') },
      { label: '&Redo', accelerator: 'CmdOrCtrl+Y', click: action('redo') },
      { type: 'separator' },
      { role: 'cut', label: 'Cu&t' }, { role: 'copy', label: '&Copy' }, { role: 'paste', label: '&Paste' }, { role: 'selectAll', label: 'Select &All' },
      { type: 'separator' },
      { label: '&Find…', accelerator: 'CmdOrCtrl+F', click: action('find') },
      { label: '&Replace…', accelerator: 'CmdOrCtrl+H', click: action('replace') },
      { type: 'separator' },
      { label: 'Apply Smart T&ypography', click: action('smart-typography') },
      { type: 'separator' },
      { label: '&Settings…', accelerator: 'CmdOrCtrl+,', click: action('settings') },
    ] },
    { id: 'view', label: '&View', submenu: [
      { label: 'Markdown &Source', accelerator: 'CmdOrCtrl+Shift+M', click: action('source') },
      { type: 'separator' },
      { label: 'Zoom &In', accelerator: 'CmdOrCtrl+Plus', click: action('zoom-in') },
      { label: 'Zoom &Out', accelerator: 'CmdOrCtrl+-', click: action('zoom-out') },
      { label: '&Actual Size', accelerator: 'CmdOrCtrl+0', click: action('zoom-reset') },
    ] },
    { id: 'help', label: '&Help', submenu: [
      { id: 'about', label: '&About PicoMarQ', click: (_item, window) => { void showAbout(recordFor(window) || record); } },
    ] },
  ]);
}
// Help > About PicoMarQ: the version, the acknowledgment, and the two pages.
async function showAbout(record) {
  try {
    const options = aboutDialog(app.getVersion());
    const icon = nativeImage.createFromPath(path.join(__dirname, '../app.ico'));
    if (!icon.isEmpty()) options.icon = icon;
    const owner = record && !record.window.isDestroyed() ? record.window : null;
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    const page = aboutLink(result.response);
    if (page) await shell.openExternal(page);
  } catch (error) {
    dialog.showErrorBox('About PicoMarQ', error.message);
  }
}
function buildMenu() {
  Menu.setApplicationMenu(menuFor(focusedRecord()));
  for (const { window } of windows.values()) {
    if (window.isDestroyed()) continue;
    window.setAutoHideMenuBar(false);
    window.setMenuBarVisibility(false);
  }
}

function finishCloseReply(record, token, result) {
  if (!record.closeWait || record.closeToken !== token) return;
  const finish = record.closeWait;
  record.closeWait = null;
  clearTimeout(record.closingTimer);
  finish(result);
}
function prepareClose(record, token) {
  return new Promise(resolve => {
    record.closeWait = resolve;
    record.closingTimer = setTimeout(() => {
      finishCloseReply(record, token, null);
      dialog.showErrorBox('The window is staying open', 'The editor has not finished preparing its recovery data. Save the document and try closing again.');
    }, 12000);
    command(record, 'prepare-close', { token });
  });
}
function cancelClose(records, token) {
  for (const record of records) {
    clearTimeout(record.closingTimer);
    record.closeWait = null;
    record.closeToken = null;
    record.commands = record.commands.filter(value => value.token !== token);
    command(record, 'cancel-close', { token });
  }
}
function enqueueClose(record, { replaceLast = false } = {}) {
  if (!record || record.closeQueued || record.closeApproved || quitting) return;
  record.closeQueued = true;
  // Finish each close before deciding whether the next close exits the app
  // or replaces the final document, including when several arrive together.
  closeQueue = closeQueue.catch(console.error).then(() => requestClose(record, { replaceLast }))
    .catch(console.error).finally(() => { record.closeQueued = false; });
}
async function requestClose(record, { replaceLast = false } = {}) {
  await startupReady;
  await openQueue;
  if (record.window.isDestroyed() || record.closeToken || quitting) return;
  // The title-bar close exits and preserves the final session. The explicit
  // Close Window command instead replaces the final document with a blank.
  if (windows.size === 1 && !replaceLast) return requestQuit();
  const token = crypto.randomUUID();
  record.closeToken = token;
  command(record, 'start-close', { token });
  let result;
  try {
    result = await prepareClose(record, token);
    if (!result) { cancelClose([record], token); return; }
    // Show the replacement before closing the original so there is always a
    // live window. A failed replacement leaves the original document open.
    if (replaceLast) await enqueueOpen(async () => {
      if (windows.size === 1) await newDocumentWindow({ replacing: record });
    });
    // An explicitly closed document is removed from the next startup.
    await store.removeDocuments([record.id]);
    await store.update({ window: geometry(record) });
    await store.flush();
    const closed = new Promise(resolve => record.window.once('closed', resolve));
    record.closeApproved = true;
    record.window.close();
    await closed;
  } catch (error) {
    if (result) await store.updateDocument(result.document, { create: true }).catch(console.error);
    cancelClose([record], token);
    dialog.showErrorBox('Could not close the window', error.message);
  }
}
async function requestQuit() {
  // An immediate close must wait for all restored and requested windows to
  // exist before collecting the session, even if the renderer is still loading.
  await startupReady;
  if (quitting || quitCommitted) return;
  const busy = [...windows.values()].find(record => record.closeToken);
  if (busy) { busy.window.focus(); return; }
  const token = crypto.randomUUID();
  quitting = token;
  await openQueue;
  const records = [...windows.values()];
  for (const record of records) { record.closeToken = token; command(record, 'start-close', { token }); }
  const snapshots = [];
  try {
    for (const record of records) {
      const result = await prepareClose(record, token);
      if (!result) { cancelClose(records, token); quitting = null; return; }
      snapshots.push(result);
    }
    // Discard is deferred until every window agrees to quit. A later Cancel
    // preserves all drafts and windows. Explicit Saves stay saved.
    const documents = snapshots.flatMap(({ document: doc, disposition }) => {
      if (disposition === 'discard') return doc.path ? [{ ...doc, content: doc.diskContent }] : [];
      return doc.path || doc.content ? [doc] : [];
    });
    const activeDocumentId = store.get().activeDocumentId;
    await store.update({ documents, activeDocumentId, settingsOpen: false, ...(records.length ? { window: geometry(focusedRecord() || records[0]) } : {}) });
    await store.flush();
    quitCommitted = true;
    for (const record of records) { record.closeApproved = true; clearTimeout(record.closingTimer); record.window.close(); }
    if (!records.length) app.quit();
  } catch (error) {
    // Keep the pre-Discard snapshots in memory if persisting the final session fails.
    for (const result of snapshots) await store.updateDocument(result.document, { create: true }).catch(console.error);
    cancelClose(records, token);
    quitting = null;
    dialog.showErrorBox('Could not exit', error.message);
  }
}

async function handleInvoke(event, action, args = {}) {
  const record = windows.get(event.sender.id);
  if (!record || event.sender !== record.window.webContents) throw new Error('Invalid window.');
  const window = record.window;
  switch (action) {
    case 'get_settings': return store.get().settings;
    case 'update_settings': {
      const next = { ...store.get().settings, ...args.patch };
      await store.update({ settings: next });
      const settings = store.get().settings;
      for (const target of windows.values()) if (!target.window.isDestroyed()) target.window.webContents.send('scratch:settings', settings);
      return settings;
    }
    case 'save_theme': {
      // Default to a Themes folder beside the portable executable, not in the
      // profile where session recovery and user documents are kept.
      const applicationDir = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
      const themesDir = path.join(applicationDir, 'Themes');
      let defaultDir = themesDir;
      try { await fs.mkdir(themesDir, { recursive: true }); }
      catch { defaultDir = app.getPath('documents'); } // Protected installation directory.
      const snapshot = captureTheme(store.get().settings);
      const result = await dialog.showSaveDialog(window, {
        title: 'Save Theme',
        defaultPath: path.join(defaultDir, 'My Theme.json'),
        filters: [{ name: 'PicoMarQ theme (JSON)', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const target = /\.json$/i.test(result.filePath) ? result.filePath : `${result.filePath}.json`;
      // Write safely; a failed write must not corrupt a previously saved theme.
      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
        await fs.rename(temporary, target);
      } finally { await fs.rm(temporary, { force: true }); }
      return { path: target };
    }
    case 'load_theme': {
      const applicationDir = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
      const themesDir = path.join(applicationDir, 'Themes');
      let defaultDir = themesDir;
      try { await fs.mkdir(themesDir, { recursive: true }); }
      catch { defaultDir = app.getPath('documents'); }
      const result = await dialog.showOpenDialog(window, {
        title: 'Load Theme', defaultPath: defaultDir,
        properties: ['openFile'],
        filters: [{ name: 'PicoMarQ theme (JSON)', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths?.length) return null;
      const target = result.filePaths[0];
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > 128 * 1024) throw new Error('The theme file is too large or is not a regular file.');
      const parsed = parseTheme(await fs.readFile(target, 'utf8'));
      let families = [];
      if (parsed.editorFont.baseFontFamily === 'system-font') {
        try { families = await installedFonts(); } catch (error) { console.warn('Could not check installed fonts:', error.message); }
      }
      const appearance = fallbackFont(parsed, families);
      const next = { ...store.get().settings, ...appearance };
      // One atomic settings update: retain startup behavior and other
      // non-appearance preferences; broadcast to all open editor windows.
      await store.update({ settings: next });
      for (const targetWindow of windows.values()) {
        if (!targetWindow.window.isDestroyed()) targetWindow.window.webContents.send('scratch:settings', next);
      }
      return { path: target, fontFallback: appearance.editorFont.baseFontFamily !== parsed.editorFont.baseFontFamily };
    }
    case 'restore_default_theme': {
      const result = await dialog.showMessageBox(window, {
        type: 'question', title: 'Restore Default Theme',
        message: 'Restore the default theme?',
        detail: 'Colors for Light and Dark, typography, and User Interface settings return to PicoMarQ’s defaults. Light or Dark stays as it is. Documents, Startup, Smart Typography, and saved theme files are not changed. To keep the current look, choose Cancel and use Save Theme first.',
        buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      });
      if (result.response !== 0) return null;
      const current = store.get().settings;
      const mode = args.mode === 'dark' || args.mode === 'light' ? args.mode : current.theme?.mode;
      // Same single update and broadcast as Load Theme.
      const next = { ...current, ...defaultAppearance(mode) };
      await store.update({ settings: next });
      for (const targetWindow of windows.values()) {
        if (!targetWindow.window.isDestroyed()) targetWindow.window.webContents.send('scratch:settings', next);
      }
      return { restored: true };
    }
    case 'clear_custom_dictionary': {
      // The words added with Add to Dictionary, in this profile.
      const spelling = window.webContents.session;
      const words = dictionaryWords(await spelling.listWordsInSpellCheckerDictionary());
      if (!words.length) return { removed: 0, empty: true };
      const result = await dialog.showMessageBox(window, clearDictionaryDialog(words));
      if (result.response !== 0) return null;
      let removed = 0;
      for (const word of words) if (spelling.removeWordFromSpellCheckerDictionary(word)) removed += 1;
      // Chromium does not mark the removed words again by itself: have every
      // open document checked again.
      for (const target of windows.values()) command(target, 'recheck-spelling');
      return { removed, kept: words.length - removed };
    }
    case 'get_session': {
      const doc = currentDocument(record);
      return { documents: [doc], activeDocumentId: doc.id, settingsOpen: doc.view?.settingsOpen === true };
    }
    case 'renderer_ready':
      record.ready = true;
      for (const value of record.commands.splice(0)) window.webContents.send('scratch:command', value);
      return;
    case 'save_session': {
      if (record.closeApproved) return;
      await store.updateDocument(validateSnapshot(record, args));
      return;
    }
    case 'new_window': return enqueueOpen(() => newDocumentWindow());
    case 'open_document_windows': {
      if (!Array.isArray(args.paths) || args.paths.some(file => typeof file !== 'string')) throw new Error('Invalid file list.');
      const files = args.paths.map(file => approvedPath(record, file));
      return enqueueOpen(async () => {
        for (const file of files) {
          try { await openDocumentWindow(file); }
          catch (error) { dialog.showErrorBox('Could not open the file', error.message); }
        }
      });
    }
    case 'set_title': window.setTitle(args.title || 'PicoMarQ'); return;
    case 'close_window': enqueueClose(record, { replaceLast: true }); return;
    case 'quit': void requestQuit(); return;
    case 'close_prompting': if (record.closeToken === args.token) clearTimeout(record.closingTimer); return;
    case 'close_cancelled': finishCloseReply(record, args.token, null); return;
    case 'close_failed':
      finishCloseReply(record, args.token, null);
      dialog.showErrorBox('Session could not be saved', args.message || 'The editor will stay open so you can save your document.');
      return;
    case 'close_prepared': {
      if (!record.closeWait || record.closeToken !== args.token) return;
      if (!['keep', 'discard'].includes(args.disposition)) throw new Error('Invalid close response.');
      finishCloseReply(record, args.token, { document: validateSnapshot(record, args), disposition: args.disposition });
      return;
    }
    case 'open_dialog': {
      const result = await dialog.showOpenDialog(window, { title: args.title || 'Open Markdown', properties: args.multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters: args.filters || [{ name: 'Markdown and text', extensions: ['md', 'markdown', 'txt'] }, { name: 'All files', extensions: ['*'] }] });
      return result.canceled ? null : args.multiple ? result.filePaths.map(file => grant(record, file)) : grant(record, result.filePaths[0]);
    }
    case 'save_dialog': {
      const result = await dialog.showSaveDialog(window, { title: args.title || 'Save Markdown', defaultPath: args.defaultPath || 'Untitled.md', filters: args.filters || [{ name: 'Markdown', extensions: ['md'] }] });
      return result.canceled ? null : grant(record, result.filePath);
    }
    case 'read_document': return readDocument(approvedPath(record, args.path));
    case 'save_document': {
      const file = approvedPath(record, args.path);
      const key = pathKey(file);
      const owner = [...windows.values()].find(other => other !== record && other.path && pathKey(other.path) === key);
      if (owner || savingPaths.has(key)) throw new Error('That file is already open in another window. Choose a different filename or close that window first.');
      savingPaths.set(key, record);
      try {
        const saved = await writeDocument(file, args.content, args.expectedContent, args.force);
        if (!saved.conflict) {
          record.path = file;
          await store.updateDocument({ ...currentDocument(record), path: file, content: args.content, diskContent: args.content, modified: saved.modified });
          buildMenu();
        }
        return saved;
      } finally { savingPaths.delete(key); }
    }
    case 'remember_document': {
      const file = approvedPath(record, args.path);
      await store.update({ recentFiles: recentFiles(store.get().recentFiles, file) });
      buildMenu(); return;
    }
    case 'confirm_unsaved': {
      window.show(); window.focus();
      const result = await dialog.showMessageBox(window, { type: 'question', title: 'Save changes?', message: `Save changes to ${args.title || 'Untitled'}?`, buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
      return ['save', 'discard', 'cancel'][result.response];
    }
    case 'confirm_overwrite': {
      const result = await dialog.showMessageBox(window, { type: 'warning', title: 'File changed outside PicoMarQ', message: 'This file has changed since you opened it.', detail: 'Overwrite replaces the other version with your current document. Save As keeps both versions.', buttons: ['Save As…', 'Overwrite', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
      return ['save-as', 'overwrite', 'cancel'][result.response];
    }
    case 'confirm_revert': {
      const result = await dialog.showMessageBox(window, { type: 'question', message: 'Revert to the saved file?', detail: 'Your current edits will be replaced by the file on disk. This clears the document’s undo history.', buttons: ['Revert', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      return result.response === 0;
    }
    case 'installed_fonts': return installedFonts(args.refresh);
    case 'copy_to_clipboard': clipboard.writeText(args.text); return;
    case 'read_clipboard': return clipboard.readText();
    case 'clipboard_action': {
      if (!['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo'].includes(args.action)) throw new Error('Unknown editing command.');
      window.webContents[args.action](); return;
    }
    case 'app_menu': return new Promise((resolve, reject) => {
      if (!['file', 'edit', 'view', 'help'].includes(args.menu)) return reject(new Error('Unknown menu.'));
      const menu = menuFor(record).getMenuItemById(args.menu).submenu;
      const [width, height] = window.getContentSize();
      const x = Math.max(0, Math.min(width, Math.round(Number(args.x) || 0)));
      const y = Math.max(0, Math.min(height, Math.round(Number(args.y) || 0)));
      menu.popup({ window, x, y, callback: resolve });
    });
    case 'open_url_safe': {
      const url = new URL(args.url);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('Unsupported link.');
      await shell.openExternal(url.toString()); return;
    }
    case 'read_image': {
      const file = approvedPath(record, args.path);
      const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
      const type = types[path.extname(file).slice(1).toLowerCase()];
      if (!type) throw new Error('Unsupported image format.');
      return `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`;
    }
    case 'set_title_bar_theme': nativeTheme.themeSource = args.isDark ? 'dark' : 'light'; return;
    case 'print': return new Promise((resolve, reject) => window.webContents.print({ printBackground: true }, (ok, reason) => ok || /cancel/i.test(reason || '') ? resolve() : reject(new Error(reason))));
    default: throw new Error(`Unsupported command: ${action}`);
  }
}

async function createDocumentWindow(doc, { restored = false } = {}) {
  const state = store.get();
  const displays = screen.getAllDisplays();
  let bounds = restoreBounds(doc.window || state.window, displays);
  if (!restored && windows.size) {
    const previous = focusedRecord()?.window.getNormalBounds();
    if (previous) bounds = restoreBounds({ ...previous, x: previous.x + 30, y: previous.y + 30 }, displays);
  }
  const window = new BrowserWindow({ ...bounds, minWidth: 600, minHeight: 400, show: false, backgroundColor: '#ffffff', title: 'PicoMarQ', icon: path.join(__dirname, '../app.ico'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, defaultEncoding: 'UTF-8' } });
  const record = { window, id: doc.id, path: doc.path, allowed: new Set(), ready: false, commands: [], contextMenuExtras: null, closeApproved: false, closeToken: null, closeWait: null };
  windows.set(window.webContents.id, record);
  if (doc.path) grant(record, doc.path);
  buildMenu();
  window.webContents.on('context-menu', (_event, params) => {
    const pending = record.contextMenuExtras;
    record.contextMenuExtras = null;
    if (!pending || Date.now() - pending.at > 3000) return;
    Menu.buildFromTemplate(contextMenuTemplate(params, pending.items, {
      command: (action, extra) => command(record, action, extra),
      replaceMisspelling: text => window.webContents.replaceMisspelling(text),
      ignoreAll: word => command(record, 'ignore-spelling', { word }),
      addToDictionary: word => window.webContents.session.addWordToSpellCheckerDictionary(word),
    })).popup({ window, callback: () => {} });
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.alt && !input.control && !input.meta && !input.shift) {
      const menu = { f: 'file', e: 'edit', v: 'view', h: 'help' }[input.key.toLowerCase()];
      if (menu) { event.preventDefault(); command(record, `menu-${menu}`); }
      return;
    }
    if (input.alt || (!input.control && !input.meta)) return;
    let action;
    if (input.key === '+' || input.key === '=' || input.code === 'NumpadAdd') action = 'zoom-in';
    else if (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract') action = 'zoom-out';
    else if (input.key === '0' && !input.shift) action = 'zoom-reset';
    if (action) { event.preventDefault(); command(record, action); }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  function saveGeometry() {
    clearTimeout(record.geometryTimer);
    record.geometryTimer = setTimeout(() => {
      if (window.isDestroyed() || record.closeApproved || quitting) return;
      const current = currentDocument(record);
      if (current) void store.updateDocument({ ...current, window: geometry(record) }).catch(console.error);
    }, 250);
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, saveGeometry);
  window.on('focus', () => {
    if (!record.closeApproved && currentDocument(record)) void store.update({ activeDocumentId: record.id }).catch(console.error);
    buildMenu();
  });
  window.on('close', event => {
    if (record.closeApproved) return;
    event.preventDefault();
    enqueueClose(record);
  });
  const webContentsId = window.webContents.id;
  window.on('closed', () => {
    clearTimeout(record.geometryTimer); clearTimeout(record.closingTimer);
    if (record.closeWait) { record.closeWait(null); record.closeWait = null; }
    windows.delete(webContentsId);
    if (windows.size) buildMenu();
  });
  const shown = new Promise(resolve => window.once('ready-to-show', () => {
    if ((restored ? doc.window || state.window : state.window)?.maximized) window.maximize();
    window.show();
    resolve();
  }));
  try {
    if (process.env.SCRATCH_DEV_URL) await window.loadURL(process.env.SCRATCH_DEV_URL);
    else await window.loadURL(pathToFileURL(path.join(__dirname, '../dist/index.html')).toString());
    await shown;
  } catch (error) { record.closeApproved = true; window.destroy(); throw error; }
  return record;
}
async function newDocumentWindow({ replacing } = {}) {
  assertOpeningAllowed();
  const documents = store.get().documents.filter(doc => doc.id !== replacing?.id);
  let name = 'Untitled';
  for (let number = 2; documents.some(doc => !doc.path && doc.name === name); number++) name = `Untitled ${number}`;
  const doc = { id: crypto.randomUUID(), name, path: null, content: '', diskContent: '', modified: Date.now() / 1000, view: {}, ...(replacing ? { window: geometry(replacing) } : {}) };
  await store.updateDocument(doc, { create: true, activate: true });
  try {
    const record = await createDocumentWindow(doc, { restored: !!replacing });
    return record.id;
  } catch (error) {
    await store.removeDocuments([doc.id]);
    throw error;
  }
}
async function openDocumentWindow(file) {
  assertOpeningAllowed();
  file = path.resolve(file);
  const existing = savingPaths.get(pathKey(file)) || [...windows.values()].find(record => record.path && pathKey(record.path) === pathKey(file));
  if (existing) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.show(); existing.window.focus();
  } else {
    // Read first so a failed Open cannot replace a draft or leave an empty window.
    const doc = { ...await readDocument(file), id: crypto.randomUUID(), view: {} };
    await store.updateDocument(doc, { create: true, activate: true });
    await createDocumentWindow(doc);
  }
  await store.update({ recentFiles: recentFiles(store.get().recentFiles, file) });
  buildMenu();
}
function launchPaths(argv, directory = process.cwd()) {
  return argv.filter(arg => typeof arg === 'string' && /\.(md|markdown|txt)$/i.test(arg) && !arg.startsWith('--')).map(file => path.resolve(directory, file));
}
function handleLaunch(files) {
  if (!initialized) { pendingLaunches.push(...files); return; }
  void enqueueOpen(async () => {
    if (!files.length) { const record = focusedRecord(); if (record) { record.window.restore(); record.window.show(); record.window.focus(); } else await newDocumentWindow(); }
    for (const file of files) {
      try { await openDocumentWindow(file); }
      catch (error) { dialog.showErrorBox('Could not open the file', error.message); }
    }
  });
}

const haveLock = process.env.SCRATCH_TEST_MODE === '1' || app.requestSingleInstanceLock();
if (!haveLock) app.quit();
else {
  pendingLaunches.push(...launchPaths(process.argv));
  app.on('second-instance', (_event, argv, directory) => handleLaunch(launchPaths(argv, directory)));
  app.on('open-file', (event, file) => { event.preventDefault(); handleLaunch([file]); });
  app.on('before-quit', event => {
    if (quitCommitted || !windows.size) return;
    event.preventDefault();
    void requestQuit();
  });
  ipcMain.handle('scratch:invoke', handleInvoke);
  ipcMain.on('scratch:context-menu', (event, extras) => {
    event.returnValue = true;
    const record = windows.get(event.sender.id);
    if (record) record.contextMenuExtras = { items: sanitizeExtras(extras), at: Date.now() };
  });
  startupReady = app.whenReady().then(async () => {
    // US English spelling, whatever language Windows is set to.
    try { session.defaultSession.setSpellCheckerLanguages(['en-US']); }
    catch (error) { console.warn('Could not set the spelling language:', error.message); }
    // No file is fetched from another computer's shared folder, except from
    // the computer an open document is on or PicoMarQ itself runs from (see
    // shared-folders.cjs). The page already leaves such pictures out; this
    // holds whatever the page asks for.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      // Every request of the window comes through here, its own files too:
      // whatever happens, it must get an answer.
      let cancel = false;
      try {
        cancel = refusesRequest(details.url, [__dirname, ...[...windows.values()].map(record => record.path)]);
        if (cancel) refusedRequests.push(details.url);
        if (refusedRequests.length > 20) refusedRequests.shift();
      } catch (error) { console.warn('Could not check a request:', error.message); }
      callback({ cancel });
    });
    const state = await store.load();
    const restore = await shouldRestoreSession(state, async count => {
      const result = await dialog.showMessageBox({
        type: 'question', title: 'Recover Unsaved Work',
        message: `PicoMarQ found unsaved work in ${count === 1 ? 'a document' : `${count} documents`} from the previous session.`,
        detail: 'Restore Session reopens the previous documents with their unsaved edits. Start New Session discards those recovered edits. Your saved files and preferences are kept.',
        buttons: ['Restore Session', 'Start New Session'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return result.response === 0;
    });
    if (!restore) await store.update({ documents: [], activeDocumentId: null, settingsOpen: false });
    // Each document in an existing v1 profile becomes a window, preserving drafts.
    for (const doc of restore ? state.documents : []) {
      const restored = { ...doc, view: { ...doc.view, settingsOpen: doc.view?.settingsOpen ?? (doc.id === state.activeDocumentId && state.settingsOpen) } };
      await store.updateDocument(restored);
      await createDocumentWindow(restored, { restored: true });
    }
    const requested = pendingLaunches.splice(0);
    for (const file of requested) {
      try { await openDocumentWindow(file); }
      catch (error) { dialog.showErrorBox('Could not open the file', error.message); }
    }
    if (!windows.size) await newDocumentWindow();
    else {
      const wanted = requested.length ? store.get().activeDocumentId : restore ? state.activeDocumentId : null;
      const record = [...windows.values()].find(record => record.id === wanted) || focusedRecord();
      record?.window.focus();
    }
    initialized = true;
    if (pendingLaunches.length) handleLaunch(pendingLaunches.splice(0));
  }).catch(error => { dialog.showErrorBox('PicoMarQ could not start', error.stack || error.message); app.exit(1); });
  app.on('window-all-closed', () => { if (initialized || quitCommitted) app.quit(); });
}
