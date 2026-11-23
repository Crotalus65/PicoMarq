// "Ignore All" in the right-click spelling menu: words the spelling checker
// should leave alone in one document, for as long as that document is open.
//
// Nothing here is saved. The lists live in this window's memory, one per
// open document, and are gone when the document is closed. A word to keep
// for good belongs in the dictionary (Add to Dictionary).

const NONE: ReadonlySet<string> = new Set();
const ignoredByDocument = new Map<string, ReadonlySet<string>>();

const APOSTROPHES = /[’ʼ]/g;
const POSSESSIVE = /.'s$/i;
// A word: letters and digits, with apostrophes only between them.
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’ʼ][\p{L}\p{M}\p{N}]+)*/gu;
const WHOLE_WORD = /^[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*$/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;

/**
 * The form under which a word is kept: curly apostrophes become straight
 * ones, and a possessive is kept as its base word ("Qarth's" as "Qarth"),
 * so that ignoring either form covers both.
 */
export function normalizeIgnoredWord(word: string): string {
  const plain = word.trim().replace(APOSTROPHES, "'");
  return POSSESSIVE.test(plain) ? plain.slice(0, -2) : plain;
}

/** The words ignored in a document. The same set object until the list changes. */
export function ignoredWords(documentId: string | null | undefined): ReadonlySet<string> {
  return (documentId && ignoredByDocument.get(documentId)) || NONE;
}

/** Add a word to a document's list; returns the list (a new set when it grew). */
export function ignoreWord(documentId: string, word: string): ReadonlySet<string> {
  const current = ignoredWords(documentId);
  const normalized = normalizeIgnoredWord(word);
  if (!normalized || normalized.length > 100 || current.has(normalized)) return current;
  const next = new Set(current).add(normalized);
  ignoredByDocument.set(documentId, next);
  return next;
}

/** Drop the lists of documents that are no longer open in this window. */
export function forgetIgnoredWords(openDocumentIds: Iterable<string>): void {
  if (ignoredByDocument.size === 0) return;
  const open = new Set(openDocumentIds);
  for (const id of [...ignoredByDocument.keys()]) if (!open.has(id)) ignoredByDocument.delete(id);
}

/** The spellings that a list of ignored words covers, prepared for searching. */
export interface IgnoredForms {
  /** Spellings made of letters, digits and inner apostrophes: looked up word by word. */
  readonly words: ReadonlySet<string>;
  /** Spellings with other characters in them (the checker decides what a word is): searched for as they are. */
  readonly other: readonly string[];
}
export const NO_IGNORED_FORMS: IgnoredForms = { words: new Set(), other: [] };

/**
 * Every spelling that the ignored words cover, as dictionaries treat their
 * entries: the word as given, in capitals, and (for a lower-case word) with a
 * capital first letter, as at the start of a sentence.
 */
export function ignoredForms(ignored: ReadonlySet<string>): IgnoredForms {
  if (ignored.size === 0) return NO_IGNORED_FORMS;
  const words = new Set<string>();
  const other = new Set<string>();
  for (const word of ignored) {
    const spellings = [word, word.toUpperCase()];
    if (word === word.toLowerCase()) spellings.push(word.charAt(0).toUpperCase() + word.slice(1));
    for (const spelling of spellings) (WHOLE_WORD.test(spelling) ? words : other).add(spelling);
  }
  return { words, other: [...other] };
}

/**
 * Where ignored words occur in a run of text, as [start, end) offsets of
 * whole words, in order. A possessive of an ignored word counts as that word.
 */
export function findIgnoredRanges(text: string, forms: IgnoredForms): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (!text) return ranges;
  if (forms.words.size) {
    WORD.lastIndex = 0;
    for (let match = WORD.exec(text); match; match = WORD.exec(text)) {
      const word = match[0].replace(APOSTROPHES, "'");
      if (forms.words.has(word) || (POSSESSIVE.test(word) && forms.words.has(word.slice(0, -2)))) ranges.push([match.index, match.index + match[0].length]);
    }
  }
  if (forms.other.length) {
    const plain = text.replace(APOSTROPHES, "'");
    for (const spelling of forms.other) {
      for (let at = plain.indexOf(spelling); at >= 0; at = plain.indexOf(spelling, at + 1)) {
        const end = at + spelling.length;
        const inside = (index: number) => index >= 0 && index < plain.length && WORD_CHARACTER.test(plain.charAt(index));
        // Not part of a longer word, unless the spelling itself starts or ends with punctuation.
        if (WORD_CHARACTER.test(spelling.charAt(0)) && inside(at - 1)) continue;
        if (WORD_CHARACTER.test(spelling.charAt(spelling.length - 1)) && inside(end)) continue;
        ranges.push([at, end]);
      }
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // Overlapping finds become one range.
    const merged: Array<[number, number]> = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range);
    }
    return merged;
  }
  return ranges;
}
