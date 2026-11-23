import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { toast } from 'sonner';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { Editor, type EditorHandle, type PreviewModeData } from './components/editor/Editor';
import { SettingsPage } from './components/settings/SettingsPage';
import { Toaster } from './components/ui/Toaster';
import { TooltipProvider } from './components/ui/Tooltip';
import { invoke, runContextMenuAction, type DocumentState, type DesktopCommand, type WorkspaceState } from './lib/desktop';
import { wordCountLabel } from './lib/word-count';
import { forgetIgnoredWords } from './lib/ignored-spelling';

function nameOf(doc: DocumentState) { return doc.path?.split(/[\\/]/).pop() || doc.name || 'Untitled'; }
function blankDocument(existing: DocumentState[] = []): DocumentState {
  let name = 'Untitled';
  for (let number = 2; existing.some(doc => !doc.path && nameOf(doc) === name); number++) name = `Untitled ${number}`;
  return { id: crypto.randomUUID(), name, path: null, content: '', diskContent: '', modified: Date.now() / 1000, view: {} };
}
// Equality with the same meaning as comparing JSON.stringify output (undefined
// properties are ignored), without building multi-megabyte strings each second.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameJson(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  if (keys.length !== Object.keys(right).filter(key => right[key] !== undefined).length) return false;
  return keys.every(key => sameJson(left[key], right[key]));
}

// Each native document window owns its editor, undo history, and Find state.
function DocumentPane({ doc, active, generation, externalChanges, onReady, onContent, onWords, onSelectedWords, onRevert }: {
  doc: DocumentState; active: boolean; externalChanges: boolean;
  generation: number;
  onReady: (id: string, handle: EditorHandle, generation: number) => void;
  onContent: (id: string, content: string, generation: number) => Promise<void>;
  onWords: (id: string, count: number) => void;
  onSelectedWords: (id: string, count: number | null) => void;
  onRevert: (id: string) => Promise<void>;
}) {
  const handleReady = useCallback((handle: EditorHandle) => onReady(doc.id, handle, generation), [doc.id, generation, onReady]);
  const save = useCallback((content: string) => onContent(doc.id, content, generation), [doc.id, generation, onContent]);
  const words = useCallback((count: number) => onWords(doc.id, count), [doc.id, onWords]);
  const selectedWords = useCallback((count: number | null) => onSelectedWords(doc.id, count), [doc.id, onSelectedWords]);
  const reload = useCallback(() => onRevert(doc.id), [doc.id, onRevert]);
  // A window restored directly into Settings parses its document when first shown.
  const [mounted, setMounted] = useState(active);
  useEffect(() => { if (active) setMounted(true); }, [active]);
  const preview: PreviewModeData = { content: doc.content, title: nameOf(doc), filePath: doc.id, documentPath: doc.path, modified: doc.modified, hasExternalChanges: externalChanges, reloadVersion: 0, save, reload, dirty: doc.content !== doc.diskContent };
  return <div data-document-id={doc.id} className="flex-1 min-h-0 flex flex-col" style={{ display: active ? 'flex' : 'none' }} aria-hidden={!active}>
    {mounted && <Editor previewMode={preview} active={active} initialSession={doc.view} resumeSession={doc.view} onHandleReady={handleReady} onWordCountChange={words} onSelectedWordCountChange={selectedWords} />}
  </div>;
}

