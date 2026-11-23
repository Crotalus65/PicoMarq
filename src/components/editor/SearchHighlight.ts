import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { moveSearchMatches, NO_SEARCH_MATCHES, showSearchMatches, type SearchMatch, type SearchMatches } from "../../lib/search-matches";

/**
 * Find's highlights in the formatted view.
 *
 * They are painted with the CSS Custom Highlight API: ranges of text are
 * registered under two names, and the two ::highlight() rules below color
 * them. Nothing in the document's DOM changes.
 *
 * Through 1.3.1 the matches were ProseMirror decorations. A decoration wraps
 * its text in a <span>, ProseMirror rewrites the text nodes around it, and
 * Chromium drops every spelling underline in a text node that is rewritten:
 * Find took the red lines from each paragraph with a match, and they did not
 * come back.
 */

export const searchHighlightKey = new PluginKey<SearchMatches>("searchHighlight");

const MATCH = "search-match";
const CURRENT = "search-match-active";

// The colors: the selection color, lighter for the matches Find is not on.
// The rules are added here and not in App.css because the stylesheet
// optimizer of the build does not know ::highlight() and warns about it.
const colors = new CSSStyleSheet();
colors.replaceSync(`
  ::highlight(${MATCH}) { background-color: color-mix(in srgb, var(--color-selection), transparent 50%); }
  ::highlight(${CURRENT}) { background-color: var(--color-selection); }
`);
document.adoptedStyleSheets.push(colors);

/** The window's highlight of that name. Every editor in the window adds its own ranges to it. */
function highlight(name: string): Highlight {
  let registered = CSS.highlights.get(name);
  if (!registered) {
    registered = new Highlight();
    // Where matches overlap, the current one shows.
    if (name === CURRENT) registered.priority = 1;
    CSS.highlights.set(name, registered);
  }
  return registered;
}

interface Painted {
  readonly range: Range;
  /** What the range read when it was made. */
  readonly text: string;
  name: string;
}

function rangeOf(view: EditorView, match: SearchMatch): Range | null {
  try {
    const start = view.domAtPos(match.from, 1);
    const end = view.domAtPos(match.to, -1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range.collapsed ? null : range;
  } catch {
    // A place that is not in the document: nothing to paint there.
    return null;
  }
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchMatches>({
        key: searchHighlightKey,
        state: {
          init: () => NO_SEARCH_MATCHES,
          apply: (tr, shown) => {
            const meta = tr.getMeta(searchHighlightKey) as { matches: readonly SearchMatch[]; current: number } | undefined;
            if (meta) return showSearchMatches(shown, meta.matches, meta.current);
            if (!tr.docChanged || shown.matches.length === 0) return shown;
            return moveSearchMatches(shown, (position, bias) => tr.mapping.map(position, bias));
          },
        },
        view: (editorView: EditorView) => {
          let found = NO_SEARCH_MATCHES.found;
          let painted: (Painted | null)[] = [];
          const unpaint = (entry: Painted | null) => {
            if (entry) highlight(entry.name).delete(entry.range);
          };
          const paint = (view: EditorView) => {
            const shown = searchHighlightKey.getState(view.state) ?? NO_SEARCH_MATCHES;
            if (shown.found !== found) {
              painted.forEach(unpaint);
              painted = [];
              found = shown.found;
            }
            painted = shown.matches.map((match, index) => {
              const name = index === shown.current ? CURRENT : MATCH;
              let entry = painted[index] ?? null;
              // A range follows its text through typing by itself. Where
              // ProseMirror has redrawn the text, the range has collapsed or
              // reads something else, and is made again.
              if (entry && (!match || entry.range.toString() !== entry.text)) {
                unpaint(entry);
                entry = null;
              }
              if (!entry) {
                const range = match && rangeOf(view, match);
                if (!range) return null;
                entry = { range, text: range.toString(), name };
                highlight(name).add(range);
              } else if (entry.name !== name) {
                unpaint(entry);
                entry.name = name;
                highlight(name).add(entry.range);
              }
              return entry;
            });
          };
          paint(editorView);
          return {
            update: paint,
            destroy: () => {
              painted.forEach(unpaint);
              painted = [];
            },
          };
        },
      }),
    ];
  },
});
