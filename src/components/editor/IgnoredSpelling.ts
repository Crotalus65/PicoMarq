import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { findIgnoredRanges, ignoredForms, NO_IGNORED_FORMS, type IgnoredForms } from "../../lib/ignored-spelling";
import { cancelSpellingRecheck, keepCaretOutOfIgnoredWords, postponeSpellingRecheck, recheckSpelling, recheckSpellingSoon } from "../../lib/spelling";

/**
 * "Ignore All" for the spelling checker, in the formatted view.
 *
 * Chromium has no way to ignore a word short of adding it to the dictionary.
 * It does leave a word unmarked when the word starts inside an element that
 * has spell checking switched off, so the first letter of every occurrence
 * of an ignored word is wrapped (as a decoration, not as document content)
 * in <span spellcheck="false">. Nothing is saved with the document, and the
 * Markdown is untouched.
 *
 * Only the first letter, because Chromium runs its background checks only
 * while the caret is at a place where spell checking is on: with the whole
 * word wrapped, they would stop whenever the caret rests inside an ignored
 * word or at its end, which is where it is right after the word is typed.
 * With one letter wrapped, the caret can only be "inside" the wrapper at its
 * two edges, and there the selection is rewritten to name the same place
 * from outside (keepCaretOutOfIgnoredWords in lib/spelling.ts).
 *
 * The catch: when a wrapper appears or disappears, or text is typed against
 * one, ProseMirror rewrites the text nodes beside it, and Chromium drops
 * every spelling underline in a text node that is rewritten. Chromium puts
 * them back by itself only when the change was typed and the paragraph is
 * short (it then rechecks the paragraph). In every other case the editor
 * asks for a full recheck (lib/spelling.ts): at once after Ignore All, and
 * once editing has paused after anything else.
 */

export const ignoredSpellingKey = new PluginKey<IgnoredSpellingState>("ignoredSpelling");

export interface IgnoredSpellingOptions {
  /** The words already ignored in this document when the editor is created. */
  words: () => ReadonlySet<string>;
}

interface IgnoredSpellingState {
  words: ReadonlySet<string>;
  forms: IgnoredForms;
  decorations: DecorationSet;
  /** Raised by every change that may have cost other words their underlines. */
  revision: number;
  cause: "ignore" | "edit";
  /** The longest text block involved in that change, in characters. */
  longestBlock: number;
}

// Chromium rechecks a paragraph of up to 1,024 characters around typed text;
// in a longer one only the part near the cursor.
const SELF_HEALING_BLOCK = 900;
// Above this many changed blocks (new content, a large paste) start afresh.
const REBUILD_ABOVE = 50;

const ATTRIBUTES = { spellcheck: "false", "data-ignored-spelling": "" };
const COMBINING_MARK = /\p{M}/u;

/** The text of a block, one character per document position inside it. */
function blockText(block: ProseMirrorNode): string {
  let text = "";
  block.forEach((child) => { text += child.isText ? child.text : "￼".repeat(child.nodeSize); });
  return text;
}

/** The first letter of each ignored word in a block (with its combining marks): what gets wrapped. */
function wrapperRanges(block: ProseMirrorNode, pos: number, forms: IgnoredForms): Array<[number, number]> {
  const text = blockText(block);
  return findIgnoredRanges(text, forms).map(([from, to]) => {
    let end = from + ((text.codePointAt(from) ?? 0) > 0xFFFF ? 2 : 1);
    while (end < to && COMBINING_MARK.test(text.charAt(end))) end++;
    return [pos + 1 + from, pos + 1 + Math.min(end, to)];
  });
}

function buildAll(doc: ProseMirrorNode, forms: IgnoredForms): DecorationSet {
  if (forms === NO_IGNORED_FORMS) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const [from, to] of wrapperRanges(node, pos, forms)) decorations.push(Decoration.inline(from, to, ATTRIBUTES));
    return false;
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/** The ranges of the new document that a transaction changed. */
function changedRanges(tr: Transaction): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => { ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]); });
  });
  return ranges;
}

