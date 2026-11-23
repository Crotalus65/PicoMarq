const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contextMenuTemplate, sanitizeExtras } = require('../desktop/context-menu.cjs');

function actions() {
  const calls = [];
  return { calls, command: (action, extra) => calls.push(['command', action, extra]), replaceMisspelling: text => calls.push(['replace', text]), ignoreAll: word => calls.push(['ignore', word]), addToDictionary: word => calls.push(['add', word]) };
}
const labels = template => template.map(item => item.type === 'separator' ? '|' : item.label || item.role);

test('a misspelled word gets its suggestions, Ignore All and Add to Dictionary first', () => {
  const a = actions();
  const template = contextMenuTemplate({ misspelledWord: 'acommodate', dictionarySuggestions: ['accommodate', 'accommodated'], editFlags: { canCut: false, canCopy: false } }, [], a);
  assert.deepEqual(labels(template), ['accommodate', 'accommodated', 'Ignore All', 'Add to Dictionary', '|', 'Bold', 'Italic', '|', 'cut', 'copy', 'paste']);
  template[0].click();
  template[2].click();
  template[3].click();
  assert.deepEqual(a.calls, [['replace', 'accommodate'], ['ignore', 'acommodate'], ['add', 'acommodate']]);
  assert.equal(template.find(item => item.role === 'cut').enabled, false);
  assert.equal(template.find(item => item.role === 'copy').enabled, false);
  assert.equal(template.find(item => item.role === 'paste').enabled, undefined);
});

test('a misspelled word without suggestions says so; suggestions are capped at six', () => {
  const none = contextMenuTemplate({ misspelledWord: 'zzxq', dictionarySuggestions: [] }, [], actions());
  assert.deepEqual(labels(none).slice(0, 4), ['No spelling suggestions', 'Ignore All', 'Add to Dictionary', '|']);
  assert.equal(none[0].enabled, false);
  const many = contextMenuTemplate({ misspelledWord: 'w', dictionarySuggestions: ['1', '2', '3', '4', '5', '6', '7', '8'] }, [], actions());
  assert.deepEqual(labels(many).slice(0, 8), ['1', '2', '3', '4', '5', '6', 'Ignore All', 'Add to Dictionary']);
});

test('no misspelling gives Bold, Italic and the clipboard items, with table items appended', () => {
  const a = actions();
  const template = contextMenuTemplate({ editFlags: { canCut: true, canCopy: true } }, [{ id: 'x1', text: 'Add Row Below' }, { type: 'separator' }, { id: 'x2', text: 'Delete Table' }], a);
  assert.deepEqual(labels(template), ['Bold', 'Italic', '|', 'cut', 'copy', 'paste', '|', 'Add Row Below', '|', 'Delete Table']);
  assert.equal(template.some(item => item.label === 'Ignore All' || item.label === 'Add to Dictionary'), false);
  template[template.length - 1].click();
  template[0].click();
  template[1].click();
  assert.deepEqual(a.calls, [['command', 'context-menu-item', { id: 'x2' }], ['command', 'bold', undefined], ['command', 'italic', undefined]]);
  assert.deepEqual(template.slice(0, 2).map(item => [item.accelerator, item.registerAccelerator]), [['CmdOrCtrl+B', false], ['CmdOrCtrl+I', false]]);
  assert.equal(template.some(item => item.role === 'selectAll'), false);
  assert.equal(template.find(item => item.role === 'cut').enabled, true);
});

test('extras from the renderer are validated and trimmed', () => {
  assert.deepEqual(sanitizeExtras(null), []);
  assert.deepEqual(sanitizeExtras({ items: [{ id: 'a', text: 'A', action: 'ignored' }, { type: 'separator' }, { id: 1, text: 'bad' }, null, { text: 'no id' }] }), [{ id: 'a', text: 'A' }, { type: 'separator' }]);
  assert.equal(sanitizeExtras({ items: Array.from({ length: 50 }, (_, i) => ({ id: String(i), text: 't' })) }).length, 40);
});
