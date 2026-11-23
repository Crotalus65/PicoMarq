import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StepMap } from 'prosemirror-transform';
import { moveSearchMatches, NO_SEARCH_MATCHES, showSearchMatches, type SearchMatches } from '../src/lib/search-matches.ts';

// The matches after text was replaced: `removed` characters at `at` gave way to `added` characters.
const edit = (shown: SearchMatches, at: number, removed: number, added: number) => {
  const map = new StepMap([at, removed, added]);
  return moveSearchMatches(shown, (position, bias) => map.map(position, bias));
};
const places = (shown: SearchMatches) => shown.matches.map(match => match && [match.from, match.to]);

test('new results are shown as found; no results clear everything', () => {
  const found = [{ from: 5, to: 9 }, { from: 20, to: 24 }];
  const shown = showSearchMatches(NO_SEARCH_MATCHES, found, 1);
  assert.deepEqual(places(shown), [[5, 9], [20, 24]]);
  assert.equal(shown.current, 1);
  assert.equal(showSearchMatches(shown, [], 0), NO_SEARCH_MATCHES);
});

test('a match moves with its text', () => {
  const shown = showSearchMatches(NO_SEARCH_MATCHES, [{ from: 5, to: 9 }, { from: 20, to: 24 }], 0);
  // Three characters typed before both, then four deleted between them.
  assert.deepEqual(places(edit(shown, 2, 0, 3)), [[8, 12], [23, 27]]);
  assert.deepEqual(places(edit(shown, 12, 4, 0)), [[5, 9], [16, 20]]);
  // An edit after the last match moves nothing, and nothing is rebuilt.
  assert.equal(edit(shown, 30, 0, 5), shown);
});

test('text typed against a match is not part of it; text typed inside it is', () => {
  const shown = showSearchMatches(NO_SEARCH_MATCHES, [{ from: 5, to: 9 }], 0);
  assert.deepEqual(places(edit(shown, 5, 0, 1)), [[6, 10]]);
  assert.deepEqual(places(edit(shown, 9, 0, 1)), [[5, 9]]);
  assert.deepEqual(places(edit(shown, 7, 0, 1)), [[5, 10]]);
});

test('a deleted match goes, and the others keep their places in the list', () => {
  const shown = showSearchMatches(NO_SEARCH_MATCHES, [{ from: 5, to: 9 }, { from: 20, to: 24 }, { from: 30, to: 34 }], 2);
  const after = edit(shown, 18, 8, 0);
  assert.deepEqual(places(after), [[5, 9], null, [22, 26]]);
  assert.equal(after.current, 2);
  // Partly deleted: what is left of it stays.
  assert.deepEqual(places(edit(shown, 22, 4, 0)), [[5, 9], [20, 22], [26, 30]]);
  // Replaced in one step by other text: the match stays on what took its
  // place, as a decoration's would. (Find searches again after its own Replace.)
  assert.deepEqual(places(edit(shown, 20, 4, 6)), [[5, 9], [20, 26], [32, 36]]);
  // Once gone it stays gone, whatever is typed there.
  assert.deepEqual(places(edit(after, 18, 0, 8)), [[5, 9], null, [30, 34]]);
});

test('Next and Previous keep the matches where editing has moved them', () => {
  const found = [{ from: 5, to: 9 }, { from: 20, to: 24 }];
  const moved = edit(showSearchMatches(NO_SEARCH_MATCHES, found, 0), 0, 0, 10);
  const next = showSearchMatches(moved, found, 1);
  assert.deepEqual(places(next), [[15, 19], [30, 34]]);
  assert.equal(next.current, 1);
  // The same match again changes nothing at all.
  assert.equal(showSearchMatches(next, found, 1), next);
  // Another search starts from the places it found.
  assert.deepEqual(places(showSearchMatches(next, [{ from: 5, to: 9 }], 0)), [[5, 9]]);
});
