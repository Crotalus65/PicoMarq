export interface DesktopCommand { action: string; path?: string; id?: string; token?: string; word?: string }
export interface ViewState {
  sourceMode?: boolean;
  selection?: { anchor: number; head: number };
  sourceSelection?: { start: number; end: number; direction?: 'forward' | 'backward' | 'none' };
  scrollTop?: number;
  sourceScrollTop?: number;
  sourceScrollLeft?: number;
  settingsOpen?: boolean;
}
export interface DocumentState {
  id: string;
  path: string | null;
  content: string;
  diskContent: string;
  modified: number;
  view: ViewState;
  name?: string;
}
export interface WorkspaceState {
  documents: DocumentState[];
  activeDocumentId: string | null;
  settingsOpen?: boolean;
}
declare global {
  interface Window {
    desktop?: {
      platform: string;
      invoke: <T = unknown>(action: string, args?: Record<string, unknown>) => Promise<T>;
      onCommand: (callback: (command: DesktopCommand) => void) => () => void;
      onSettingsChanged: (callback: (settings: import('../types/note').Settings) => void) => () => void;
      contextMenu?: (extras: { items: Array<{ id?: string; text?: string; type?: 'separator' }> }) => void;
    };
  }
}
export async function invoke<T = void>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  if (window.desktop) return window.desktop.invoke<T>(action, args);
  const settings = JSON.parse(localStorage.getItem('scratch-settings') || '{"theme":{"mode":"system"}}');
  switch (action) {
    case 'get_settings': return settings as T;
    case 'update_settings': {
      const updated = { ...settings, ...(args.patch as Record<string, unknown>) };
      localStorage.setItem('scratch-settings', JSON.stringify(updated));
      return updated as T;
    }
    case 'get_session': {
      const saved = JSON.parse(localStorage.getItem('scratch-session') || 'null');
      return { ...(saved?.documents ? saved : { documents: saved ? [saved] : [], activeDocumentId: saved?.id }), settings } as T;
    }
    case 'save_session': localStorage.setItem('scratch-session', JSON.stringify(args)); return undefined as T;
    case 'renderer_ready': return undefined as T;
    case 'set_title': document.title = String(args.title); return undefined as T;
    case 'set_title_bar_theme': return undefined as T;
    case 'copy_to_clipboard': await navigator.clipboard.writeText(String(args.text)); return undefined as T;
    case 'read_clipboard': return await navigator.clipboard.readText() as T;
    case 'installed_fonts': {
      const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
      if (!query) throw new Error('Open the desktop version to choose installed fonts.');
      return [...new Set((await query()).map(font => font.family))].sort() as T;
    }
    default: throw new Error('This command is available in the desktop version.');
  }
}
export const open = (options: Record<string, unknown> = {}) => invoke<string | null>('open_dialog', options);
export const openUrl = (url: string) => invoke('open_url_safe', { url });
export function fileUrl(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  if (normalized.startsWith('//')) return `file:${normalized.split('/').map((part, i) => i < 3 ? part : encodeURIComponent(part)).join('/')}`;
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized.split('/').map((part, i) => /^[A-Za-z]:$/.test(part) && i === 0 ? part : encodeURIComponent(part)).join('/')}`;
}
/**
 * The other computer a file: address points at ("file://server/share/x.png",
 * or the same written with more slashes or with backslashes), or null for a
 * file on this computer and for any other kind of address.
 */
export function shareHostOf(address: string): string | null {
  // Four or more slashes after "file:" name a share on Windows; other systems
  // read them as a path on this computer, so the page's own reading of the
  // address would not show it everywhere. (Tabs and line breaks inside an
  // address are ignored by browsers.)
  const plain = address.replace(/[\t\n\r]/g, '').trim();
  const slashes = /^file:[\\/]{4,}([^\\/?#]*)/i.exec(plain);
  if (slashes) return slashes[1].toLowerCase();
  let url: URL;
  try { url = new URL(plain); } catch { return null; }
  if (url.protocol !== 'file:') return null;
  if (url.hostname && url.hostname.toLowerCase() !== 'localhost') return url.hostname.toLowerCase();
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* as it is */ }
  // A path on this computer starts with one slash: /C:/Users/..., /home/...
  const share = /^\/{2,}([^/]*)/.exec(path.replace(/\\/g, '/'));
  return share ? share[1].toLowerCase() : null;
}
function resolvedImageUrl(src: string, documentPath: string | null): string {
  if (/^(?:https?:|data:|file:|blob:)/i.test(src)) return src;
  if (/^[A-Za-z]:[\\/]|^\//.test(src)) return fileUrl(src);
  if (!documentPath) return src;
  return new URL(src.replace(/\\/g, '/'), fileUrl(documentPath)).toString();
}
/**
 * The address a picture is loaded from. A picture in a shared folder on
 * another computer is not loaded (the result is empty): asking that computer
 * for a file makes Windows sign in to it, which gives it the user's name and
 * a form of the password that can be attacked, and a document from someone
 * else could point a picture at a computer set up for that. The one share
 * that is trusted is the one the document itself is on.
 */
export function resolveImageUrl(src: string, documentPath: string | null): string {
  const address = resolvedImageUrl(src, documentPath);
  // A bare address that starts with two slashes or backslashes would be read by the page as "//server/share/x.png".
  const host = shareHostOf(/^[\\/]{2}/.test(address) ? `file:${address.replace(/\\/g, '/')}` : address);
  if (host === null) return address;
  return documentPath !== null && shareHostOf(fileUrl(documentPath)) === host ? address : '';
}
export interface ContextMenuItem {
  text?: string;
  action?: () => void;
  type?: 'separator';
}
// Actions for the extra items of the right-click menu currently on screen,
// keyed by the ids sent to the desktop shell.
const contextMenuActions = new Map<string, () => void>();
/**
 * Register the editor's right-click menu for the click being handled. Call
 * synchronously from the DOM contextmenu event without preventing its default:
 * the desktop shell then shows the editing menu (with spelling suggestions)
 * plus these items. In the browser the native menu simply appears.
 */
export function showContextMenu(items: ContextMenuItem[] = []): void {
  contextMenuActions.clear();
  const payload = items.map(item => {
    if (item.type === 'separator') return { type: 'separator' as const };
    const id = crypto.randomUUID();
    if (item.action) contextMenuActions.set(id, item.action);
    return { id, text: item.text ?? '' };
  });
  window.desktop?.contextMenu?.({ items: payload });
}
/** Run the action of a context-menu item the desktop shell reports as chosen. */
export function runContextMenuAction(id: string | undefined): void {
  const action = id ? contextMenuActions.get(id) : undefined;
  contextMenuActions.clear();
  action?.();
}
