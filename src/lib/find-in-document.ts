import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Found } from "./find-text";

// Find in the formatted view.
//
// A paragraph is searched as one text, whatever its formatting: a phrase is
// found although one of its words is italic or a link. (Through 1.3.2 each
// stretch of the same formatting was searched by itself.) Things in a line
// that are not text, a line break for one, stand in the text as a character
// nobody types, so a match never runs across them.

const NOT_TEXT = "￼";

/**
 * The matches in a document, as document positions, in order. At most
 * `limit` of them are listed; all of them are counted.
 */
export function findInDocument(doc: ProseMirrorNode, pattern: RegExp, limit = Infinity): { matches: Found[]; total: number } {
  const matches: Found[] = [];
  let total = 0;
  doc.descendants((block, blockPosition) => {
    if (!block.isTextblock) return true;
    // The paragraph's text, and where each stretch of it starts: in the text and in the document.
    let text = "";
    const inText: number[] = [];
    const inDocument: number[] = [];
    block.descendants((node, position) => {
      if (!node.isText && !node.isLeaf) return true;
      inText.push(text.length);
      inDocument.push(blockPosition + 1 + position);
      text += node.isText ? node.text : NOT_TEXT;
      return false;
    });
    if (!text) return false;
    let stretch = 0;
    const position = (offset: number) => {
      while (stretch + 1 < inText.length && inText[stretch + 1] <= offset) stretch++;
      return inDocument[stretch] + offset - inText[stretch];
    };
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(text));) {
      if (match[0].length === 0) { pattern.lastIndex++; continue; }
      total++;
      if (matches.length >= limit) continue;
      const from = position(match.index);
      matches.push({ from, to: position(match.index + match[0].length - 1) + 1 });
    }
    return false;
  });
  return { matches, total };
}
