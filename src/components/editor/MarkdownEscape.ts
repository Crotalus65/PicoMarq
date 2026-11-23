import { Extension, type MarkdownToken } from "@tiptap/core";

/**
 * Keeps backslash-escaped characters when Markdown is opened.
 *
 * marked turns `\$`, `\*`, `\[`, `1986\.` and so on into `escape` tokens, but
 * TipTap's Markdown extension registers no handler for them, so the escaped
 * character silently vanished from the formatted view (and from the file on
 * the next save). Files written by Pandoc, Typora and most other tools lean
 * on these escapes. This handler turns each one back into its character.
 */
export const MarkdownEscape = Extension.create({
  name: "markdownEscape",
  markdownTokenName: "escape",
  parseMarkdown: (token: MarkdownToken, helpers) =>
    helpers.createTextNode(token.text ?? ""),
});
