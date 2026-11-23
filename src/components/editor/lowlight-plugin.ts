import { findChildren } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import highlight from "highlight.js/lib/core";

/**
 * Incremental replacement for the plugin in @tiptap/extension-code-block-lowlight.
 *
 * The stock plugin scans the whole document twice on every transaction
 * (including plain cursor moves) to find code blocks, and re-highlights every
 * code block in the document whenever one of them is edited. This version
 * produces the same decorations but only touches blocks that actually
 * changed, so typing cost no longer grows with document size.
 */

interface HighlightNode {
  type?: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HighlightNode[];
}

interface LowlightLike {
  highlight: (language: string, value: string) => { value?: HighlightNode[]; children?: HighlightNode[] };
  highlightAuto: (value: string) => { value?: HighlightNode[]; children?: HighlightNode[] };
  listLanguages: () => string[];
  registered?: (aliasOrLanguage: string) => boolean;
}

export interface IncrementalLowlightOptions {
  name: string;
  lowlight: LowlightLike;
  defaultLanguage: string | null | undefined;
}

// The next three helpers mirror the ones in @tiptap/extension-code-block-lowlight
// so the generated class names are identical.
function parseNodes(nodes: HighlightNode[], className: string[] = []): { text: string; classes: string[] }[] {
  return nodes.flatMap((node) => {
    const classes = [...className, ...(node.properties ? node.properties.className ?? [] : [])];
    if (node.children) return parseNodes(node.children, classes);
    return { text: node.value ?? "", classes };
  });
}

function getHighlightNodes(result: { value?: HighlightNode[]; children?: HighlightNode[] }): HighlightNode[] {
  return result.value || result.children || [];
}

function registered(aliasOrLanguage: string): boolean {
  return Boolean(highlight.getLanguage(aliasOrLanguage));
}

function blockDecorations(
  block: ProseMirrorNode,
  pos: number,
  { lowlight, defaultLanguage }: IncrementalLowlightOptions,
): Decoration[] {
  const decorations: Decoration[] = [];
  let from = pos + 1;
  const language = block.attrs.language || defaultLanguage;
  const languages = lowlight.listLanguages();
  const nodes =
    language && (languages.includes(language) || registered(language) || lowlight.registered?.(language))
      ? getHighlightNodes(lowlight.highlight(language, block.textContent))
      : getHighlightNodes(lowlight.highlightAuto(block.textContent));
  parseNodes(nodes).forEach((node) => {
    const to = from + node.text.length;
    if (node.classes.length) {
      decorations.push(Decoration.inline(from, to, { class: node.classes.join(" ") }));
    }
    from = to;
  });
  return decorations;
}

function allDecorations(doc: ProseMirrorNode, options: IncrementalLowlightOptions): DecorationSet {
  const decorations: Decoration[] = [];
  findChildren(doc, (node) => node.type.name === options.name).forEach((block) => {
    decorations.push(...blockDecorations(block.node, block.pos, options));
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Call `f` for every node in `cur` that is not identical (same object) to
 * the corresponding node in `old`. Parents are reported before children.
 * ProseMirror nodes are immutable and shared across versions, so unchanged
 * subtrees are skipped in O(1).
 */
function changedDescendants(
  old: ProseMirrorNode,
  cur: ProseMirrorNode,
  offset: number,
  f: (node: ProseMirrorNode, pos: number) => void,
): void {
  const oldSize = old.childCount;
  const curSize = cur.childCount;
  outer: for (let i = 0, j = 0; i < curSize; i++) {
    const child = cur.child(i);
    for (let scan = j, e = Math.min(oldSize, i + 3); scan < e; scan++) {
      if (old.child(scan) === child) {
        j = scan + 1;
        offset += child.nodeSize;
        continue outer;
      }
    }
    f(child, offset);
    if (j < oldSize && old.child(j).sameMarkup(child)) {
      changedDescendants(old.child(j), child, offset + 1, f);
    } else {
      child.nodesBetween(0, child.content.size, f, offset + 1);
    }
    offset += child.nodeSize;
  }
}

export const incrementalLowlightKey = new PluginKey<DecorationSet>("lowlight");

export function IncrementalLowlightPlugin(options: IncrementalLowlightOptions): Plugin<DecorationSet> {
  const { lowlight } = options;
  if (!["highlight", "highlightAuto", "listLanguages"].every((api) => typeof (lowlight as unknown as Record<string, unknown>)[api] === "function")) {
    throw Error("You should provide an instance of lowlight to use the code-block-lowlight extension");
  }
  const plugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    key: incrementalLowlightKey,
    state: {
      init: (_, { doc }) => allDecorations(doc, options),
      apply: (transaction: Transaction, decorationSet: DecorationSet, oldState: EditorState, newState: EditorState) => {
        if (!transaction.docChanged) return decorationSet;
        let set = decorationSet.map(transaction.mapping, transaction.doc);
        changedDescendants(oldState.doc, newState.doc, 0, (node, pos) => {
          // Highlight decorations only ever live inside textblocks, and an
          // unchanged code block nested in a changed container keeps its
          // identity (and its mapped decorations), so containers are skipped.
          if (!node.isTextblock) return;
          const end = pos + node.nodeSize;
          // Drop every mapped decoration touching a changed textblock: a code
          // block may have been edited or turned into a paragraph, and a
          // decoration mapped across a split now straddles two blocks. Fresh
          // decorations never cross block boundaries, so anything overlapping
          // the block is stale. Then highlight it afresh when it is a code block.
          const stale = set.find(pos, end);
          if (stale.length) set = set.remove(stale);
          if (node.type.name === options.name) {
            const fresh = blockDecorations(node, pos, options);
            if (fresh.length) set = set.add(transaction.doc, fresh);
          }
        });
        return set;
      },
    },
    props: {
      decorations(state) {
        return plugin.getState(state);
      },
    },
  });
  return plugin;
}
