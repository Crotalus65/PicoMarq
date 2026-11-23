import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
} from "react";
import {
  useEditor,
  EditorContent,
  ReactRenderer,
  ReactNodeViewRenderer,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { countWords, countDocumentWords, countSelectedWords } from "../../lib/word-count";
import { createTextareaMeasurer, lastIndexWhere, textareaOffsetTops } from "../../lib/textarea-position";
import { resolveAutoDirection } from "../../lib/text-direction";
import { recheckSpelling, recheckSpellingQuietly, recheckSpellingSoon } from "../../lib/spelling";
import "../../lib/minimal-text-updates";
import { ignoreWord, ignoredWords } from "../../lib/ignored-spelling";
import { convertMarkdownTypography, convertTypography, insideProtectedMarkdown, keystrokeReplacement, protectedMarkdownPlaces } from "../../lib/smart-typography";
import { findInText, findPattern } from "../../lib/find-text";
import { findInDocument } from "../../lib/find-in-document";
import { SmartTypography } from "./SmartTypography";
import { IgnoredSpelling, ignoredSpellingKey } from "./IgnoredSpelling";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { lowlight } from "./lowlight";
import { IncrementalLowlightPlugin } from "./lowlight-plugin";
import { FastOrderedList, FastTaskList } from "./markdown-tokenizers";
import { serializeDocumentMarkdown } from "./markdown-serialize";
import { CodeBlockView } from "./CodeBlockView";
import { Extension, InputRule, mergeAttributes } from "@tiptap/core";
import { Fragment, Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { open as openDialog, openUrl, invoke, resolveImageUrl, showContextMenu, type ContextMenuItem, type ViewState } from "../../lib/desktop";
import { toast } from "sonner";
import { mod, alt, shift, isMac } from "../../lib/platform";

// Prepend https:// if no protocol is present
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Validate URL scheme for safe opening
function isAllowedUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTheme } from "../../context/ThemeContext";
import { Frontmatter } from "./Frontmatter";
import { BlockMathEditor } from "./BlockMathEditor";
import { LinkEditor } from "./LinkEditor";
import { SearchToolbar } from "./SearchToolbar";
import { SearchHighlight, searchHighlightKey } from "./SearchHighlight";
import { QuietRecheck } from "./QuietRecheck";
import { Wikilink } from "./Wikilink";
import { EditorWidthHandles } from "./EditorWidthHandle";
import { ApplicationMenu } from "./ApplicationMenu";
import { ScratchBlockMath } from "./MathExtensions";
import { MarkdownEscape } from "./MarkdownEscape";
import { Underline } from "./Underline";
import { cn } from "../../lib/utils";
import { ToolbarButton, Tooltip } from "../ui";
import {
  BoldIcon,
  ItalicIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  SeparatorIcon,
  LinkIcon,
  ImageIcon,
  TableIcon,
  SpinnerIcon,
  CircleCheckIcon,
  RefreshCwIcon,
  SearchIcon,
} from "../icons";

// Standard number-field shortcuts for KaTeX (shared between inline and block math)
const katexMacros: Record<string, string> = {
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
};

// GridPicker component for table insertion
interface GridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}

function GridPicker({ onSelect }: GridPickerProps) {
  const [hovered, setHovered] = useState({ row: 3, col: 3 });

  return (
    <>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 25 }).map((_, i) => {
          const row = Math.floor(i / 5) + 1;
          const col = (i % 5) + 1;
          const isHighlighted = row <= hovered.row && col <= hovered.col;

          return (
            <div
              key={i}
              className={cn(
                "w-5.5 h-5.5 border rounded cursor-pointer transition-colors",
                isHighlighted
                  ? "bg-accent/20 border-accent/50"
                  : "border-border hover:border-accent/50",
              )}
              onMouseEnter={() => setHovered({ row, col })}
              onClick={() => onSelect(row, col)}
            />
          );
        })}
      </div>
      <p className="text-xs text-center mt-2 text-text-muted">
        {hovered.row} × {hovered.col} table
      </p>
    </>
  );
}

interface FormatBarProps {
  editor: TiptapEditor | null;
  onAddLink: () => void;
  onAddImage: () => void;
  onFind: () => void;
}

/**
 * Every editor query the FormatBar renders from, in one place. The Editor
 * re-renders on a selection change only when one of these answers changes;
 * while a contenteditable is focused, each React commit walks its entire DOM
 * subtree to snapshot the selection, which is slow in a long document.
 * Keep this list in sync with the isActive() calls in FormatBar.
 */
function formatBarStateKey(editor: TiptapEditor): string {
  return [
    editor.isActive("bold"),
    editor.isActive("italic"),
    editor.isActive("heading", { level: 1 }),
    editor.isActive("heading", { level: 2 }),
    editor.isActive("heading", { level: 3 }),
    editor.isActive("bulletList"),
    editor.isActive("orderedList"),
    editor.isActive("taskList"),
    editor.isActive("blockquote"),
    editor.isActive("link"),
    editor.isActive("table"),
  ].map((active) => (active ? "1" : "0")).join("");
}

// FormatBar must re-render with parent to reflect editor.isActive() state changes
// (editor instance is mutable, so memo would cause stale active states)
function FormatBar({
  editor,
  onAddLink,
  onAddImage,
  onFind,
}: FormatBarProps) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const { toolbarIconScale } = useTheme();

  if (!editor) return null;

  return (
    <div data-formatting-toolbar data-icon-size={toolbarIconScale} className="h-8 flex items-center gap-1 px-3 border-b border-border overflow-x-auto scrollbar-none">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title={`Bold (${mod}${isMac ? "" : "+"}B)`}
      >
        <BoldIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title={`Italic (${mod}${isMac ? "" : "+"}I)`}
      >
        <ItalicIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title={`Heading 1 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}1)`}
      >
        <Heading1Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title={`Heading 2 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}2)`}
      >
        <Heading2Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title={`Heading 3 (${mod}${isMac ? "" : "+"}${alt}${isMac ? "" : "+"}3)`}
      >
        <Heading3Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title={`Bullet List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}8)`}
      >
        <ListIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title={`Numbered List (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}7)`}
      >
        <ListOrderedIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive("taskList")}
        title="Task List"
      >
        <CheckSquareIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title={`Blockquote (${mod}${isMac ? "" : "+"}${shift}${isMac ? "" : "+"}B)`}
      >
        <QuoteIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        isActive={false}
        title="Horizontal Rule"
      >
        <SeparatorIcon />
      </ToolbarButton>

      <div className="w-px h-4.5 border-l border-border mx-2" />

      <ToolbarButton
        onClick={onAddLink}
        isActive={editor.isActive("link")}
        title={`Add Link (${mod}${isMac ? "" : "+"}K)`}
      >
        <LinkIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <ToolbarButton onClick={onAddImage} isActive={false} title="Add Image">
        <ImageIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
      <DropdownMenu.Root open={tableMenuOpen} onOpenChange={setTableMenuOpen}>
        <Tooltip content="Insert Table">
          <DropdownMenu.Trigger asChild>
            <ToolbarButton isActive={editor.isActive("table")}>
              <TableIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </ToolbarButton>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="p-2.5 bg-bg border border-border rounded-md shadow-lg z-50"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <GridPicker
              onSelect={(rows, cols) => {
                editor
                  .chain()
                  .focus()
                  .insertTable({
                    rows,
                    cols,
                    withHeaderRow: true,
                  })
                  .run();
                setTableMenuOpen(false);
              }}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/* Find, at the far end of the row. In source view, where this row is
          hidden, Ctrl+F opens it. */}
      <ToolbarButton
        onClick={onFind}
        isActive={false}
        title={`Find in document (${mod}${isMac ? "" : "+"}F)`}
        aria-label="Find in document"
        className="ml-auto"
      >
        <SearchIcon className="w-4.5 h-4.5 stroke-[1.5]" />
      </ToolbarButton>
    </div>
  );
}

// Data source for preview mode — bypasses NotesContext
export interface PreviewModeData {
  content: string | null;
  title: string;
  filePath: string;
  modified: number;
  hasExternalChanges: boolean;
  reloadVersion: number;
  save: (content: string) => Promise<void>;
  reload: () => Promise<void>;
  documentPath?: string | null;
  dirty?: boolean;
}

export interface EditorHandle {
  getContent: () => string;
  getSession: () => ViewState;
  command: (action: string) => void;
  /** "Ignore All" in the spelling menu: stop marking this word in this document. */
  ignoreSpelling: (word: string) => void;
}
interface EditorProps {
  previewMode: PreviewModeData;
  active?: boolean;
  initialSession?: ViewState;
  resumeSession?: ViewState;
  onHandleReady?: (handle: EditorHandle) => void;
  onWordCountChange?: (count: number) => void;
  /** Words in the selected text, or null when no text is selected. */
  onSelectedWordCountChange?: (count: number | null) => void;
}

/**
 * Get character offsets where each top-level block starts in markdown.
 * Blocks are separated by blank lines, with awareness of code fences
 * and ATX headings.
 */
function getMarkdownBlockOffsets(md: string): number[] {
  const offsets: number[] = [];
  const lines = md.split("\n");
  let pos = 0;
  let prevBlank = true; // treat doc start as preceded by blank
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (inCodeFence) {
      // Only look for closing fence; don't start new blocks inside code
      if (trimmed.startsWith("```")) {
        inCodeFence = false;
      }
    } else if (trimmed.startsWith("```")) {
      // Opening fence is always a block start
      offsets.push(pos);
      inCodeFence = true;
      prevBlank = false;
    } else {
      const isBlank = trimmed === "";
      // Start a new block after a blank line, or for ATX headings
      if (!isBlank && (prevBlank || trimmed.startsWith("#"))) {
        offsets.push(pos);
      }
      prevBlank = isBlank;
    }

    pos += line.length + 1;
  }

  return offsets;
}

