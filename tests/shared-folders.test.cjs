const test = require('node:test');
const assert = require('node:assert/strict');
const { shareHostOf, shareHostOfPath, refusesRequest } = require('../desktop/shared-folders.cjs');
const cases = require('./shared-folder-cases.cjs');

test('a file: address on another computer is recognized however it is written', () => {
  for (const [address, host] of cases) assert.equal(shareHostOf(address), host, address);
});

test('the computer a path is on', () => {
  assert.equal(shareHostOfPath('\\\\Server\\share\\folder\\doc.md'), 'server');
  assert.equal(shareHostOfPath('//server/share/doc.md'), 'server');
  assert.equal(shareHostOfPath('C:\\Users\\a\\doc.md'), null);
  assert.equal(shareHostOfPath('/home/a/doc.md'), null);
  assert.equal(shareHostOfPath(null), null);
  assert.equal(shareHostOfPath(''), null);
});

test('requests to other computers are refused, except to the one an open document or the program is on', () => {
  const local = ['C:\\Program Files\\PicoMarQ\\resources\\app\\desktop', 'C:\\Users\\a\\doc.md', null];
  assert.equal(refusesRequest('file://evil/share/x.png', local), true);
  assert.equal(refusesRequest('file:////evil/share/x.png', local), true);
  assert.equal(refusesRequest('file:///C:/Users/a/pictures/x.png', local), false);
  assert.equal(refusesRequest('https://example.com/x.png', local), false);
  const onShare = ['C:\\PicoMarQ\\resources\\app\\desktop', '\\\\fileserver\\home\\a\\doc.md'];
  assert.equal(refusesRequest('file://fileserver/home/a/pictures/x.png', onShare), false);
  assert.equal(refusesRequest('file://FILESERVER/other/x.png', onShare), false);
  assert.equal(refusesRequest('file://evil/share/x.png', onShare), true);
  // The program itself started from a share: its own files load.
  assert.equal(refusesRequest('file://apps/tools/PicoMarQ/resources/app/dist/index.html', ['\\\\apps\\tools\\PicoMarQ\\resources\\app\\desktop']), false);
});
