// Where Find's matches are in the formatted document. How they are shown is
// in components/editor/SearchHighlight.ts.

export interface SearchMatch {
  readonly from: number;
  readonly to: number;
}

export interface SearchMatches {
  /** The list as Find handed it over. The same list again means that only the current match changed. */
  readonly found: readonly SearchMatch[];
  /** The same matches, where they are now. One whose text was deleted is null, so the others keep their places in the list. */
  readonly matches: readonly (SearchMatch | null)[];
  /** The place in the list of the match Find is on. */
  readonly current: number;
}

export const NO_SEARCH_MATCHES: SearchMatches = { found: [], matches: [], current: 0 };

/** Find has new results, or has moved to another match. */
export function showSearchMatches(shown: SearchMatches, found: readonly SearchMatch[], current: number): SearchMatches {
  if (found.length === 0) return NO_SEARCH_MATCHES;
  // Next and Previous hand over the same list: the matches stay where
  // editing has moved them.
  if (found === shown.found) return current === shown.current ? shown : { ...shown, current };
  return { found, matches: found, current };
}

/**
 * After an edit. A match moves with its text, grows with text typed inside
 * it, and goes when its text is deleted.
 */
export function moveSearchMatches(shown: SearchMatches, map: (position: number, bias: 1 | -1) => number): SearchMatches {
  let moved = false;
  const matches = shown.matches.map((match) => {
    if (!match) return null;
    const from = map(match.from, 1);
    const to = map(match.to, -1);
    if (from === match.from && to === match.to) return match;
    moved = true;
    return from < to ? { from, to } : null;
  });
  return moved ? { ...shown, matches } : shown;
}
