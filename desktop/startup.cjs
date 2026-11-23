// Startup preference and crash recovery are separate decisions. A dirty
// recovery snapshot is never silently dropped by the blank-start preference.
async function shouldRestoreSession(state, askToRestore) {
  if (state.settings?.startupBehavior !== 'new') return true;
  const unsaved = (state.documents || []).filter(doc => doc.content !== doc.diskContent);
  if (!unsaved.length) return false;
  return askToRestore(unsaved.length);
}

module.exports = { shouldRestoreSession };
