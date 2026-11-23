import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";

const segments = new Intl.Segmenter(undefined, { granularity: 'word' });

export function countWords(text: string): number {
  let count = 0;
  for (const segment of segments.segment(text)) {
    if (segment.isWordLike) count++;
  }
  return count;
}

// Word counts of top-level blocks, keyed by the immutable ProseMirror node.
// An edit replaces only the nodes on the path to the change, so every other
// block keeps its identity and its cached count.
const blockWordCounts = new WeakMap<ProseMirrorNode, number>();

function countBlockWords(block: ProseMirrorNode): number {
  let count = blockWordCounts.get(block);
  if (count === undefined) {
    count = countWords(block.textBetween(0, block.content.size, '\n', '\n'));
    blockWordCounts.set(block, count);
  }
  return count;
}

/**
 * Count the words of a document the same way as
 * `countWords(doc.textBetween(0, doc.content.size, '\n', '\n'))`, but
 * incrementally: only blocks that changed since the last call are re-counted.
 *
 * Counting block by block gives the same total because `textBetween` separates
 * blocks with a newline, and a newline is always a word boundary.
 */
export function countDocumentWords(doc: ProseMirrorNode): number {
  let total = 0;
  doc.forEach((block) => {
    total += countBlockWords(block);
  });
  return total;
}

/** One range of a selection, as ProseMirror's `selection.ranges` gives it. */
export interface SelectedRange {
  readonly $from: ResolvedPos;
  readonly $to: ResolvedPos;
}

function containsText(node: ProseMirrorNode, from: number, to: number): boolean {
  if (to <= from) return false;
  let found = false;
  node.nodesBetween(from, to, (child) => {
    if (child.isText) found = true;
    return !found;
  });
  return found;
}

/**
 * Count the words inside a selection, for the status bar's "x of n words".
 *
 * Returns the same number as
 * `countWords(doc.textBetween(from, to, '\n', '\n'))` summed over the ranges,
 * so selecting a whole document gives `countDocumentWords(doc)`. A word that
 * is only partly selected counts as a word. Blocks whose text lies completely
 * inside a range use their cached count, so a long selection costs one lookup
 * per block; only a block cut by an end of the range is counted afresh.
 *
 * Returns null when no text is selected: the selection is empty, or it holds
 * only things without text, such as an image, a horizontal rule, or empty
 * lines. Selected text without words (spaces, punctuation) gives 0.
 */
export function countSelectedWords(doc: ProseMirrorNode, ranges: readonly SelectedRange[]): number | null {
  let words = 0;
  let text = false;
  for (const { $from, $to } of ranges) {
    const from = $from.pos;
    const to = $to.pos;
    if (to <= from) continue;
    // Walk the top-level blocks from the one that holds (or follows) `from`.
    let index = $from.index(0);
    let start = $from.before(1);
    while (start < to && index < doc.childCount) {
      const block = doc.child(index);
      const end = start + block.nodeSize;
      let count: number;
      // The part of the block's content inside the range, in the block's own positions.
      let inside: [number, number] | null = null;
      // All of the block's content is selected (with or without the block itself).
      if (from <= start + 1 && to >= end - 1) {
        count = countBlockWords(block);
        if (count === 0 && !text) inside = [0, block.content.size];
      } else {
        inside = [Math.max(from - start - 1, 0), Math.min(to - start - 1, block.content.size)];
        count = countWords(block.textBetween(inside[0], inside[1], '\n', '\n'));
      }
      words += count;
      if (!text) text = count > 0 || (inside !== null && containsText(block, inside[0], inside[1]));
      start = end;
      index++;
    }
  }
  return text ? words : null;
}

/** The status bar text: "1,234 words", or "56 of 1,234 words" while text is selected. */
export function wordCountLabel(total: number, selected: number | null): string {
  const words = `${total.toLocaleString()} ${total === 1 ? 'word' : 'words'}`;
  return selected === null ? words : `${selected.toLocaleString()} of ${words}`;
}