function updateForEdit(tr: Transaction, state: IgnoredSpellingState): IgnoredSpellingState {
  const doc = tr.doc;
  const ranges = changedRanges(tr);
  let decorations = state.decorations.map(tr.mapping, doc);
  // The text blocks that the changes reach, including the ones next to a
  // change (blocks that were joined or split).
  const blocks = new Map<number, ProseMirrorNode>();
  for (const [from, to] of ranges) {
    doc.nodesBetween(Math.max(0, from - 1), Math.min(doc.content.size, to + 1), (node, pos) => {
      if (blocks.size > REBUILD_ABOVE) return false;
      if (!node.isTextblock) return true;
      blocks.set(pos, node);
      return false;
    });
    if (blocks.size > REBUILD_ABOVE) break;
  }
  if (blocks.size > REBUILD_ABOVE) {
    const rebuilt = buildAll(doc, state.forms);
    if (rebuilt === DecorationSet.empty && state.decorations === DecorationSet.empty) return state;
    return { ...state, decorations: rebuilt, revision: state.revision + 1, cause: "edit", longestBlock: Infinity };
  }
  let disturbed = false;
  let longestBlock = 0;
  for (const [pos, block] of blocks) {
    const end = pos + block.nodeSize;
    const existing = decorations.find(pos, end).sort((a, b) => a.from - b.from);
    const fresh = wrapperRanges(block, pos, state.forms);
    const same = existing.length === fresh.length && existing.every((decoration, index) => decoration.from === fresh[index][0] && decoration.to === fresh[index][1]);
    if (!same) decorations = decorations.remove(existing).add(doc, fresh.map(([from, to]) => Decoration.inline(from, to, ATTRIBUTES)));
    // A wrapper appeared or went, or the edit is right beside one: the text
    // nodes next to it are rewritten.
    if (!same || ranges.some(([from, to]) => existing.some(decoration => decoration.from <= to + 1 && decoration.to >= from - 1))) {
      disturbed = true;
      longestBlock = Math.max(longestBlock, block.content.size);
    }
  }
  if (disturbed) return { ...state, decorations, revision: state.revision + 1, cause: "edit", longestBlock };
  return decorations === state.decorations ? state : { ...state, decorations };
}

export const IgnoredSpelling = Extension.create<IgnoredSpellingOptions>({
  name: "ignoredSpelling",

  addOptions() {
    return { words: () => new Set<string>() };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<IgnoredSpellingState>({
        key: ignoredSpellingKey,
        state: {
          init: (_config, editorState) => {
            const words = options.words();
            const forms = ignoredForms(words);
            return { words, forms, decorations: buildAll(editorState.doc, forms), revision: 0, cause: "edit", longestBlock: 0 };
          },
          apply: (tr, state, _oldState, newState) => {
            const meta = tr.getMeta(ignoredSpellingKey) as { words?: ReadonlySet<string> } | undefined;
            if (meta?.words && meta.words !== state.words) {
              const forms = ignoredForms(meta.words);
              return { words: meta.words, forms, decorations: buildAll(newState.doc, forms), revision: state.revision + 1, cause: "ignore", longestBlock: 0 };
            }
            // Nothing is ignored in most documents: no work at all.
            if (!tr.docChanged || state.words.size === 0) return state;
            return updateForEdit(tr, state);
          },
        },
        props: {
          decorations: (editorState) => ignoredSpellingKey.getState(editorState)?.decorations,
        },
        view: (editorView: EditorView) => {
          // True while the browser itself is applying typed input: from its
          // "beforeinput" event until the end of that task, which includes
          // ProseMirror reading the change.
          let typed = false;
          const typing = () => {
            typed = true;
            window.setTimeout(() => { typed = false; }, 0);
          };
          editorView.dom.addEventListener("beforeinput", typing, true);
          // Wherever the selection goes while words are ignored, it must not
          // end inside a wrapper.
          const caretMoved = () => {
            if (ignoredSpellingKey.getState(editorView.state)?.decorations !== DecorationSet.empty) keepCaretOutOfIgnoredWords(editorView.dom);
          };
          document.addEventListener("selectionchange", caretMoved);
          return {
            update: (view, previousState) => {
              const previous = ignoredSpellingKey.getState(previousState);
              const current = ignoredSpellingKey.getState(view.state);
              if (!previous || !current) return;
              // ProseMirror has just put the selection back in its own way.
              caretMoved();
              if (current.revision === previous.revision) {
                // Still editing: a recheck that is waiting keeps waiting.
                if (view.state.doc !== previousState.doc) postponeSpellingRecheck(view.dom);
                return;
              }
              if (current.cause === "ignore") recheckSpelling(view.dom);
              // Typed into a short paragraph: Chromium rechecks it by itself.
              else if (!typed || current.longestBlock > SELF_HEALING_BLOCK) recheckSpellingSoon(view.dom);
              else postponeSpellingRecheck(view.dom);
            },
            destroy: () => {
              editorView.dom.removeEventListener("beforeinput", typing, true);
              document.removeEventListener("selectionchange", caretMoved);
              cancelSpellingRecheck(editorView.dom);
            },
          };
        },
      }),
    ];
  },
});
