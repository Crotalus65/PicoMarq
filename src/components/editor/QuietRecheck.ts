import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { createSpellingFiller, recheckSpellingQuietly } from "../../lib/spelling";

/**
 * Red lines after changes that are not typed.
 *
 * Typing goes into the page's text directly, and Chromium keeps its spelling
 * marks around it. Formatting a word, Undo and Redo, splitting or joining
 * paragraphs and the like make ProseMirror build pieces of the paragraph
 * anew, and new text has no marks. Chromium rechecks only around the caret
 * (a whole paragraph of up to 1,024 characters, otherwise 512 characters
 * either side), so in a long paragraph the red lines farther away were gone
 * until the next whole-document check.
 *
 * This extension asks for that check, the quiet one of lib/spelling.ts,
 * after every such change. It also keeps the invisible filler that the quiet
 * check works with at the end of the editor element.
 */

const key = new PluginKey("quietRecheck");

/** Plain typing and deleting inside one paragraph leave the marks alone; everything else may not. */
function rebuildsText(transaction: Transaction): boolean {
  if (!transaction.docChanged) return false;
  if (transaction.getMeta("history$")) return true;
  return transaction.steps.some((step, index) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
    if (!(step instanceof ReplaceStep)) return true;
    const { from, to, slice } = step;
    if (slice.openStart > 0 || slice.openEnd > 0) return true;
    let blocks = false;
    slice.content.forEach((node) => { if (!node.isInline) blocks = true; });
    if (blocks) return true;
    const before = transaction.docs[index];
    const start = before.resolve(from);
    return !start.parent.isTextblock || !start.sameParent(before.resolve(to));
  });
}

export const QuietRecheck = Extension.create({
  name: "quietRecheck",

  addProseMirrorPlugins() {
    let shown: EditorView | null = null;
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, [
              Decoration.widget(state.doc.content.size, createSpellingFiller, { side: 1, key: "spelling-filler", ignoreSelection: true }),
            ]);
          },
        },
        view(view) {
          shown = view;
          return { destroy() { if (shown === view) shown = null; } };
        },
        appendTransaction(transactions) {
          if (shown && transactions.some(rebuildsText)) recheckSpellingQuietly(shown.dom);
          return null;
        },
      }),
    ];
  },
});