/** ProseMirror position at the start of the Nth top-level block. */
function blockIndexToPos(
  doc: { childCount: number; child: (i: number) => { nodeSize: number } },
  blockIndex: number,
): number {
  const idx = Math.max(0, Math.min(blockIndex, doc.childCount - 1));
  let pos = 1; // 1 for doc opening token
  for (let i = 0; i < idx; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

/** Table commands for the right-click menu when the selection is inside a table. */
function tableContextMenuItems(editor: TiptapEditor): ContextMenuItem[] {
  try {
    const { state } = editor;
    const { $anchor } = state.selection;
    // Find the table cell/header node
    let cellDepth = $anchor.depth;
    while (cellDepth > 0) {
      const name = $anchor.node(cellDepth).type.name;
      if (name === "tableCell" || name === "tableHeader") break;
      cellDepth--;
    }
    if (cellDepth <= 0) return [];
    const cellPos = $anchor.before(cellDepth);
    // Column index within the row and row index within the table
    const rowNode = $anchor.node(cellDepth - 1);
    let cellIndex = 0;
    rowNode.forEach((_node, offset) => {
      if (offset < cellPos - $anchor.before(cellDepth - 1) - 1) cellIndex++;
    });
    const tableNode = $anchor.node(cellDepth - 2);
    let rowIndex = 0;
    tableNode.forEach((_node, offset) => {
      if (offset < $anchor.before(cellDepth - 1) - $anchor.before(cellDepth - 2) - 1) rowIndex++;
    });
    const items: ContextMenuItem[] = [];
    if (cellIndex > 0) items.push({ text: "Add Column Before", action: () => editor.chain().focus().addColumnBefore().run() });
    items.push(
      { text: "Add Column After", action: () => editor.chain().focus().addColumnAfter().run() },
      { text: "Delete Column", action: () => editor.chain().focus().deleteColumn().run() },
      { type: "separator" },
    );
    if (rowIndex > 0) items.push({ text: "Add Row Above", action: () => editor.chain().focus().addRowBefore().run() });
    items.push(
      { text: "Add Row Below", action: () => editor.chain().focus().addRowAfter().run() },
      { text: "Delete Row", action: () => editor.chain().focus().deleteRow().run() },
      { type: "separator" },
      { text: "Toggle Header Row", action: () => editor.chain().focus().toggleHeaderRow().run() },
      { text: "Toggle Header Column", action: () => editor.chain().focus().toggleHeaderColumn().run() },
      { type: "separator" },
      { text: "Delete Table", action: () => editor.chain().focus().deleteTable().run() },
    );
    return items;
  } catch (error) {
    console.error("Table context menu error:", error);
    return [];
  }
}

// Source view: a selection up to this many characters is counted for the
// status bar on the next frame; a longer one after the selection has rested.
const SOURCE_SELECTION_LIVE_LIMIT = 20000;
// Find lists, highlights and steps through at most this many matches. Replace All takes them all.
const MAX_SHOWN_MATCHES = 500;

export function Editor({ previewMode, active = true, initialSession, resumeSession, onHandleReady, onWordCountChange, onSelectedWordCountChange }: EditorProps) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const resumeSessionRef = useRef(resumeSession);
  resumeSessionRef.current = resumeSession;
  const currentNote = previewMode.content !== null ? {
    id: previewMode.filePath, title: previewMode.title, content: previewMode.content,
    path: previewMode.documentPath, modified: previewMode.modified,
  } : null;
  const saveNote = async (content: string, _noteId?: string) => previewMode.save(content);
  const hasExternalChanges = previewMode.hasExternalChanges;
  const reloadCurrentNote = previewMode.reload;
  const reloadVersion = previewMode.reloadVersion;
  const formattedChangedRef = useRef(false);
  const markdownDraftRef = useRef(previewMode.content ?? "");
  const initialSessionRef = useRef(initialSession);
  const pendingSourceSessionRef = useRef<ViewState | null>(null);
  const documentPathRef = useRef(previewMode.documentPath ?? null);
  documentPathRef.current = previewMode.documentPath ?? null;
  const { textDirection, smartTypography } = useTheme();
  // Read by the as-you-type rules on every keystroke, so the Settings toggle
  // applies immediately.
  const smartTypographyRef = useRef(smartTypography);
  smartTypographyRef.current = smartTypography;
  // Source mode state
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceContent, setSourceContent] = useState("");
  // The source textarea gets an explicit direction resolved from its text
  // instead of dir="auto": Chromium re-resolves an auto-directed text control
  // on every value change, which takes seconds for a multi-megabyte source.
  const sourceDirection = useMemo(
    () => (sourceMode && (textDirection as string) === "auto" ? resolveAutoDirection(sourceContent) : textDirection),
    [sourceMode, sourceContent, textDirection],
  );
  const [isSaving, setIsSaving] = useState(false);
  // Force re-render when selection changes to update toolbar active states
  const [, setSelectionKey] = useState(0);
  const formatStateRef = useRef<string | null>(null);
  // Delay transition classes until after initial mount to avoid format bar height animation on note load
  const [hasTransitioned, setHasTransitioned] = useState(false);
  useEffect(() => {
    if (!hasTransitioned && currentNote) {
      const id = requestAnimationFrame(() => setHasTransitioned(true));
      return () => cancelAnimationFrame(id);
    }
  }, [hasTransitioned, currentNote]);

  // Delay format bar / header transitions only when the sidebar needs to animate closed
  const needsSidebarDelay = false;
  const sourceContentRef = useRef(sourceContent);
  sourceContentRef.current = sourceContent;
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;
  const sourceTimeoutRef = useRef<number | null>(null);
  const sourceModeTransitionRef = useRef<{
    topBlockIndex: number;
    cursorBlockIndex: number;
    md?: string;
  } | null>(null);
  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<
    Array<{ from: number; to: number }>
  >([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  // Find lists and shows at most this many matches; whether there are more is shown as "500+".
  const [moreMatches, setMoreMatches] = useState(false);
  const allMatchesRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const linkPopupRef = useRef<TippyInstance | null>(null);
  const blockMathPopupRef = useRef<TippyInstance | null>(null);
  const isLoadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const currentNoteIdRef = useRef<string | null>(null);
  // Track if we need to save (use ref to avoid computing markdown on every keystroke)
  const needsSaveRef = useRef(false);
  // Keep ref in sync with current note ID
  currentNoteIdRef.current = currentNote?.id ?? null;

  // Markdown serialized from the editor, remembered per document version.
  // ProseMirror documents are immutable, so the same doc object always
  // serializes to the same string; the recovery timer, the debounced save,
  // and the source-mode switch can all reuse one serialization.
  const markdownCacheRef = useRef<{ doc: ProseMirrorNode; markdown: string } | null>(null);

  // Get markdown from editor
  const getMarkdown = useCallback(
    (editorInstance: ReturnType<typeof useEditor>) => {
      if (!editorInstance) return "";
      const manager = editorInstance.storage.markdown?.manager;
      if (manager) {
        const doc = editorInstance.state.doc;
        const cached = markdownCacheRef.current;
        if (cached && cached.doc === doc) return cached.markdown;
        // Same output as manager.serialize(editorInstance.getJSON()), but only
        // blocks that changed since the last call are rendered again.
        let markdown = serializeDocumentMarkdown(manager, doc);
        // Clean up nbsp entities that TipTap inserts (especially in table cells)
        markdown = markdown.replace(/&nbsp;|&#160;/g, " ");
        markdownCacheRef.current = { doc, markdown };
        return markdown;
      }
      // Fallback to plain text
      return editorInstance.getText();
    },
    [],
  );

  // The matches for what is in the Find box (see lib/find-text.ts for what
  // counts as a match). At most `limit` are listed: Find shows 500, Replace
  // All asks for all of them. allMatchesRef holds how many there are.
  const findMatches = useCallback(
    (query: string, editorInstance: TiptapEditor | null, limit = MAX_SHOWN_MATCHES) => {
      allMatchesRef.current = 0;
      if (!editorInstance || !query.trim()) return [];
      const pattern = findPattern(query);
      if (!pattern) return [];
      const { matches, total } = sourceModeRef.current
        ? findInText(sourceContentRef.current, pattern, limit)
        : findInDocument(editorInstance.state.doc, pattern, limit);
      allMatchesRef.current = total;
      return matches;
    },
    [],
  );

  // What Replace puts in at a match: the text of the Replace box, converted
  // as if it had been typed there when Smart Typography is on (curly quotes
  // by what stands before them, an em dash, an ellipsis), and never in code.
  // For several matches, ask in ascending order.
  const replacementWriter = useCallback((replaceText: string, editorInstance: TiptapEditor) => {
    if (!smartTypographyRef.current || convertTypography(replaceText).count === 0) return () => replaceText;
    if (sourceModeRef.current) {
      const content = sourceContentRef.current;
      const isProtected = protectedMarkdownPlaces(content);
      return (from: number) => isProtected(from) ? replaceText : convertTypography(replaceText, content.slice(Math.max(0, from - 1), from)).text;
    }
    const doc = editorInstance.state.doc;
    return (from: number) => {
      const $from = doc.resolve(from);
      if ($from.parent.type.spec.code || $from.nodeAfter?.marks.some((mark) => mark.type.spec.code)) return replaceText;
      return convertTypography(replaceText, $from.parent.textBetween(0, $from.parentOffset, undefined, " ").slice(-1)).text;
    };
  }, []);

  // Show Find's matches: highlighted in the formatted view, selected in source view
  const updateSearchHighlights = useCallback(
    (
      matches: Array<{ from: number; to: number }>,
      currentIndex: number,
      editorInstance: TiptapEditor | null,
    ) => {
      if (!editorInstance) return;
      if (sourceModeRef.current) {
        const match = matches[currentIndex];
        const textarea = scrollContainerRef.current?.querySelector('textarea');
        if (match && textarea && activeRef.current) {
          textarea.setSelectionRange(match.from, match.to);
          const top = textareaOffsetTops(textarea, [match.from])[0];
          const padding = parseFloat(getComputedStyle(textarea).paddingTop) || 0;
          textarea.scrollTop = Math.max(0, top + padding - textarea.clientHeight / 2);
        }
        return;
      }

      try {
        const { view } = editorInstance;
        view.dispatch(view.state.tr.setMeta(searchHighlightKey, { matches, current: currentIndex }));

        // Scroll only the document pane, keeping the Find panel and window fixed.
        // The match is taken where it is now: editing since the search may have moved it.
        const match = searchHighlightKey.getState(view.state)?.matches[currentIndex];
        const container = scrollContainerRef.current;
        if (match && container && activeRef.current) {
          const rect = container.getBoundingClientRect();
          const coords = view.coordsAtPos(match.from);
          container.scrollTo({ top: container.scrollTop + coords.top - rect.top - container.clientHeight / 2, behavior: 'smooth' });
        }
      } catch (error) {
        console.error("Failed to update search highlights:", error);
      }
    },
    [],
  );

  // Immediate save function (used for flushing)
  const saveImmediately = useCallback(
    async (noteId: string, content: string) => {
      setIsSaving(true);
      try {
        lastSaveRef.current = { noteId, content };
        await saveNote(content, noteId);
      } finally {
        setIsSaving(false);
      }
    },
    [saveNote],
  );

  // Flush any pending save immediately (saves to the note currently loaded in editor)
  const flushPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    // Use loadedNoteIdRef (the note in the editor) not currentNoteIdRef (which may have changed)
    if (needsSaveRef.current && editorRef.current && loadedNoteIdRef.current) {
      needsSaveRef.current = false;
      const markdown = getMarkdown(editorRef.current);
      await saveImmediately(loadedNoteIdRef.current, markdown);
    }
  }, [saveImmediately, getMarkdown]);

  // Schedule a debounced save (markdown computed only when timer fires)
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const savingNoteId = currentNote?.id;
    if (!savingNoteId) return;

    needsSaveRef.current = true;

    saveTimeoutRef.current = window.setTimeout(async () => {
      if (currentNoteIdRef.current !== savingNoteId || !needsSaveRef.current) {
        return;
      }

      // Compute markdown only now, when we actually save
      if (editorRef.current) {
        needsSaveRef.current = false;
        const markdown = getMarkdown(editorRef.current);
        await saveImmediately(savingNoteId, markdown);
      }
    }, 500);
  }, [saveImmediately, getMarkdown, currentNote?.id]);

  const closeBlockMathPopup = useCallback(() => {
    if (blockMathPopupRef.current) {
      blockMathPopupRef.current.destroy();
      blockMathPopupRef.current = null;
    }
  }, []);

  const handleEditBlockMath = useCallback(
    (pos: number) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      if (linkPopupRef.current) {
        linkPopupRef.current.destroy();
        linkPopupRef.current = null;
      }
      closeBlockMathPopup();

      const node = currentEditor.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "blockMath") {
        return;
      }

      const virtualElement = {
        getBoundingClientRect: () => {
          const nodeDom = currentEditor.view.nodeDOM(pos);
          if (nodeDom instanceof HTMLElement) {
            return nodeDom.getBoundingClientRect();
          }

          const start = currentEditor.view.coordsAtPos(pos);
          const end = currentEditor.view.coordsAtPos(pos + node.nodeSize);
          const left = Math.min(start.left, end.left);
          const top = Math.min(start.top, end.top);
          const right = Math.max(start.right, end.right);
          const bottom = Math.max(start.bottom, end.bottom);

          return {
            width: Math.max(2, right - left),
            height: Math.max(20, bottom - top),
            top,
            left,
            right,
            bottom,
            x: left,
            y: top,
            toJSON: () => ({}),
          } as DOMRect;
        },
      };

      const component = new ReactRenderer(BlockMathEditor, {
        props: {
          initialLatex: String(node.attrs.latex ?? ""),
          onSubmit: (latex: string) => {
            const trimmed = latex.trim();
            if (!trimmed) {
              toast.error("Please enter a formula.");
              return;
            }
            currentEditor
              .chain()
              .focus()
              .updateBlockMath({ pos, latex: trimmed })
              .setTextSelection(pos + node.nodeSize)
              .run();
            closeBlockMathPopup();
          },
          onCancel: () => {
            // Move cursor after the node instead of restoring the NodeSelection,
            // which would re-trigger native DOM selection highlight bleed
            currentEditor
              .chain()
              .focus()
              .setTextSelection(pos + node.nodeSize)
              .run();
            closeBlockMathPopup();
          },
        },
        editor: currentEditor,
      });

      blockMathPopupRef.current = tippy(document.body, {
        getReferenceClientRect: () =>
          virtualElement.getBoundingClientRect() as DOMRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        placement: "bottom-start",
        offset: [0, 8],
        onDestroy: () => {
          component.destroy();
        },
      });
    },
    [closeBlockMathPopup],
  );

  const editor = useEditor({
    textDirection,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        codeBlock: false,
        // The Link below replaces StarterKit's copy. Registering both ran two
        // autolink/paste handlers per edit and a stock click handler whose
        // window.open was always denied by the desktop shell.
        link: false,
        // Replaced by FastOrderedList, which parses large files in linear time.
        orderedList: false,
        // Replaced by ./Underline, which saves <u>…</u> instead of ++…++.
        underline: false,
      }),
      FastOrderedList,
      CodeBlockLowlight.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockView);
        },
        // Same highlighting, but only changed code blocks are re-highlighted
        // and nothing walks the whole document on every keystroke.
        addProseMirrorPlugins() {
          // Keep CodeBlock's own plugins; drop only the stock lowlight plugin.
          const inherited = (this.parent?.() ?? []).filter(
            (plugin) => !String((plugin as unknown as { key?: string }).key).startsWith("lowlight$"),
          );
          return [
            ...inherited,
            IncrementalLowlightPlugin({
              name: this.name,
              lowlight: this.options.lowlight,
              defaultLanguage: this.options.defaultLanguage,
            }),
          ];
        },
      }).configure({
        lowlight,
        defaultLanguage: null,
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "underline cursor-pointer",
        },
      }),
      // Convert markdown link syntax [text](url) into real links when typed
      Extension.create({
        name: "markdownLinkInputRule",
        addInputRules() {
          return [
            new InputRule({
              find: /\[([^\]]+)\]\(([^)]+)\)$/,
              handler: ({ state, range, match, commands }) => {
                const [, text, rawUrl] = match;
                const url = normalizeUrl(rawUrl);
                commands.command(({ tr }) => {
                  const linkMark = state.schema.marks.link.create({
                    href: url,
                  });
                  const textNode = state.schema.text(text, [linkMark]);
                  tr.replaceWith(range.from, range.to, textNode);
                  return true;
                });
              },
            }),
          ];
        },
      }),
      Image.extend({
        renderHTML({ HTMLAttributes }) {
          return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
            src: resolveImageUrl(HTMLAttributes.src || "", documentPathRef.current),
          })];
        },
      }).configure({ inline: false, allowBase64: true }),
      FastTaskList,
      TaskItem.configure({
        nested: true,
      }),
      TableKit.configure({
        table: {
          resizable: false,
          HTMLAttributes: {
            class: "not-prose",
          },
        },
      }),
      Frontmatter,
      Markdown.configure({}),
      MarkdownEscape,
      Underline,
      SearchHighlight,
      QuietRecheck,
      Wikilink,
      SmartTypography.configure({ enabled: () => smartTypographyRef.current }),
      IgnoredSpelling.configure({ words: () => ignoredWords(currentNoteIdRef.current) }),
      ScratchBlockMath.configure({
        katexOptions: {
          throwOnError: false,
          displayMode: true,
          macros: katexMacros,
        },
        onClick: (_node, pos) => {
          handleEditBlockMath(pos);
        },
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-lg dark:prose-invert max-w-3xl mx-auto focus:outline-none min-h-full px-6 pt-8 pb-24",
        spellcheck: "true",
        autocorrect: "on",
        autocapitalize: "sentences",
      },
      // Serialize copied text as markdown instead of plain text. This is the
      // clipboard's plain-text flavour, pasted as it is into other programs,
      // so prose is not backslash-escaped the way it is in files.
      clipboardTextSerializer: (slice) => {
        const fallback = slice.content.textBetween(
          0,
          slice.content.size,
          "\n\n",
        );
        const currentEditor = editorRef.current;
        const manager = currentEditor?.storage.markdown?.manager;
        if (!currentEditor || !manager) return fallback;
        try {
          const doc = currentEditor.schema.topNodeType.create(
            null,
            slice.content,
          );
          return manager.serialize(doc.toJSON());
        } catch {
          return fallback;
        }
      },
      // Trap Tab key inside the editor
      handleKeyDown: (_view, event) => {
        if (event.key === "Tab") {
          // Allow default tab behavior (indent in lists, etc.)
          // but prevent focus from leaving the editor
          return false;
        }
        return false;
      },
      // Pasted or dragged-in text was not typed, so Chromium would check only
      // the words near the cursor; have it check the whole document again.
      handleDrop: (view) => {
        recheckSpelling(view.dom);
        return false;
      },
      // Handle markdown and image paste
      handlePaste: (view, event) => {
        recheckSpelling(view.dom);
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // Check for images first
        const items = Array.from(clipboardData.items);
        const imageItem = items.find((item) => item.type.startsWith("image/"));

        if (imageItem) {
          const blob = imageItem.getAsFile();
          if (blob) {
            // Convert blob to base64 and handle async operations
            const reader = new FileReader();
            reader.onload = () => {
              editorRef.current?.chain().focus().setImage({ src: String(reader.result) }).run();
            };
            reader.onerror = () => {
              console.error("Failed to read clipboard image:", reader.error);
              toast.error("Failed to read clipboard image");
            };
            reader.readAsDataURL(blob);
            return true; // Handled
          }
        }

        // Handle markdown text paste
        const text = clipboardData.getData("text/plain");
        if (!text) return false;

        // Check if text looks like markdown (has common markdown patterns)
        const markdownPatterns =
          /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>\s|```|^\s*\[.*\]\(.*\)|^\s*!\[|\*\*.*\*\*|__.*__|~~.*~~|^\s*[-*_]{3,}\s*$|^\|.+\||\$\$[\s\S]+?\$\$/m;
        if (!markdownPatterns.test(text)) {
          // Not markdown, let TipTap handle it normally
          return false;
        }

        // Parse markdown and insert using editor ref
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;

        const manager = currentEditor.storage.markdown?.manager;
        if (manager && typeof manager.parse === "function") {
          try {
            const parsed = manager.parse(text);
            if (parsed) {
              currentEditor.commands.insertContent(parsed);
              return true;
            }
          } catch {
            // Fall back to default paste behavior
          }
        }

        return false;
      },
    },
    onCreate: ({ editor: editorInstance }) => {
      editorRef.current = editorInstance;
    },
    onUpdate: () => {
      if (isLoadingRef.current) return;
      formattedChangedRef.current = true;
      scheduleSave();
    },
    onSelectionUpdate: ({ editor: editorInstance }) => {
      // Trigger re-render to update toolbar active states, but only when the
      // toolbar would actually look different from what is on screen; a
      // re-render that paints the same toolbar is wasted, and costly while a
      // long document is focused.
      if (formatBarStateKey(editorInstance) === formatStateRef.current) return;
      setSelectionKey((k) => k + 1);
    },
    // Prevent flash of unstyled content during initial render
    immediatelyRender: false,
  });

  // Track which note's content is currently loaded in the editor
  const loadedNoteIdRef = useRef<string | null>(null);
  // Track the modified timestamp of the loaded content
  const loadedModifiedRef = useRef<number | null>(null);
  // Track the last save (note ID and content) to detect our own saves vs external changes
  const lastSaveRef = useRef<{ noteId: string; content: string } | null>(null);
  // Track reloadVersion to detect manual refreshes
  const lastReloadVersionRef = useRef(0);

  // Search navigation functions (defined after editor is created)
  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0 || !editor) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);
    updateSearchHighlights(searchMatches, nextIndex, editor);
  }, [searchMatches, currentMatchIndex, editor, updateSearchHighlights]);

  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0 || !editor) return;
    const prevIndex =
      (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIndex);
    updateSearchHighlights(searchMatches, prevIndex, editor);
  }, [searchMatches, currentMatchIndex, editor, updateSearchHighlights]);

  // Handle search query change
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const replaceCurrent = useCallback((replaceText: string) => {
    if (!editor || !searchQuery.trim()) return;

    // Recompute from current doc state to avoid stale debounced matches.
    const currentMatches = findMatches(searchQuery, editor);
    if (currentMatches.length === 0) return;

    const safeIndex = Math.min(currentMatchIndex, currentMatches.length - 1);
    const match = currentMatches[safeIndex];
    if (!match) return;

    const written = replacementWriter(replaceText, editor)(match.from);
    if (sourceModeRef.current) {
      const content = sourceContentRef.current.slice(0, match.from) + written + sourceContentRef.current.slice(match.to);
      formattedChangedRef.current = false;
      markdownDraftRef.current = content;
      sourceContentRef.current = content;
      setSourceContent(content);
      void saveNote(content);
    } else {
      editor.view.dispatch(editor.state.tr.insertText(written, match.from, match.to));
      // Chromium checks only what it sees typed: have the new text checked.
      recheckSpellingSoon(editor.view.dom);
    }

    const newMatches = findMatches(searchQuery, editor);
    setSearchMatches(newMatches);
    setMoreMatches(allMatchesRef.current > newMatches.length);

    if (newMatches.length > 0) {
      // Move to the first match after the replaced range.
      const nextPos = match.from + written.length;
      const nextIndex = newMatches.findIndex((m) => m.from >= nextPos);
      const resolvedIndex = nextIndex === -1 ? 0 : nextIndex;
      setCurrentMatchIndex(resolvedIndex);
      updateSearchHighlights(newMatches, resolvedIndex, editor);
    } else {
      setCurrentMatchIndex(0);
      updateSearchHighlights([], 0, editor);
    }
  }, [editor, searchQuery, currentMatchIndex, findMatches, replacementWriter, updateSearchHighlights]);

  const replaceAll = useCallback((replaceText: string) => {
    if (!editor || !searchQuery) return;
    // Every match in the document, not only the ones Find shows.
    const currentMatches = findMatches(searchQuery, editor, Infinity);
    if (currentMatches.length === 0) return;
    const write = replacementWriter(replaceText, editor);
    const written = currentMatches.map((match) => write(match.from));

    if (sourceModeRef.current) {
      const source = sourceContentRef.current;
      const parts: string[] = [];
      let copied = 0;
      currentMatches.forEach((match, i) => {
        parts.push(source.slice(copied, match.from), written[i]);
        copied = match.to;
      });
      parts.push(source.slice(copied));
      const content = parts.join("");
      formattedChangedRef.current = false;
      markdownDraftRef.current = content;
      sourceContentRef.current = content;
      setSourceContent(content);
      void saveNote(content);
      setSearchMatches([]);
      setMoreMatches(false);
      return;
    }
    // One change for each paragraph, from the end of the document backward:
    // from its first match to its last, with the text between the matches
    // as it was. (One change for each match takes minutes when there are
    // very many.)
    const { doc, schema, tr } = editor.state;
    for (let last = currentMatches.length - 1; last >= 0;) {
      const paragraphStart = doc.resolve(currentMatches[last].from).start();
      let first = last;
      while (first > 0 && currentMatches[first - 1].from >= paragraphStart) first--;
      let content = Fragment.empty;
      for (let i = first; i <= last; i++) {
        const match = currentMatches[i];
        if (i > first) content = content.append(doc.slice(currentMatches[i - 1].to, match.from).content);
        if (written[i]) content = content.append(Fragment.from(schema.text(written[i], doc.resolve(match.from).marksAcross(doc.resolve(match.to)) ?? Mark.none)));
      }
      tr.replaceWith(currentMatches[first].from, currentMatches[last].to, content);
      last = first - 1;
    }
    editor.view.dispatch(tr);
    recheckSpellingSoon(editor.view.dom);

    const newMatches = findMatches(searchQuery, editor);
    setSearchMatches(newMatches);
    setMoreMatches(allMatchesRef.current > newMatches.length);
    setCurrentMatchIndex(0);
    updateSearchHighlights(newMatches, 0, editor);
  }, [editor, searchQuery, findMatches, replacementWriter, updateSearchHighlights]);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      setMoreMatches(false);
      setCurrentMatchIndex(0);
      // Clear the highlights when search is empty
      if (editor) {
        updateSearchHighlights([], 0, editor);
      }
      return;
    }

    const timer = setTimeout(() => {
      if (!editor) return;
      const matches = findMatches(searchQuery, editor);
      setSearchMatches(matches);
      setMoreMatches(allMatchesRef.current > matches.length);
      setCurrentMatchIndex(0);
      // Always update the highlights (clears old ones when there are no matches)
      updateSearchHighlights(matches, 0, editor);
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery, sourceContent, sourceMode, editor, findMatches, updateSearchHighlights]);

  // Handle clicks on wikilinks and external links
  useEffect(() => {
    if (!editor) return;

    const handleEditorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Prevent links from opening unless Cmd/Ctrl+Click
      const link = target.closest("a");
      if (link) {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && link.href) {
          // Use raw href attribute and normalize to handle protocol-less URLs
          const rawHref = link.getAttribute("href") ?? "";
          const normalizedHref = normalizeUrl(rawHref);
          if (isAllowedUrlScheme(normalizedHref)) {
            openUrl(normalizedHref).catch((error) =>
              console.error("Failed to open link:", error),
            );
          } else {
            toast.error("Cannot open links with this URL scheme");
          }
        }
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener("click", handleEditorClick);

    return () => {
      editorElement.removeEventListener("click", handleEditorClick);
    };
  }, [editor]);

  // Load note content when the current note changes
  useEffect(() => {
    // Skip if no note or editor
    if (!currentNote || !editor) {
      return;
    }

    const isSameNote = currentNote.id === loadedNoteIdRef.current;

    // Detect rename BEFORE flush to prevent stale-ID saves from creating duplicates.
    // When a save renames the file (title changed), the ID changes but we're still
    // editing the same note. Update loadedNoteIdRef first so any flush uses the new ID.
    if (!isSameNote) {
      const lastSave = lastSaveRef.current;
      if (
        lastSave?.noteId === loadedNoteIdRef.current &&
        lastSave?.content === currentNote.content
      ) {
        loadedNoteIdRef.current = currentNote.id;
        loadedModifiedRef.current = currentNote.modified;
        lastSaveRef.current = null;
        // If user typed during the rename, flush with the now-correct ID
        if (needsSaveRef.current) {
          flushPendingSave();
        }
        return;
      }
    }

    // Flush any pending save before switching to a different note
    if (!isSameNote && needsSaveRef.current) {
      flushPendingSave();
    }
    // Reset source mode when genuinely switching notes (renames return early above)
    if (!isSameNote) {
      setSourceMode(false);
      if (sourceTimeoutRef.current) {
        clearTimeout(sourceTimeoutRef.current);
        sourceTimeoutRef.current = null;
      }
    }
    // Check if this is a manual reload (user clicked Refresh button or pressed Cmd+R)
    const isManualReload = reloadVersion !== lastReloadVersionRef.current;

    if (isSameNote) {
      if (isManualReload) {
        // Manual reload - update the editor content
        lastReloadVersionRef.current = reloadVersion;
        loadedModifiedRef.current = currentNote.modified;
        isLoadingRef.current = true;
        formattedChangedRef.current = false;
        markdownDraftRef.current = currentNote.content;
        const manager = editor.storage.markdown?.manager;
        if (manager) {
          try {
            const parsed = manager.parse(currentNote.content);
            editor.commands.setContent(parsed);
          } catch {
            editor.commands.setContent(currentNote.content);
          }
        } else {
          editor.commands.setContent(currentNote.content);
        }
        isLoadingRef.current = false;
        return;
      }
      // Just a save - update refs but don't reload content
      loadedModifiedRef.current = currentNote.modified;
      return;
    }

    const isNewNote = loadedNoteIdRef.current === null;
    const wasEmpty = !isNewNote && currentNote.content?.trim() === "";
    const loadingNoteId = currentNote.id;

    loadedNoteIdRef.current = loadingNoteId;
    loadedModifiedRef.current = currentNote.modified;

    isLoadingRef.current = true;
    formattedChangedRef.current = false;
    markdownDraftRef.current = currentNote.content;

    // Blur editor before setting content to prevent ghost cursor
    editor.commands.blur();

    // Parse markdown and set content. Putting a document's text into its
    // editor is not an edit: it stays out of the undo history. (Through
    // 1.3.2 it was the first step of that history, so one Undo too many
    // took the whole text out again, and a save then wrote an empty file.)
    const load = (content: Parameters<typeof editor.commands.setContent>[0]) =>
      editor.chain().setMeta("addToHistory", false).setContent(content).run();
    const manager = editor.storage.markdown?.manager;
    if (manager) {
      try {
        const parsed = manager.parse(currentNote.content);
        load(parsed);
      } catch {
        // Fallback to plain text if parsing fails
        load(currentNote.content);
      }
    } else {
      load(currentNote.content);
    }

    // Capture note ID to check in RAF callback - prevents race condition
    // if user switches notes quickly before RAF fires
    requestAnimationFrame(() => {
      // Bail if a different note started loading
      if (loadedNoteIdRef.current !== loadingNoteId) {
        return;
      }

      // Scroll to top after content is set. This runs before the first paint
      // of the new document, so doing it only here (rather than also right
      // after setContent) avoids forcing a second full layout of a large
      // document without changing what the user sees.
      scrollContainerRef.current?.scrollTo(0, 0);

      isLoadingRef.current = false;

      // For brand new empty notes, focus and select all so user can start typing
      // Skip if the note list has focus (e.g. keyboard navigation with arrow keys)
      if ((isNewNote || wasEmpty) && currentNote.content.trim() === "") {
        const noteListFocused =
          document.activeElement?.closest("[data-note-list]");
        if (!noteListFocused && activeRef.current) {
          editor.commands.focus("start");
          editor.commands.selectAll();
        }
      }
      // Restore the writing position only after Markdown has been parsed.
      const session = initialSessionRef.current;
      initialSessionRef.current = undefined;
      if (session?.sourceMode) {
        pendingSourceSessionRef.current = session;
        setSourceContent(currentNote.content);
        setSourceMode(true);
      } else if (session) {
        const limit = editor.state.doc.content.size;
        const anchor = Math.min(Math.max(session.selection?.anchor ?? 1, 0), limit);
        const head = Math.min(Math.max(session.selection?.head ?? anchor, 0), limit);
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
        if (activeRef.current) editor.view.dom.focus({ preventScroll: true });
        requestAnimationFrame(() => scrollContainerRef.current?.scrollTo(0, session.scrollTop ?? 0));
      }
    });
  }, [
    currentNote,
    editor,
    flushPendingSave,
    reloadVersion,
  ]);

  // Scroll to top on mount (e.g., when returning from settings)
  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, []);

  // Cleanup on unmount - flush pending saves
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (sourceTimeoutRef.current) clearTimeout(sourceTimeoutRef.current);
      // Flush any pending save before unmounting
      if (needsSaveRef.current && editorRef.current) {
        needsSaveRef.current = false;
        // Fire and forget - save will complete in background
        saveNote(getMarkdown(editorRef.current));
      }
      if (linkPopupRef.current) {
        linkPopupRef.current.destroy();
      }
      if (blockMathPopupRef.current) {
        blockMathPopupRef.current.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run cleanup on unmount, not when saveNote changes

  // Link handlers - show inline popup at cursor position
  const handleAddLink = useCallback(() => {
    if (!editor) return;

    // Close block math popup if open (popups are mutually exclusive)
    closeBlockMathPopup();

    // Destroy existing popup if any
    if (linkPopupRef.current) {
      linkPopupRef.current.destroy();
      linkPopupRef.current = null;
    }

    // Get existing link URL if cursor is on a link
    const existingUrl = editor.getAttributes("link").href || "";

    // Get selection bounds for popup placement using DOM Range for accurate multi-line support
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    // Create a virtual element at the selection for tippy to anchor to
    const virtualElement = {
      getBoundingClientRect: () => {
        // For selections with text, use DOM Range for accurate bounds
        if (hasSelection) {
          const startPos = editor.view.domAtPos(from);
          const endPos = editor.view.domAtPos(to);

          if (startPos && endPos) {
            try {
              const range = document.createRange();
              range.setStart(startPos.node, startPos.offset);
              range.setEnd(endPos.node, endPos.offset);
              return range.getBoundingClientRect();
            } catch (e) {
              // Fallback if range creation fails
              console.error("Range creation failed:", e);
            }
          }
        }

        // For collapsed cursor, use coordsAtPos with proper viewport positioning
        const coords = editor.view.coordsAtPos(from);

        // Create a DOMRect-like object with proper positioning
        return {
          width: 2,
          height: 20,
          top: coords.top,
          left: coords.left,
          right: coords.right,
          bottom: coords.bottom,
          x: coords.left,
          y: coords.top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    };

    // Create the link editor component
    const component = new ReactRenderer(LinkEditor, {
      props: {
        initialUrl: existingUrl,
        // Only show text input if there's no selection AND not editing an existing link
        initialText: hasSelection || existingUrl ? undefined : "",
        onSubmit: (url: string, text?: string) => {
          const normalizedUrl = normalizeUrl(url);
          if (normalizedUrl) {
            if (text !== undefined) {
              // No selection case - insert new link with text
              if (text.trim()) {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: text.trim(),
                    marks: [{ type: "link", attrs: { href: normalizedUrl } }],
                  })
                  .run();
              }
            } else {
              // Has selection - apply link to selection
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: normalizedUrl })
                .run();
            }
          } else {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          }
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
        onRemove: () => {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
        onCancel: () => {
          editor.commands.focus();
          linkPopupRef.current?.destroy();
          linkPopupRef.current = null;
        },
      },
      editor,
    });

    // Create tippy popup
    linkPopupRef.current = tippy(document.body, {
      getReferenceClientRect: () =>
        virtualElement.getBoundingClientRect() as DOMRect,
      appendTo: () => document.body,
      content: component.element,
      showOnCreate: true,
      interactive: true,
      trigger: "manual",
      placement: "bottom-start",
      offset: [0, 8],
      onDestroy: () => {
        component.destroy();
      },
    });
  }, [editor, closeBlockMathPopup]);

  // Image handler
  const handleAddImage = useCallback(async () => {
    if (!editor) return;
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
        },
      ],
    });
    if (selected) {
      try {
        const src = await invoke<string>("read_image", { path: selected });
        editor.chain().focus().setImage({ src }).run();
      } catch (error) {
        console.error("Failed to add image:", error);
      }
    }
  }, [editor]);

  // Keyboard shortcut for Cmd+K to add link (only when editor is focused)
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Only handle if we're in the editor
        const target = e.target as HTMLElement;
        const isInEditor = target.closest(".ProseMirror");
        if (isInEditor && editor) {
          e.preventDefault();
          handleAddLink();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleAddLink, editor, active]);


  // Open and focus editor search (supports repeated Cmd/Ctrl+F)
  const openEditorSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  // Cmd/Ctrl+F to open search, ⌥⌘F (macOS) / Ctrl+H to open replace
  // (works when document/editor area is focused)
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const openFind =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "f";
      // Cmd+H is reserved by macOS (Hide), so replace uses the platform
      // convention: ⌥⌘F on macOS, Ctrl+H elsewhere. e.code is checked on
      // macOS because ⌥ changes e.key to a special character ("ƒ").
      const openReplace = isMac
        ? e.metaKey && e.altKey && !e.shiftKey && e.code === "KeyF"
        : e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h";
      if (openFind || openReplace) {
        if (!currentNote || !editor) return;

        const target = e.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();

        // Don't intercept if user is in an input/textarea (except the editor itself or search toolbar)
        if (
          (tagName === "input" || tagName === "textarea") &&
          !target.closest(".ProseMirror") &&
          !target.closest("[data-editor-scroll]") &&
          !target.closest(".search-toolbar-container")
        ) {
          return;
        }

        // Don't intercept if in sidebar
        if (target.closest('[class*="sidebar"]')) {
          return;
        }

        // Open search for the editor
        e.preventDefault();
        if (openReplace) {
          setIsReplaceOpen(true);
        }
        openEditorSearch();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor, currentNote, openEditorSearch, active]);

  // Clear search on note switch
  useEffect(() => {
    if (currentNote?.id) {
      setSearchOpen(false);
      setSearchQuery("");
      setReplaceQuery("");
      setIsReplaceOpen(false);
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      // Clear the highlights
      if (editor) {
        updateSearchHighlights([], 0, editor);
      }
    }
  }, [currentNote?.id, editor, updateSearchHighlights]);


  // Toggle source mode — computes anchor data and toggles state;
  // focus/scroll restoration happens in the useLayoutEffect below.
  const toggleSourceMode = useCallback(() => {
    if (!editor) return;
    const container = scrollContainerRef.current;

    if (!sourceMode) {
      // === Entering source mode (TipTap → textarea) ===
      const md = formattedChangedRef.current ? getMarkdown(editor) : markdownDraftRef.current;
      markdownDraftRef.current = md;
      formattedChangedRef.current = false;
      if (saveTimeoutRef.current) { clearTimeout(saveTimeoutRef.current); saveTimeoutRef.current = null; }
      needsSaveRef.current = false;
      void saveNote(md);

      // Find which top-level block is at the viewport top
      let topBlockIndex = 0;
      if (container) {
        const rect = container.getBoundingClientRect();
        try {
          const topPos = editor.view.posAtCoords({
            left: rect.left + rect.width / 2,
            top: rect.top + 10,
          });
          if (topPos) {
            const resolved = editor.state.doc.resolve(
              Math.min(topPos.pos, editor.state.doc.content.size),
            );
            topBlockIndex = resolved.index(0);
          }
        } catch {
          // posAtCoords can fail at edges
        }
      }

      // Find which block the cursor is in
      let cursorBlockIndex = 0;
      try {
        const { from } = editor.state.selection;
        const resolved = editor.state.doc.resolve(
          Math.min(from, editor.state.doc.content.size),
        );
        cursorBlockIndex = resolved.index(0);
      } catch {
        // resolve can fail at edges
      }

      sourceModeTransitionRef.current = { topBlockIndex, cursorBlockIndex, md };
      setSourceContent(md);
      setSourceMode(true);
    } else {
      // === Exiting source mode (textarea → TipTap) ===
      const textarea = container?.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;

      // Find which block is at the top of the textarea and which has the cursor.
      // Block offsets (and therefore their measured tops) increase with the
      // block index, so a binary search finds the same block as a full scan
      // while measuring only a handful of offsets instead of every block.
      let topBlockIndex = 0;
      let cursorBlockIndex = 0;
      if (textarea) {
        const blockOffsets = getMarkdownBlockOffsets(sourceContent);
        const { scrollTop, selectionStart } = textarea;
        cursorBlockIndex = lastIndexWhere(blockOffsets.length, (i) => blockOffsets[i] <= selectionStart);
        if (scrollTop > 0 && blockOffsets.length) {
          const measurer = createTextareaMeasurer(textarea);
          try {
            topBlockIndex = lastIndexWhere(blockOffsets.length, (i) => measurer.top(blockOffsets[i]) <= scrollTop);
          } finally {
            measurer.dispose();
          }
        }
      }

      sourceModeTransitionRef.current = { topBlockIndex, cursorBlockIndex };

      markdownDraftRef.current = sourceContentRef.current;
      formattedChangedRef.current = false;
      if (sourceTimeoutRef.current) { clearTimeout(sourceTimeoutRef.current); sourceTimeoutRef.current = null; }
      void saveNote(sourceContentRef.current);
      // Parse and set content
      isLoadingRef.current = true;
      const manager = editor.storage.markdown?.manager;
      if (manager) {
        try {
          const parsed = manager.parse(sourceContent);
          editor.commands.setContent(parsed);
        } catch {
          editor.commands.setContent(sourceContent);
        }
      } else {
        editor.commands.setContent(sourceContent);
      }
      isLoadingRef.current = false;
      // Text edited in the source view (which is not spell-checked) is new
      // to the formatted view: check the whole document for spelling.
      recheckSpelling(editor.view.dom);
      setSourceMode(false);
    }
  }, [editor, sourceMode, sourceContent, getMarkdown, currentNote?.content]);

  // Restore focus and scroll position after source mode transitions.
  // useLayoutEffect runs synchronously after React commits DOM changes,
  // guaranteeing the new textarea / EditorContent is mounted.
  useLayoutEffect(() => {
    let rafId: number | undefined;
    const transition = sourceModeTransitionRef.current;
    if (!transition) {
      return () => {};
    }
    sourceModeTransitionRef.current = null;

    const container = scrollContainerRef.current;

    if (sourceMode) {
      // Just entered source mode — focus textarea and scroll to anchor block
      const textarea = container?.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      if (!textarea) return () => {};

      const md = transition.md || "";

      // Place cursor at the start of the same block in markdown
      const blockOffsets = getMarkdownBlockOffsets(md);
      const cursorPos =
        transition.cursorBlockIndex < blockOffsets.length
          ? blockOffsets[transition.cursorBlockIndex]
          : md.length;
      textarea.setSelectionRange(cursorPos, cursorPos);
      textarea.focus();

      if (transition.topBlockIndex < blockOffsets.length) {
        const charOffset = blockOffsets[transition.topBlockIndex];
        // Offset 0 is the first line, whose top is 0 by definition; skip the
        // mirror layout of the whole source for that common case.
        textarea.scrollTop = charOffset === 0 ? 0 : textareaOffsetTops(textarea, [charOffset])[0];
      }
    } else if (editor) {
      // Just exited source mode — focus editor and scroll to anchor block.
      // Use rAF because EditorContent reattaches the ProseMirror view in
      // its own useEffect, which hasn't run yet during useLayoutEffect.
      rafId = requestAnimationFrame(() => {
        if (!editor.view?.dom?.isConnected) return;
        const doc = editor.state.doc;
        editor.commands.focus(
          blockIndexToPos(doc, transition.cursorBlockIndex),
        );

        // Scroll to anchor block
        const el = scrollContainerRef.current;
        if (el) {
          try {
            el.scrollTop = 0;
            const coords = editor.view.coordsAtPos(
              blockIndexToPos(doc, transition.topBlockIndex),
            );
            const containerRect = el.getBoundingClientRect();
            el.scrollTop = coords.top - containerRect.top;
          } catch {
            // coordsAtPos can fail if view isn't fully rendered
          }
        }
      });
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [sourceMode, editor]);

  // Listen for toggle-source-mode custom event (from App.tsx shortcut / command palette)
  useEffect(() => {
    if (!active) return;
    const handler = () => toggleSourceMode();
    window.addEventListener("toggle-source-mode", handler);
    return () => window.removeEventListener("toggle-source-mode", handler);
  }, [toggleSourceMode, active]);

  // Auto-save in source mode with debounce
  const handleSourceChange = useCallback(
    (value: string) => {
      formattedChangedRef.current = false;
      markdownDraftRef.current = value;
      sourceContentRef.current = value;
      setSourceContent(value);
      if (sourceTimeoutRef.current) {
        clearTimeout(sourceTimeoutRef.current);
      }
      sourceTimeoutRef.current = window.setTimeout(async () => {
        if (currentNote) {
          setIsSaving(true);
          try {
            lastSaveRef.current = { noteId: currentNote.id, content: value };
            await saveNote(value, currentNote.id);
          } catch (error) {
            console.error("Failed to save note:", error);
            toast.error("Failed to save note");
          } finally {
            setIsSaving(false);
          }
        }
      }, 300);
    },
    [currentNote, saveNote],
  );

  // Source view typing: after a single character lands, apply the smart
  // typography replacement through execCommand so it stays in the native
  // undo history (Ctrl+Z restores the typed characters). The replacement
  // fires a nested input event that delivers the final text to
  // handleSourceChange, so the outer event must not report the stale value.
  const handleSourceInput = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const native = event.nativeEvent as InputEvent;
    if (
      smartTypographyRef.current &&
      native.inputType === "insertText" &&
      typeof native.data === "string" &&
      native.data.length === 1 &&
      textarea.selectionStart === textarea.selectionEnd
    ) {
      const caret = textarea.selectionStart;
      const replacement = keystrokeReplacement(textarea.value, caret);
      if (replacement && !insideProtectedMarkdown(textarea.value, caret)) {
        textarea.setSelectionRange(replacement.from, replacement.to);
        if (document.execCommand("insertText", false, replacement.text)) return;
        textarea.setRangeText(replacement.text, replacement.from, replacement.to, "end");
      }
    }
    handleSourceChange(textarea.value);
  }, [handleSourceChange]);

  // Edit > Apply Smart Typography: convert the whole document in one undo step.
  const applySmartTypography = useCallback(() => {
    if (!editor) return;
    const report = (count: number) => {
      if (count === 0) toast.info("Nothing to convert: no straight quotes, double hyphens, or three-period ellipses found.");
      else toast.success(`Smart typography: ${count.toLocaleString()} ${count === 1 ? "change" : "changes"}.`);
    };
    if (sourceModeRef.current) {
      const textarea = scrollContainerRef.current?.querySelector("textarea");
      const { text, count } = convertMarkdownTypography(sourceContentRef.current);
      if (count === 0 || !textarea) { report(count); return; }
      const caret = Math.min(textarea.selectionStart, text.length);
      textarea.focus({ preventScroll: true });
      textarea.select();
      if (!document.execCommand("insertText", false, text)) {
        textarea.setRangeText(text, 0, textarea.value.length, "end");
        handleSourceChange(text);
      }
      textarea.setSelectionRange(caret, caret);
      report(count);
      return;
    }
    const { doc, schema } = editor.state;
    const changes: Array<{ from: number; to: number; text: string; marks: readonly import("@tiptap/pm/model").Mark[] }> = [];
    let count = 0;
    doc.descendants((node, pos) => {
      if (node.type.spec.code) return false;
      if (!node.isText || !node.text) return true;
      if (node.marks.some((mark) => mark.type.spec.code)) return true;
      const $pos = doc.resolve(pos);
      const previous = $pos.parent.textBetween(0, $pos.parentOffset, undefined, " ").slice(-1);
      const converted = convertTypography(node.text, previous);
      if (converted.count > 0) {
        changes.push({ from: pos, to: pos + node.nodeSize, text: converted.text, marks: node.marks });
        count += converted.count;
      }
      return true;
    });
    if (count === 0) { report(0); return; }
    // Its own undo step, even right after another edit.
    const tr = closeHistory(editor.state.tr);
    for (let i = changes.length - 1; i >= 0; i--) {
      const change = changes[i];
      tr.replaceWith(change.from, change.to, schema.text(change.text, change.marks));
    }
    editor.view.dispatch(tr);
    // A text that changed in several places has lost the red lines in between.
    recheckSpellingQuietly(editor.view.dom);
    report(count);
  }, [editor, handleSourceChange]);

  useLayoutEffect(() => {
    const session = pendingSourceSessionRef.current;
    if (!sourceMode || !session) return;
    const textarea = scrollContainerRef.current?.querySelector("textarea");
    if (!textarea) return;
    pendingSourceSessionRef.current = null;
    if (activeRef.current) textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(session.sourceSelection?.start ?? 0, session.sourceSelection?.end ?? 0, session.sourceSelection?.direction ?? 'none');
    textarea.scrollTop = session.sourceScrollTop ?? 0;
    textarea.scrollLeft = session.sourceScrollLeft ?? 0;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = session.scrollTop ?? 0;
  }, [sourceMode, editor]);

  useEffect(() => {
    if (!active || !editor) return;
    const frame = requestAnimationFrame(() => {
      if (!activeRef.current) return;
      const session = resumeSessionRef.current;
      const textarea = scrollContainerRef.current?.querySelector('textarea');
      if (textarea) {
        textarea.focus({ preventScroll: true });
        if (session?.sourceSelection) textarea.setSelectionRange(session.sourceSelection.start, session.sourceSelection.end, session.sourceSelection.direction);
        textarea.scrollTop = session?.sourceScrollTop ?? textarea.scrollTop;
        textarea.scrollLeft = session?.sourceScrollLeft ?? textarea.scrollLeft;
      } else editor.view.dom.focus({ preventScroll: true });
      if (scrollContainerRef.current && session?.scrollTop !== undefined) scrollContainerRef.current.scrollTop = session.scrollTop;
      if (searchInputRef.current) searchInputRef.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, editor]);

  useEffect(() => {
    if (!editor || !currentNote) return;
    onHandleReady?.({
      getContent: () => sourceModeRef.current ? sourceContentRef.current : formattedChangedRef.current ? getMarkdown(editor) : markdownDraftRef.current,
      getSession: () => {
        if (!activeRef.current) return resumeSessionRef.current ?? {};
        const textarea = scrollContainerRef.current?.querySelector("textarea");
        return {
          sourceMode: sourceModeRef.current,
          selection: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
          sourceSelection: textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection } : undefined,
          scrollTop: scrollContainerRef.current?.scrollTop ?? 0,
          sourceScrollTop: textarea?.scrollTop ?? 0,
          sourceScrollLeft: textarea?.scrollLeft ?? 0,
        };
      },
      ignoreSpelling: (word) => {
        // The words stay with the document (not with this editor), so they
        // survive Revert and a visit to the Markdown source view.
        const words = ignoreWord(currentNote.id, word);
        editor.view.dispatch(editor.state.tr.setMeta(ignoredSpellingKey, { words }));
      },
      command: (action) => {
        if (action === 'source') toggleSourceMode();
        else if (action === 'smart-typography') applySmartTypography();
        // The dictionary changed (Settings > Clear Custom Dictionary).
        else if (action === 'recheck-spelling') recheckSpelling(editor.view.dom);
        else if (action === 'find' || action === 'replace') {
          if (action === 'replace') setIsReplaceOpen(true);
          openEditorSearch();
        } else if (action === 'undo' || action === 'redo') {
          const textarea = scrollContainerRef.current?.querySelector('textarea');
          if (sourceMode && textarea) { textarea.focus({ preventScroll: true }); void invoke('clipboard_action', { action }); }
          else editor.chain().focus()[action]().run();
        } else if (action === 'bold' || action === 'italic') {
          // Right-click menu. In the formatted view the mark is toggled; in the
          // source view the selection is wrapped in Markdown markers (through
          // execCommand, so Ctrl+Z undoes it), with the caret left inside.
          const textarea = scrollContainerRef.current?.querySelector('textarea');
          if (sourceMode && textarea) {
            const marker = action === 'bold' ? '**' : '*';
            const start = textarea.selectionStart, end = textarea.selectionEnd;
            const selected = textarea.value.slice(start, end);
            textarea.focus({ preventScroll: true });
            if (!document.execCommand('insertText', false, `${marker}${selected}${marker}`)) {
              textarea.setRangeText(`${marker}${selected}${marker}`, start, end, 'end');
              handleSourceChange(textarea.value);
            }
            textarea.setSelectionRange(start + marker.length, start + marker.length + selected.length);
          } else if (action === 'bold') editor.chain().focus().toggleBold().run();
          else editor.chain().focus().toggleItalic().run();
        }
      },
    });
  }, [editor, currentNote, sourceMode, sourceContent, onHandleReady, getMarkdown, toggleSourceMode, openEditorSearch, applySmartTypography, handleSourceChange]);

  // Source view: the count needs a full Markdown parse (so formatting markers
  // and link targets are excluded exactly as in the formatted view), which is
  // too slow to repeat on every keystroke in a large file. It runs shortly
  // after typing pauses instead. The formatted view counts incrementally and
  // stays synchronous.
  const sourceWordCountTimerRef = useRef<number | null>(null);
  const cancelSourceWordCount = useCallback(() => {
    if (sourceWordCountTimerRef.current !== null) {
      clearTimeout(sourceWordCountTimerRef.current);
      sourceWordCountTimerRef.current = null;
    }
  }, []);
  // Words in Markdown source, counted as the formatted view counts them. The
  // last result for the whole source and for the selection are kept, so that
  // selecting everything (or the same text again) does not parse a second time.
  const sourceWordCacheRef = useRef<{ total?: { source: string; count: number }; selection?: { source: string; count: number } }>({});
  const cachedMarkdownWords = useCallback((source: string) => {
    const cache = sourceWordCacheRef.current;
    if (cache.total?.source === source) return cache.total.count;
    if (cache.selection?.source === source) return cache.selection.count;
    return undefined;
  }, []);
  const countMarkdownWords = useCallback((source: string, kind: 'total' | 'selection') => {
    const cached = cachedMarkdownWords(source);
    if (cached !== undefined) return cached;
    let count: number;
    try {
      const manager = editor?.storage.markdown?.manager;
      if (!editor || !manager) throw new Error('Markdown parser is unavailable.');
      count = countDocumentWords(editor.schema.nodeFromJSON(manager.parse(source)));
    } catch {
      count = countWords(source);
    }
    sourceWordCacheRef.current[kind] = { source, count };
    return count;
  }, [editor, cachedMarkdownWords]);
  const reportWordCount = useCallback(() => {
    if (!editor || !onWordCountChange) return;
    cancelSourceWordCount();
    if (!sourceModeRef.current) {
      onWordCountChange(countDocumentWords(editor.state.doc));
      return;
    }
    const source = sourceContentRef.current;
    sourceWordCountTimerRef.current = window.setTimeout(() => {
      sourceWordCountTimerRef.current = null;
      if (!sourceModeRef.current || sourceContentRef.current !== source) return;
      onWordCountChange(countMarkdownWords(source, 'total'));
    }, 300);
  }, [editor, onWordCountChange, cancelSourceWordCount, countMarkdownWords]);
  useEffect(() => {
    if (!editor) return;
    editor.on('update', reportWordCount);
    return () => { editor.off('update', reportWordCount); };
  }, [editor, reportWordCount]);
  useEffect(() => { reportWordCount(); return cancelSourceWordCount; }, [reportWordCount, cancelSourceWordCount, sourceMode, sourceContent]);

  // Status bar "x of n words": the words in the selection. The count goes to
  // the status bar directly, never through React state: a selection changes
  // many times a second while it is dragged, and every React update re-reads
  // the caret by walking the focused document (see onSelectionUpdate above).
  const selectedWordsFrameRef = useRef<number | null>(null);
  const cancelSelectedWordsFrame = useCallback(() => {
    if (selectedWordsFrameRef.current !== null) {
      cancelAnimationFrame(selectedWordsFrameRef.current);
      selectedWordsFrameRef.current = null;
    }
  }, []);
  // Formatted view. Blocks inside the selection use their cached counts.
  const reportSelectedWords = useCallback(() => {
    cancelSelectedWordsFrame();
    if (!editor || !onSelectedWordCountChange || sourceModeRef.current) return;
    const { doc, selection } = editor.state;
    onSelectedWordCountChange(selection.empty ? null : countSelectedWords(doc, selection.ranges));
  }, [editor, onSelectedWordCountChange, cancelSelectedWordsFrame]);
  useEffect(() => {
    if (!editor || !onSelectedWordCountChange) return;
    const changed = () => {
      if (sourceModeRef.current) return;
      // No selection, as while typing: nothing to count.
      if (editor.state.selection.empty) { reportSelectedWords(); return; }
      // At most one count per frame, however fast the selection moves.
      if (selectedWordsFrameRef.current === null) selectedWordsFrameRef.current = requestAnimationFrame(reportSelectedWords);
    };
    editor.on('transaction', changed);
    return () => { editor.off('transaction', changed); cancelSelectedWordsFrame(); };
  }, [editor, onSelectedWordCountChange, reportSelectedWords, cancelSelectedWordsFrame]);
  // Each view has its own selection: report again after switching views.
  useEffect(() => { if (!sourceMode) reportSelectedWords(); }, [sourceMode, reportSelectedWords]);
  // Source view: the selection is the textarea's. The selected Markdown is
  // parsed like the whole source, so markers and link addresses are not
  // counted and selecting everything gives the document's count. A short
  // selection (or one already counted, such as everything) is counted on the
  // next frame; a long one, which takes longer to parse, once the selection
  // has stopped changing.
  useEffect(() => {
    if (!sourceMode || !editor || !onSelectedWordCountChange) return;
    const textarea = scrollContainerRef.current?.querySelector('textarea');
    if (!textarea) return;
    let frame: number | null = null;
    let timer: number | null = null;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    };
    const report = () => {
      frame = null;
      timer = null;
      const { selectionStart, selectionEnd } = textarea;
      onSelectedWordCountChange(selectionStart === selectionEnd ? null : countMarkdownWords(textarea.value.slice(selectionStart, selectionEnd), 'selection'));
    };
    const changed = () => {
      cancel();
      const { selectionStart, selectionEnd } = textarea;
      const length = selectionEnd - selectionStart;
      if (length === 0) onSelectedWordCountChange(null);
      else if (length <= SOURCE_SELECTION_LIVE_LIMIT || cachedMarkdownWords(textarea.value.slice(selectionStart, selectionEnd)) !== undefined) frame = requestAnimationFrame(report);
      else timer = window.setTimeout(report, 300);
    };
    // Chromium reports selection changes inside a text box through
    // "selectionchange" (which bubbles to the document) and "select".
    document.addEventListener('selectionchange', changed);
    textarea.addEventListener('select', changed);
    changed();
    return () => {
      document.removeEventListener('selectionchange', changed);
      textarea.removeEventListener('select', changed);
      cancel();
    };
  }, [sourceMode, sourceContent, editor, onSelectedWordCountChange, countMarkdownWords, cachedMarkdownWords]);
  useEffect(() => { if (!sourceMode) sourceWordCacheRef.current = {}; }, [sourceMode]);
  // A closed or reloaded editor has no selection.
  useEffect(() => () => { onSelectedWordCountChange?.(null); }, [onSelectedWordCountChange]);

  if (!currentNote) return <div className="flex-1 flex items-center justify-center"><SpinnerIcon className="w-6 h-6 animate-spin" /></div>;

  // What the FormatBar is about to show; selection updates compare against it.
  formatStateRef.current = editor ? formatBarStateKey(editor) : null;

  return (
    <div className="flex-1 flex flex-col bg-bg overflow-hidden">
      {/* Compact menus and document controls, directly above the formatting icons. */}
      <div
        data-editor-header
        className="h-8 shrink-0 flex items-center gap-px px-3"
      >
        <ApplicationMenu active={active} />
        {hasExternalChanges ? (
          <Tooltip content="External changes detected; revert to the saved file">
            <button
              onClick={reloadCurrentNote}
              className="h-7 px-2 flex items-center gap-1 text-xs text-text-muted hover:bg-bg-emphasis rounded transition-colors font-medium"
            >
              <RefreshCwIcon className="w-4 h-4 stroke-[1.6]" />
              <span>Refresh</span>
            </button>
          </Tooltip>
        ) : isSaving ? (
          <Tooltip content="Saving...">
            <div role="status" aria-label="Saving" className="h-7 w-7 flex items-center justify-center">
              <SpinnerIcon className="w-4.5 h-4.5 text-text-muted/40 stroke-[1.5] animate-spin" />
            </div>
          </Tooltip>
        ) : (
          <Tooltip content={previewMode.dirty ? "Unsaved changes (Ctrl+S to save)" : "All changes saved"}>
            <div role="status" aria-label={previewMode.dirty ? "Unsaved changes" : "All changes saved"} className="h-7 w-7 flex items-center justify-center rounded-full">
              {previewMode.dirty ? <span className="w-2 h-2 rounded-full bg-text-muted" /> : <CircleCheckIcon className="w-4.5 h-4.5 mt-px stroke-[1.5] text-text-muted/40" />}
            </div>
          </Tooltip>
        )}
      </div>

      {/* Format Bar – transition only after initial mount to avoid height animation on note load */}
      <div
        data-format-bar
        className={`${sourceMode ? "opacity-0 max-h-0 overflow-hidden pointer-events-none" : "opacity-100 max-h-20"} ${hasTransitioned ? `transition-all duration-400 ${needsSidebarDelay ? "delay-200" : ""}` : ""}`}
      >
        <FormatBar
          editor={editor}
          onAddLink={handleAddLink}
          onAddImage={handleAddImage}
          onFind={openEditorSearch}
        />
      </div>

      {/* Editor content area with resize handles overlay */}
      <div data-editor-content-area className="flex-1 relative overflow-hidden">
        {!sourceMode && (
          <EditorWidthHandles containerRef={scrollContainerRef} />
        )}
        {searchOpen && (
          <div className="absolute top-2 right-2 z-20 pointer-events-none flex justify-end">
            <div className="pointer-events-auto">
              <SearchToolbar
                inputRef={searchInputRef}
                query={searchQuery}
                onChange={handleSearchChange}
                onNext={goToNextMatch}
                onPrevious={goToPreviousMatch}
                onClose={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                  setReplaceQuery("");
                  setIsReplaceOpen(false);
                  setSearchMatches([]);
                  setCurrentMatchIndex(0);
                  // Clear the highlights and refocus editor
                  if (editor) {
                    updateSearchHighlights([], 0, editor);
                    if (sourceModeRef.current) scrollContainerRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
                    else editor.commands.focus();
                  }
                }}
                currentMatch={
                  searchMatches.length === 0 ? 0 : currentMatchIndex + 1
                }
                totalMatches={searchMatches.length}
                moreMatches={moreMatches}
                replaceQuery={replaceQuery}
                onReplaceChange={setReplaceQuery}
                onReplace={() => replaceCurrent(replaceQuery)}
                onReplaceAll={() => replaceAll(replaceQuery)}
                isReplaceOpen={isReplaceOpen}
                onToggleReplace={() => setIsReplaceOpen(!isReplaceOpen)}
              />
            </div>
          </div>
        )}
        <div
          data-editor-scroll
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden"
          dir={textDirection}
        >
          {sourceMode && (
            /* Markdown source textarea */
            <div className="h-full">
              <textarea
                value={sourceContent}
                onChange={handleSourceInput}
                aria-label="Markdown source"
                onContextMenu={() => showContextMenu()}
                wrap="soft"
                dir={sourceDirection}
                className="w-full h-full bg-transparent text-text focus:outline-none resize-none px-6 pt-8 pb-24 mx-auto block"
                style={{
                  maxWidth: "var(--editor-max-width, 48rem)",
                  fontFamily:
                    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Courier New', monospace",
                  fontSize: "var(--editor-source-font-size)",
                  lineHeight: "var(--editor-line-height)",
                  tabSize: 2,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  overflowX: 'hidden',
                }}
                spellCheck={false}
              />
            </div>
          )}
          {/* The formatted editor stays mounted (hidden) while the source view
              is open. Unmounting it made TipTap redraw the whole document
              twice per round trip, which took seconds on large files. */}
          <div
            className="h-full"
            hidden={sourceMode}
            onContextMenu={(e) => {
              // Do not prevent the default: the desktop shell shows the menu from
              // the browser's own context-menu request, which carries the
              // spelling suggestions. The items are registered synchronously.
              if (!editor) return;
              const clickPos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
              if (!clickPos) return;
              // Set the selection to the clicked position
              if (editor.state.selection.empty) editor.chain().focus().setTextSelection(clickPos.pos).run();
              else editor.view.dom.focus({ preventScroll: true });
              showContextMenu(editor.isActive("table") ? tableContextMenuItems(editor) : []);
            }}
          >
            <EditorContent editor={editor} className="h-full text-text" />
          </div>
        </div>
      </div>
    </div>
  );
}
