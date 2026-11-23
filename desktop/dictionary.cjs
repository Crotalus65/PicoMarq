// Settings > Spelling > Clear Custom Dictionary: the "are you sure" box shown
// before every word added with Add to Dictionary is removed.
// Kept free of Electron imports so it can be unit-tested.

const MAX_LISTED = 20;

/** The words as text, without repeats, in alphabetical order. */
function dictionaryWords(words) {
  const unique = [...new Set((Array.isArray(words) ? words : []).filter(word => typeof word === 'string' && word))];
  return unique.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Options for the native message box. Cancel is the default button. */
function clearDictionaryDialog(words) {
  const list = dictionaryWords(words);
  const one = list.length === 1;
  const more = list.length - MAX_LISTED;
  return {
    type: 'warning',
    title: 'Clear Custom Dictionary',
    message: 'Clear the custom dictionary?',
    detail: [
      `${one ? 'This removes the 1 word' : `This removes all ${list.length} words`} you added with Add to Dictionary:`,
      '',
      `${list.slice(0, MAX_LISTED).join(', ')}${more > 0 ? `, and ${more} more` : ''}`,
      '',
      `${one ? 'It' : 'They'} will be marked as misspelled again. This cannot be undone.`,
    ].join('\n'),
    buttons: ['Clear', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

module.exports = { dictionaryWords, clearDictionaryDialog, MAX_LISTED };
