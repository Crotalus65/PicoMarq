const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldRestoreSession } = require('../desktop/startup.cjs');

const saved = { id: 'file', path: 'Notes.md', content: 'saved text', diskContent: 'saved text' };
const draft = { id: 'draft', path: null, content: 'unsaved text', diskContent: '' };

test('existing profiles and unknown startup values keep automatic restoration', async () => {
  for (const startupBehavior of [undefined, 'restore', 'unknown']) {
    assert.equal(await shouldRestoreSession({ settings: { startupBehavior }, documents: [saved, draft] }, () => { throw new Error('Unexpected prompt'); }), true);
  }
});

test('new-session startup skips saved documents and empty untitled windows without a recovery prompt', async () => {
  for (const documents of [[], [saved], [{ ...draft, content: '' }]]) {
    assert.equal(await shouldRestoreSession({ settings: { startupBehavior: 'new' }, documents }, () => { throw new Error('Unexpected prompt'); }), false);
  }
});

test('new-session startup offers recovery for both named and untitled drafts', async () => {
  const state = { settings: { startupBehavior: 'new' }, documents: [{ ...saved, content: '' }, draft] };
  let count;
  assert.equal(await shouldRestoreSession(state, value => { count = value; return true; }), true);
  assert.equal(count, 2, 'Deleting saved text is also an unsaved edit');
  assert.equal(state.documents[1].content, 'unsaved text');
  assert.equal(await shouldRestoreSession(state, () => false), false);
});

test('a failed recovery prompt aborts startup instead of silently dropping drafts', async () => {
  const state = { settings: { startupBehavior: 'new' }, documents: [draft] };
  await assert.rejects(shouldRestoreSession(state, async () => { throw new Error('Dialog failed'); }), /Dialog failed/);
  assert.equal(state.documents[0].content, 'unsaved text');
});
