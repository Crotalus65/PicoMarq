// The editor's right-click menu, built from Electron's `context-menu` event
// parameters so spelling suggestions for the word under the pointer can be
// offered (with Ignore All and Add to Dictionary), then Bold and Italic, Cut,
// Copy and Paste, plus any extra items the editor registered for the click
// (table commands). Kept free of Electron imports so it can be unit-tested.

const MAX_SUGGESTIONS = 6;

/**
 * @param {object} params Electron ContextMenuParams (misspelledWord, dictionarySuggestions, editFlags).
 * @param {Array<{ id?: string, text?: string, type?: 'separator' }>} extras Items registered by the editor.
 * @param {{ command: (action: string, extra?: object) => void, replaceMisspelling: (text: string) => void, ignoreAll: (word: string) => void, addToDictionary: (word: string) => void }} actions
 */
function contextMenuTemplate(params, extras, actions) {
  const template = [];
  const misspelled = typeof params.misspelledWord === 'string' ? params.misspelledWord : '';
  if (misspelled) {
    const suggestions = (Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : []).filter(s => typeof s === 'string' && s).slice(0, MAX_SUGGESTIONS);
    for (const suggestion of suggestions) template.push({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) });
    if (!suggestions.length) template.push({ label: 'No spelling suggestions', enabled: false });
    // This document only, until it is closed; the dictionary is for good.
    template.push({ label: 'Ignore All', click: () => actions.ignoreAll(misspelled) });
    template.push({ label: 'Add to Dictionary', click: () => actions.addToDictionary(misspelled) });
    template.push({ type: 'separator' });
  }
  const flags = params.editFlags || {};
  // The accelerators are shown as hints; the editor binds the keys itself.
  template.push(
    { label: 'Bold', accelerator: 'CmdOrCtrl+B', registerAccelerator: false, click: () => actions.command('bold') },
    { label: 'Italic', accelerator: 'CmdOrCtrl+I', registerAccelerator: false, click: () => actions.command('italic') },
    { type: 'separator' },
    { role: 'cut', enabled: flags.canCut !== false },
    { role: 'copy', enabled: flags.canCopy !== false },
    { role: 'paste' },
  );
  const items = (Array.isArray(extras) ? extras : []).map(item => item.type === 'separator'
    ? { type: 'separator' }
    : { label: String(item.text).slice(0, 120), click: () => actions.command('context-menu-item', { id: item.id }) });
  if (items.length) template.push({ type: 'separator' }, ...items);
  return template;
}

/** Validate items sent by the renderer before they are stored. */
function sanitizeExtras(extras) {
  const items = Array.isArray(extras && extras.items) ? extras.items : [];
  return items
    .filter(item => item && (item.type === 'separator' || (typeof item.id === 'string' && typeof item.text === 'string')))
    .slice(0, 40)
    .map(item => item.type === 'separator' ? { type: 'separator' } : { id: item.id, text: item.text });
}

module.exports = { contextMenuTemplate, sanitizeExtras };
