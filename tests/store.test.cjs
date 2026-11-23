const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStore, writeDocument, readDocument, restoreBounds } = require('../desktop/store.cjs');
const { recentFiles } = require('../desktop/recent.cjs');
const { profileDirectory } = require('../desktop/profile.cjs');

test('saving refuses to overwrite a file edited elsewhere', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scratch-file-'));
  try {
    const file = path.join(dir, 'Draft with ünicode.md');
    await fs.writeFile(file, 'original');
    await fs.writeFile(file, 'external edit');
    assert.equal((await writeDocument(file, 'my edit', 'original')).conflict, true);
    assert.equal((await readDocument(file)).content, 'external edit');
    assert.equal((await writeDocument(file, 'my edit', 'original', true)).conflict, false);
    assert.equal((await readDocument(file)).content, 'my edit');
    assert.deepEqual((await fs.readdir(dir)), ['Draft with ünicode.md']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('a missing file requires explicit replacement; new files save normally', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scratch-new-'));
  try {
    const file = path.join(dir, 'new.md');
    assert.equal((await writeDocument(file, 'text', 'old')).missing, true);
    await writeDocument(file, 'text');
    assert.equal((await readDocument(file)).content, 'text');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('concurrent recovery updates retain the latest draft, font, zoom, and selection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scratch-session-'));
  try {
    const store = createStore(dir);
    await store.load();
    await Promise.all([
      store.update({ settings: { theme: { mode: 'dark' }, editorFont: { systemFontFamily: 'My Font' }, interfaceZoom: 1.2 } }),
      store.update({ document: { id: 'one', content: 'unsaved text', view: { sourceMode: true, sourceSelection: { start: 2, end: 8 }, scrollTop: 150 } } }),
      store.update({ window: { x: 10, y: 20, width: 900, height: 600, maximized: true } }),
    ]);
    const restored = await createStore(dir).load();
    assert.equal(restored.documents[0].content, 'unsaved text');
    assert.equal(restored.documents[0].view.sourceSelection.end, 8);
    assert.equal(restored.settings.editorFont.systemFontFamily, 'My Font');
    assert.equal(restored.settings.interfaceZoom, 1.2);
    assert.equal(restored.window.maximized, true);
    await fs.writeFile(path.join(dir, 'session.json'), '{broken');
    assert.equal((await createStore(dir).load()).documents[0].content, 'unsaved text');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('window from a disconnected monitor is restored on a visible screen', () => {
  assert.deepEqual(restoreBounds({ x: 2400, y: 0, width: 1080, height: 720 }, [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]), { x: 840, y: 0, width: 1080, height: 720 });
});

test('recent files stay distinct, newest first, and limited to four', () => {
  const files = ['a', 'b', 'c', 'd', 'e'].map(name => path.join(os.tmpdir(), `${name}.md`));
  assert.deepEqual(recentFiles(files), files.slice(0, 4));
  assert.deepEqual(recentFiles(files.slice(0, 4), files[2]), [files[2], files[0], files[1], files[3]]);
  assert.deepEqual(recentFiles([null, 'relative.md', ...files], files[4]), [files[4], ...files.slice(0, 3)]);
  assert.deepEqual(recentFiles(['C:\\Notes\\A.md', 'C:\\Notes\\B.md'], 'c:\\notes\\a.md', 'win32'), ['c:\\notes\\a.md', 'C:\\Notes\\B.md']);
});

test('recent files survive session writes and backup recovery', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picomarq-recent-'));
  try {
    const files = ['a', 'b', 'c', 'd'].map(name => path.join(dir, `${name}.md`));
    const store = createStore(dir);
    assert.deepEqual((await store.load()).recentFiles, []);
    await store.update({ recentFiles: files });
    assert.deepEqual((await createStore(dir).load()).recentFiles, files);
    await fs.writeFile(path.join(dir, 'session.json'), '{broken');
    assert.deepEqual((await createStore(dir).load()).recentFiles, files);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('existing drafts and settings survive the removed modes and page widths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picomarq-legacy-'));
  try {
    assert.equal((await createStore(dir).load()).settings.editorWidth, 'full');
    for (const width of ['narrow', 'normal', 'wide', 'full', 'custom']) {
      const file = path.join(dir, 'last.md');
      const legacy = {
        version: 1,
        settings: { theme: { mode: 'dark' }, editorWidth: width, customEditorWidthPx: 670, editorFont: { systemFontFamily: 'My Font' }, interfaceZoom: 1.3 },
        document: { id: 'old', path: file, content: 'unsaved draft', diskContent: 'saved', view: { sourceMode: true, sourceSelection: { start: 2, end: 6 }, focusMode: true } },
        window: { x: 10, y: 20, width: 900, height: 600, maximized: true, fullscreen: true },
      };
      await fs.writeFile(path.join(dir, 'session.json'), JSON.stringify(legacy));
      const migrated = await createStore(dir).load();
      assert.equal(migrated.settings.editorWidth, width === 'custom' ? 'custom' : 'full');
      assert.equal(migrated.settings.customEditorWidthPx, 670);
      assert.equal(migrated.settings.editorFont.systemFontFamily, 'My Font');
      assert.equal(migrated.settings.interfaceZoom, 1.3);
      assert.equal(migrated.documents[0].content, 'unsaved draft');
      assert.deepEqual(migrated.documents[0].view, { sourceMode: true, sourceSelection: { start: 2, end: 6 } });
      assert.deepEqual(migrated.window, { x: 10, y: 20, width: 900, height: 600, maximized: true });
      assert.deepEqual(migrated.recentFiles, [file]);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('PicoMarQ reuses a valid Quill or older legacy profile, including its backup, before creating a new one', async () => {
  const appData = await fs.mkdtemp(path.join(os.tmpdir(), 'picomarq-profile-'));
  try {
    const current = path.join(appData, 'PicoMarQ');
    const quill = path.join(appData, 'Quill');
    const legacy = path.join(appData, 'Scratch Custom');
    const lowercase = path.join(appData, 'scratch-custom');
    assert.equal(profileDirectory(appData), current);
    await fs.mkdir(lowercase);
    const session = JSON.stringify({ version: 1, settings: { theme: { mode: 'dark' } }, document: { content: 'draft' } });
    await fs.writeFile(path.join(lowercase, 'session.json'), session);
    assert.equal(profileDirectory(appData), lowercase);
    await fs.mkdir(legacy);
    await fs.writeFile(path.join(legacy, 'session.json'), '{broken');
    await fs.writeFile(path.join(legacy, 'session-backup.json'), session);
    assert.equal(profileDirectory(appData), legacy);
    await fs.mkdir(quill);
    await fs.writeFile(path.join(quill, 'session.json'), session);
    assert.equal(profileDirectory(appData), quill);
    await fs.mkdir(current);
    await fs.writeFile(path.join(current, 'session.json'), JSON.stringify({ version: 1, settings: null }));
    assert.equal(profileDirectory(appData), quill);
    await fs.writeFile(path.join(current, 'session.json'), session);
    assert.equal(profileDirectory(appData), current);
  } finally { await fs.rm(appData, { recursive: true, force: true }); }
});

test('all open documents, their positions, and the active document survive backup recovery', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picomarq-documents-'));
  try {
    const store = createStore(dir);
    await store.load();
    const documents = [
      { id: 'one', path: path.join(dir, 'one.md'), content: 'saved one plus draft', diskContent: 'saved one', view: { selection: { anchor: 5, head: 8 }, scrollTop: 120 } },
      { id: 'two', name: 'Untitled 2', path: null, content: 'unfiled draft', diskContent: '', view: { sourceMode: true, sourceSelection: { start: 2, end: 8, direction: 'backward' }, sourceScrollTop: 400 } },
    ];
    await Promise.all([
      store.update({ documents, activeDocumentId: 'one', settingsOpen: true }),
      store.update({ settings: { editorWidth: 'full', interfaceZoom: 1.4 } }),
    ]);
    await fs.writeFile(path.join(dir, 'session.json'), '{broken');
    const restored = await createStore(dir).load();
    assert.deepEqual(restored.documents, documents);
    assert.equal(restored.activeDocumentId, 'one');
    assert.equal(restored.settingsOpen, true);
    assert.equal(restored.settings.interfaceZoom, 1.4);
    assert.equal('document' in restored, false);
    await store.update({ documents: [documents[1]], activeDocumentId: 'missing' });
    assert.equal((await createStore(dir).load()).activeDocumentId, 'two');
    await store.update({ documents: [], activeDocumentId: null });
    const empty = await createStore(dir).load();
    assert.deepEqual(empty.documents, []);
    assert.equal(empty.activeDocumentId, null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('independent window updates merge drafts without overwriting their neighbours', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picomarq-windows-'));
  try {
    const store = createStore(dir);
    await store.load();
    const one = { id: 'one', path: null, content: 'draft one', diskContent: '', view: { sourceMode: true }, window: { x: 10, y: 20, width: 800, height: 600 } };
    const two = { id: 'two', path: null, content: 'draft two', diskContent: '', view: { scrollTop: 100 }, window: { x: 50, y: 60, width: 900, height: 700 } };
    await store.updateDocument(one, { create: true });
    await store.updateDocument(two, { create: true, activate: true });
    await Promise.all([
      store.updateDocument({ ...one, content: 'one latest' }),
      store.updateDocument({ ...two, content: 'two latest' }),
      store.update({ settings: { theme: { mode: 'dark' } } }),
    ]);
    const recovered = await createStore(dir).load();
    assert.deepEqual(recovered.documents.map(doc => doc.content), ['one latest', 'two latest']);
    assert.deepEqual(recovered.documents[0].window, one.window);
    assert.deepEqual(recovered.documents[1].window, two.window);
    assert.equal(recovered.activeDocumentId, 'two');
    await store.removeDocuments(['one']);
    assert.throws(() => store.updateDocument(one), /no longer open/);
    assert.deepEqual((await createStore(dir).load()).documents.map(doc => doc.id), ['two']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