// The status bar's word count: "1,234 words", or "56 of 1,234 words" while text
// is selected. The total arrives as a prop. The selected count is written
// straight into the element instead of going through React state: a selection
// changes many times a second while it is dragged, and on every React update
// React re-reads the caret by walking the focused editor's content, which is
// slow in a long document. React renders the element empty and never touches
// its text.
type WordCountHandle = { setSelected: (count: number | null) => void };
function WordCount({ words, editor, ref }: { words: number; editor: string; ref: Ref<WordCountHandle> }) {
  const element = useRef<HTMLSpanElement>(null);
  const shown = useRef<{ words: number; selected: number | null; editor: string }>({ words, selected: null, editor });
  const paint = useCallback(() => {
    const text = wordCountLabel(shown.current.words, shown.current.selected);
    if (element.current && element.current.textContent !== text) element.current.textContent = text;
  }, []);
  useImperativeHandle(ref, () => ({
    setSelected(count) {
      if (shown.current.selected === count) return;
      shown.current.selected = count;
      paint();
    },
  }), [paint]);
  useLayoutEffect(() => {
    // Another document, or the same one reloaded: its selection starts empty.
    shown.current = { words, selected: shown.current.editor === editor ? shown.current.selected : null, editor };
    paint();
  });
  return <span ref={element} data-word-count aria-label="Word count" className="tabular-nums whitespace-nowrap" />;
}

