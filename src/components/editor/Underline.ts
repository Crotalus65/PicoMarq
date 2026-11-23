import { Underline as BaseUnderline } from "@tiptap/extension-underline";

/**
 * Underline, saved as `<u>…</u>`.
 *
 * Markdown has no underline syntax. The stock extension writes `++text++`,
 * which only this editor's toolkit reads; inline HTML is the form every
 * Markdown program understands (and the form other programs write, which
 * the stock extension already reads). `++text++` in files saved by earlier
 * builds is still read.
 *
 * TipTap wraps marks with the lowest-priority one outermost, so a priority
 * above every other mark's (Link uses 1000) makes underline the innermost:
 * bold, italic, strikethrough and links wrap the `<u>` rather than sitting
 * inside it, where their Markdown would be read as plain text.
 */
export const Underline = BaseUnderline.extend({
  priority: 1001,
  renderMarkdown: (node, helpers) => `<u>${helpers.renderChildren(node)}</u>`,
});
