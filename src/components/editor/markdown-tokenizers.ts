import { OrderedList, TaskList } from "@tiptap/extension-list";
import type { MarkdownTokenizer } from "@tiptap/core";

/**
 * Faster drop-in replacements for the ordered-list and task-list Markdown
 * tokenizers shipped with TipTap.
 *
 * marked calls every block-level extension tokenizer at the start of every
 * block, handing it the whole remaining document. TipTap's list tokenizers
 * answer by splitting that entire remainder into lines before checking
 * whether it even starts with a list item. On a document with thousands of
 * blocks that is thousands of full-document splits: quadratic time, and the
 * dominant cost when opening a large file.
 *
 * These wrappers keep the original tokenizers (so the resulting tokens are
 * byte-for-byte identical) but
 *   1. return early, without splitting anything, when the block cannot start
 *      a list, and
 *   2. otherwise pass only the prefix of the source the original tokenizer
 *      can possibly consume or inspect.
 *
 * Both originals stop scanning at the first non-blank line that has no
 * leading whitespace and is not a list item (an unindented line can never be
 * a continuation of an item), and their look-ahead never reads past the next
 * non-blank line. Cutting the source just after that line therefore cannot
 * change what they return.
 */

type Tokenizer = MarkdownTokenizer;

// Mirrors ORDERED_LIST_ITEM_REGEX in @tiptap/extension-list (ordered-list/utils.ts).
const ORDERED_ITEM = /^(\s*)(\d+)\.\s+(.*)$/;
// Mirrors the task item pattern in @tiptap/extension-list (task-list/task-list.ts).
const TASK_ITEM = /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/;
const INDENTED = /^\s/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * Return the part of `src` a list tokenizer can see, or null when `src`
 * cannot start a list at all. `skipLeadingBlank` reflects whether the
 * original tokenizer tolerates blank lines before the first item.
 */
export function listSourcePrefix(
  src: string,
  isItem: (line: string) => boolean,
  skipLeadingBlank: boolean,
): string | null {
  let start = 0;
  let first = true;
  while (start < src.length) {
    let end = src.indexOf("\n", start);
    if (end === -1) end = src.length;
    const line = src.slice(start, end);
    if (first) {
      if (isBlank(line)) {
        if (!skipLeadingBlank) return null;
      } else if (!isItem(line)) {
        return null;
      } else {
        first = false;
      }
    } else if (!isBlank(line) && !INDENTED.test(line) && !isItem(line)) {
      // The terminating line itself is kept so the original tokenizer
      // stops exactly where it would have stopped on the full source.
      return src.slice(0, end);
    }
    start = end + 1;
  }
  return first ? null : src;
}

function bounded(original: Tokenizer, isItem: (line: string) => boolean, skipLeadingBlank: boolean): Tokenizer {
  return {
    ...original,
    tokenize: (src, tokens, lexer) => {
      const prefix = listSourcePrefix(src, isItem, skipLeadingBlank);
      if (prefix === null) return undefined;
      return original.tokenize(prefix, tokens, lexer);
    },
  };
}

const orderedListTokenizer = OrderedList.config.markdownTokenizer as Tokenizer | undefined;
const taskListTokenizer = TaskList.config.markdownTokenizer as Tokenizer | undefined;

export const isOrderedListItem = (line: string) => ORDERED_ITEM.test(line);
export const isTaskListItem = (line: string) => TASK_ITEM.test(line);

/** OrderedList with a linear-time Markdown tokenizer; otherwise identical. */
export const FastOrderedList = orderedListTokenizer
  ? OrderedList.extend({ markdownTokenizer: bounded(orderedListTokenizer, isOrderedListItem, false) })
  : OrderedList;

/** TaskList with a linear-time Markdown tokenizer; otherwise identical. */
export const FastTaskList = taskListTokenizer
  ? TaskList.extend({ markdownTokenizer: bounded(taskListTokenizer, isTaskListItem, true) })
  : TaskList;