function DocumentApp() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const workspaceRef = useRef<WorkspaceState | null>(null);
  const handlesRef = useRef(new Map<string, EditorHandle>());
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({});
  const wordCountRef = useRef<WordCountHandle>(null);
  const [externalChanges, setExternalChanges] = useState<Record<string, boolean>>({});
  const persistedRef = useRef<WorkspaceState | null>(null);
  const closingRef = useRef(false);
  const closeTokenRef = useRef<string | null>(null);
  const [closing, setClosing] = useState(false);
  const editorGenerationRef = useRef(0);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const persistQueue = useRef(Promise.resolve());
  const savingRef = useRef(0);
  const { setInterfaceZoom, interfaceZoom } = useTheme();
  const commandsRef = useRef<(command: DesktopCommand) => Promise<void>>(async () => {});
  const commandQueue = useRef(Promise.resolve());
  const commit = useCallback((next: WorkspaceState) => {
    workspaceRef.current = next;
    setWorkspace(next);
    for (const id of handlesRef.current.keys()) if (!next.documents.some(doc => doc.id === id)) handlesRef.current.delete(id);
    // Words ignored by the spelling checker last as long as their document is open.
    forgetIgnoredWords(next.documents.map(doc => doc.id));
  }, []);
  const captureDocument = useCallback((id: string): DocumentState | null => {
    const current = workspaceRef.current?.documents.find(doc => doc.id === id);
    if (!current) return null;
    const handle = handlesRef.current.get(id);
    const visible = workspaceRef.current?.activeDocumentId === id && !workspaceRef.current.settingsOpen;
    return { ...current, content: handle?.getContent() ?? current.content, view: visible ? { ...current.view, ...handle?.getSession() } : current.view };
  }, []);
  const captureWorkspace = useCallback((): WorkspaceState | null => {
    const current = workspaceRef.current;
    return current ? { ...current, documents: current.documents.map(doc => captureDocument(doc.id)!) } : null;
  }, [captureDocument]);
  const persist = useCallback(async (force = false) => {
    if (closingRef.current || (savingRef.current && !force)) return;
    const snapshot = captureWorkspace();
    if (!snapshot) return;
    if (!force && sameJson(snapshot, persistedRef.current)) return;
    const write = persistQueue.current.catch(() => {}).then(async () => {
      await invoke('save_session', { ...snapshot });
      persistedRef.current = snapshot;
    });
    persistQueue.current = write;
    await write;
  }, [captureWorkspace]);
  const showSettings = useCallback((open?: boolean) => {
    const current = captureWorkspace();
    if (current && current.settingsOpen !== (open ?? !current.settingsOpen)) commit({ ...current, settingsOpen: open ?? !current.settingsOpen });
  }, [captureWorkspace, commit]);
  async function rememberDocument(path: string) {
    try { await invoke('remember_document', { path }); }
    catch (error) { toast.error(`Could not update recent files: ${error}`); }
  }
  useEffect(() => {
    let active = true;
    invoke<WorkspaceState>('get_session').then(async session => {
      const changed: Record<string, boolean> = {};
      const documents: DocumentState[] = [];
      for (const recovered of session.documents) {
        let restored = recovered;
        if (restored.path) {
          try {
            const file = await invoke<{ content: string; modified: number }>('read_document', { path: restored.path });
            if (restored.content === restored.diskContent) restored = { ...restored, ...file, diskContent: file.content };
            else changed[restored.id] = file.content !== restored.diskContent;
          } catch {
            changed[restored.id] = true;
            if (active) toast.info(`${nameOf(restored)} is unavailable. Its recovered text is still here; use Save As to save it.`);
          }
        }
        documents.push(restored);
      }
      if (!active) return;
      if (!documents.length) documents.push(blankDocument());
      setExternalChanges(changed);
      commit({ documents, activeDocumentId: documents.some(doc => doc.id === session.activeDocumentId) ? session.activeDocumentId : documents[documents.length - 1].id, settingsOpen: session.settingsOpen ?? false });
    }).catch(error => {
      if (active) { const doc = blankDocument(); commit({ documents: [doc], activeDocumentId: doc.id }); toast.error(`Could not restore the session: ${error}`); }
    });
    return () => { active = false; };
  }, [commit]);
  useEffect(() => {
    if (workspace) void invoke('renderer_ready').catch(error => toast.error(String(error)));
  }, [!!workspace]);
  useEffect(() => {
    const timer = window.setInterval(() => { void persist().catch(error => toast.error(`Could not save recovery data: ${error}`, { id: 'session-error' })); }, 1000);
    return () => clearInterval(timer);
  }, [persist]);
  const doc = workspace?.documents.find(item => item.id === workspace.activeDocumentId);
  useEffect(() => {
    void invoke('set_title', { title: doc ? `${doc.content !== doc.diskContent ? '● ' : ''}${nameOf(doc)} — PicoMarQ` : 'PicoMarQ' }).catch(() => {});
  }, [doc?.path, doc?.name, doc?.content, doc?.diskContent]);
  const checkExternal = useCallback(async (id: string) => {
    const current = workspaceRef.current?.documents.find(doc => doc.id === id);
    if (!current?.path) return;
    let changed = true;
    try { const file = await invoke<{ content: string }>('read_document', { path: current.path }); changed = file.content !== current.diskContent; } catch { /* Missing files retain their recovered text. */ }
    if (workspaceRef.current?.documents.find(doc => doc.id === id)?.diskContent === current.diskContent) setExternalChanges(previous => ({ ...previous, [id]: changed }));
  }, []);
  useEffect(() => {
    const check = () => { const id = workspaceRef.current?.activeDocumentId; if (id) void checkExternal(id); };
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [checkExternal]);
  async function saveDocument(id = workspaceRef.current?.activeDocumentId, as = false): Promise<boolean> {
    savingRef.current += 1;
    try {
      const snapshot = id ? captureDocument(id) : null;
      if (!snapshot) return false;
      let file = as ? null : snapshot.path;
      if (!file) file = await invoke<string | null>('save_dialog', { defaultPath: snapshot.path || `${nameOf(snapshot)}.md` });
      if (!file) return false;
      // Drain older recovery writes before Save As changes this window's path.
      await persistQueue.current.catch(() => {});
      const args = { path: file, content: snapshot.content, expectedContent: file === snapshot.path ? snapshot.diskContent : undefined };
      let saved = await invoke<{ conflict: boolean; modified: number }>('save_document', args);
      if (saved.conflict) {
        const choice = await invoke<string>('confirm_overwrite');
        if (choice === 'save-as') return saveDocument(id, true);
        if (choice !== 'overwrite') return false;
        saved = await invoke('save_document', { ...args, force: true });
      }
      const latest = captureWorkspace();
      if (!latest) return true;
      commit({ ...latest, documents: latest.documents.map(doc => doc.id === id ? { ...doc, path: file, diskContent: snapshot.content, modified: saved.modified } : doc) });
      setExternalChanges(previous => ({ ...previous, [snapshot.id]: false }));
      await persist(true);
      await rememberDocument(file);
      return true;
    } finally { savingRef.current -= 1; }
  }
  async function prepareClose(token: string) {
    try {
      if (closeTokenRef.current !== token) return;
      await invoke('close_prompting', { token });
      await persistQueue.current.catch(() => {});
      const doc = captureWorkspace()?.documents[0];
      if (!doc) { await invoke('close_cancelled', { token }); return; }
      let disposition = 'keep';
      if (doc.content !== doc.diskContent) {
        showSettings(false);
        const answer = await invoke<string>('confirm_unsaved', { title: nameOf(doc) });
        if (answer === 'cancel' || (answer === 'save' && !await saveDocument(doc.id))) {
          await invoke('close_cancelled', { token }); return;
        }
        if (answer === 'discard') disposition = 'discard';
      }
      await invoke('close_prepared', { ...captureWorkspace()!, token, disposition });
    } catch (error) { await invoke('close_failed', { token, message: String(error) }); }
  }
  async function openDocument(requested?: string) {
    const files = requested ? [requested] : await invoke<string[] | null>('open_dialog', { multiple: true });
    if (!files) return;
    await persist(true);
    await invoke('open_document_windows', { paths: files });
  }
  const revert = useCallback(async (id: string) => {
    const snapshot = captureDocument(id);
    if (!snapshot?.path || !await invoke<boolean>('confirm_revert')) return;
    const file = await invoke<{ content: string; diskContent: string; modified: number }>('read_document', { path: snapshot.path });
    const current = captureWorkspace();
    if (!current) return;
    // Retire the old editor before remounting it. Its unmount save callback
    // must not reinsert the text that the user just chose to discard.
    editorGenerationRef.current += 1;
    handlesRef.current.delete(id);
    const replacement = { ...snapshot, ...file };
    commit({ ...current, documents: current.documents.map(doc => doc.id === id ? replacement : doc) });
    setEditorGeneration(editorGenerationRef.current);
    setExternalChanges(previous => ({ ...previous, [id]: false }));
    await persist(true);
  }, [captureDocument, captureWorkspace, commit, persist]);
  commandsRef.current = async command => {
    if (closingRef.current && !['start-close', 'prepare-close', 'cancel-close'].includes(command.action)) return;
    const id = workspaceRef.current?.activeDocumentId;
    const handle = id ? handlesRef.current.get(id) : undefined;
    switch (command.action) {
      case 'new': {
        await persist(true);
        await invoke('new_window');
        break;
      }
      case 'open': await openDocument(); break;
      case 'open-path': await openDocument(command.path); break;
      case 'close-document': await invoke('close_window'); break;
      case 'save': await saveDocument(); break;
      case 'save-as': await saveDocument(id, true); break;
      case 'revert': if (id) await revert(id); break;
      case 'settings': showSettings(); break;
      case 'zoom-in': setInterfaceZoom(value => value + 0.1); break;
      case 'zoom-out': setInterfaceZoom(value => value - 0.1); break;
      case 'zoom-reset': setInterfaceZoom(1); break;
      case 'print': {
        showSettings(false);
        const source = handle?.getSession().sourceMode;
        if (source) handle?.command('source');
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        try { await invoke('print'); } finally { if (source) handle?.command('source'); }
        break;
      }
      case 'start-close':
        closingRef.current = true; closeTokenRef.current = command.token!; setClosing(true); break;
      case 'prepare-close': await prepareClose(command.token!); break;
      case 'cancel-close':
        if (closeTokenRef.current === command.token) {
          closingRef.current = false; closeTokenRef.current = null; setClosing(false); await persist(true);
        }
        break;
      case 'context-menu-item': runContextMenuAction(command.id); break;
      // Right-click > Ignore All on a word the spelling checker marked.
      case 'ignore-spelling': if (command.word) handle?.ignoreSpelling(command.word); break;
      // Unlike the default below, this must not leave Settings.
      case 'recheck-spelling': handle?.command('recheck-spelling'); break;
      default: showSettings(false); handle?.command(command.action);
    }
  };
  useEffect(() => {
    const dispatch = (command: DesktopCommand) => {
      commandQueue.current = commandQueue.current.catch(() => {}).then(() => commandsRef.current(command)).catch(error => { toast.error(error instanceof Error ? error.message : String(error)); });
    };
    const stop = window.desktop?.onCommand(dispatch);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') showSettings(false);
      if (event.key === 'F12' && !window.desktop) { event.preventDefault(); dispatch({ action: 'save-as' }); return; }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const zoomAction = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd' ? 'zoom-in'
        : event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract' ? 'zoom-out'
        : event.key === '0' && !event.shiftKey ? 'zoom-reset' : null;
      if (zoomAction) { event.preventDefault(); dispatch({ action: zoomAction }); return; }
      if (window.desktop) return;
      const actions: Record<string, string> = { n: 'new', o: 'open', w: 'close-document', s: 'save', ',': 'settings', p: 'print' };
      if (event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); dispatch({ action: 'source' }); }
      else if (actions[event.key.toLowerCase()]) { event.preventDefault(); dispatch({ action: actions[event.key.toLowerCase()] }); }
    };
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); dispatch({ action: event.deltaY < 0 ? 'zoom-in' : 'zoom-out' }); };
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', wheel, { passive: false });
    return () => { stop?.(); window.removeEventListener('keydown', key); window.removeEventListener('wheel', wheel); };
  }, [showSettings]);
  const handleReady = useCallback((id: string, handle: EditorHandle, generation: number) => {
    if (generation === editorGenerationRef.current && workspaceRef.current?.documents.some(doc => doc.id === id)) handlesRef.current.set(id, handle);
  }, []);
  const updateContent = useCallback(async (id: string, content: string, generation: number) => {
    if (generation !== editorGenerationRef.current) return;
    const current = workspaceRef.current;
    const doc = current?.documents.find(doc => doc.id === id);
    if (!current || !doc || doc.content === content) return;
    commit({ ...current, documents: current.documents.map(doc => doc.id === id ? { ...doc, content } : doc) });
  }, [commit]);
  const updateWords = useCallback((id: string, count: number) => {
    if (workspaceRef.current?.documents.some(doc => doc.id === id)) setWordCounts(previous => previous[id] === count ? previous : { ...previous, [id]: count });
  }, []);
  const updateSelectedWords = useCallback((id: string, count: number | null) => {
    if (workspaceRef.current?.activeDocumentId === id) wordCountRef.current?.setSelected(count);
  }, []);
  if (!workspace || !doc) return <div className="h-full bg-bg" />;
  const words = wordCounts[doc.id] ?? 0;
  return <div className="h-full flex flex-col bg-bg" inert={closing} aria-busy={closing}>
    <div className="flex-1 flex flex-col min-h-0" style={{ display: workspace.settingsOpen ? 'none' : 'flex' }}>
      <DocumentPane key={`${doc.id}:${editorGeneration}`} doc={doc} generation={editorGeneration} active={!workspace.settingsOpen} externalChanges={externalChanges[doc.id] ?? false} onReady={handleReady} onContent={updateContent} onWords={updateWords} onSelectedWords={updateSelectedWords} onRevert={revert} />
      <footer className="h-6 shrink-0 border-t border-border flex items-center justify-between px-3 text-[11px] text-text-muted select-none gap-4">
        <span className="truncate" title={doc.path || undefined}>{doc.path || nameOf(doc)}{doc.content !== doc.diskContent ? ' · Unsaved changes' : ''}</span>
        <div className="shrink-0 flex items-center gap-3">
          <WordCount ref={wordCountRef} words={words} editor={`${doc.id}:${editorGeneration}`} />
          <button onClick={() => showSettings(true)} className="hover:text-text" title="Settings (Ctrl+,)">{Math.round(interfaceZoom * 100)}%</button>
        </div>
      </footer>
    </div>
    {workspace.settingsOpen && <SettingsPage onBack={() => showSettings(false)} />}
    <Toaster />
  </div>;
}
export default function App() { return <ThemeProvider><TooltipProvider><DocumentApp /></TooltipProvider></ThemeProvider>; }
