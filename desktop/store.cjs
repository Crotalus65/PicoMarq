const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { recentFiles } = require('./recent.cjs');

const viewKeys = ['sourceMode', 'selection', 'sourceSelection', 'scrollTop', 'sourceScrollTop', 'sourceScrollLeft', 'settingsOpen'];
const windowKeys = ['x', 'y', 'width', 'height', 'maximized'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));

function workspaceState(value) {
  const seen = new Set();
  const candidates = Array.isArray(value.documents) ? value.documents : value.document ? [value.document] : [];
  const documents = candidates.filter(doc => doc && typeof doc.content === 'string').map(doc => ({
    ...doc,
    id: typeof doc.id === 'string' ? doc.id : crypto.randomUUID(),
    path: typeof doc.path === 'string' ? doc.path : null,
    diskContent: typeof doc.diskContent === 'string' ? doc.diskContent : '',
    view: pick(doc.view, viewKeys),
    ...(doc.window ? { window: pick(doc.window, windowKeys) } : {}),
  })).filter(doc => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
  const activeDocumentId = documents.some(doc => doc.id === value.activeDocumentId) ? value.activeDocumentId : documents.at(-1)?.id ?? null;
  return { documents, activeDocumentId, settingsOpen: value.settingsOpen ?? value.document?.view?.settingsOpen ?? false };
}

async function atomicWrite(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, contents, 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function createStore(directory) {
  const statePath = path.join(directory, 'session.json');
  const backupPath = path.join(directory, 'session-backup.json');
  let state = { version: 1, settings: { theme: { mode: 'system' }, editorWidth: 'full' }, documents: [], activeDocumentId: null, settingsOpen: false, window: null, recentFiles: [] };
  let queue = Promise.resolve();
  async function load() {
    for (const candidate of [statePath, backupPath]) {
      try {
        const parsed = JSON.parse(await fs.readFile(candidate, 'utf8'));
        if (parsed.version !== 1 || !parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) continue;
        const { document: _legacy, ...current } = parsed;
        state = { ...state, ...current, ...workspaceState(parsed) };
        state.settings = { ...state.settings, editorWidth: state.settings.editorWidth === 'custom' ? 'custom' : 'full' };
        if (state.window) state.window = pick(state.window, windowKeys);
        state.recentFiles = recentFiles(parsed.recentFiles ?? state.documents.map(doc => doc.path).reverse());
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not read session:', error.message);
      }
    }
    return get();
  }
  function update(patch) {
    if ('documents' in patch || 'document' in patch) {
      const { document: _legacy, ...current } = patch;
      patch = { ...current, ...workspaceState(patch) };
    }
    state = { ...state, ...patch };
    const snapshot = JSON.stringify(state, null, 2);
    const write = queue.catch(() => {}).then(async () => {
      await atomicWrite(statePath, snapshot);
      await atomicWrite(backupPath, snapshot);
    });
    queue = write;
    return write;
  }
  // Callers get their own copy of the state, but document text is immutable and
  // can be shared instead of being deep-copied on every menu rebuild or
  // settings change (each copy of a large session costs tens of milliseconds).
  function cloneDocument(doc) {
    return { ...structuredClone({ ...doc, content: '', diskContent: '' }), content: doc.content, diskContent: doc.diskContent };
  }
  function get() {
    return { ...structuredClone({ ...state, documents: [] }), documents: state.documents.map(cloneDocument) };
  }
  // Merge against the current in-memory state before queueing the disk write.
  // A renderer owns one document, never the complete list of other windows.
  function updateDocument(document, { create = false, activate = false } = {}) {
    const index = state.documents.findIndex(doc => doc.id === document.id);
    if (index < 0 && !create) throw new Error('This document is no longer open.');
    const documents = [...state.documents];
    if (index < 0) documents.push(document); else documents[index] = document;
    return update({ documents, activeDocumentId: activate ? document.id : state.activeDocumentId, settingsOpen: false });
  }
  function removeDocuments(ids) {
    const removed = new Set(ids);
    const documents = state.documents.filter(doc => !removed.has(doc.id));
    return update({ documents, activeDocumentId: removed.has(state.activeDocumentId) ? documents.at(-1)?.id ?? null : state.activeDocumentId, settingsOpen: false });
  }
  return { load, update, updateDocument, removeDocuments, get, flush: () => queue };
}

async function readDocument(file) {
  const content = await fs.readFile(file, 'utf8');
  const stat = await fs.stat(file);
  return { path: file, content: content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), modified: stat.mtimeMs / 1000, diskContent: content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') };
}

async function writeDocument(file, content, expectedContent, force = false) {
  if (expectedContent !== undefined && !force) {
    try {
      const current = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      if (current !== expectedContent) return { conflict: true };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { conflict: true, missing: true };
    }
  }
  await atomicWrite(file, content);
  return { ...await readDocument(file), conflict: false };
}

function restoreBounds(saved, displays) {
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height) || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { width: 1080, height: 760 };
  const display = displays.find(({ workArea: a }) => saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y) || displays[0];
  if (!display) return { width: 1080, height: 760 };
  const a = display.workArea;
  const width = Math.min(Math.max(600, saved.width), a.width);
  const height = Math.min(Math.max(400, saved.height), a.height);
  return { width, height, x: Math.max(a.x, Math.min(saved.x, a.x + a.width - width)), y: Math.max(a.y, Math.min(saved.y, a.y + a.height - height)) };
}

module.exports = { atomicWrite, createStore, readDocument, writeDocument, restoreBounds };
