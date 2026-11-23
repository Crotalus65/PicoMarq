import { test } from 'node:test';
import assert from 'node:assert/strict';
import cases from './shared-folder-cases.cjs';
import { resolveImageUrl, shareHostOf } from '../src/lib/desktop.ts';

test('the page recognizes a file: address on another computer the same way as the main process', () => {
  for (const [address, host] of cases as [string, string | null][]) assert.equal(shareHostOf(address), host, address);
});

test('pictures on this computer and on the web keep their addresses', () => {
  const document = 'C:\\Users\\a\\book\\chapter.md';
  assert.equal(resolveImageUrl('pictures/one.png', document), 'file:///C:/Users/a/book/pictures/one.png');
  assert.equal(resolveImageUrl('..\\shared art\\two.png', document), 'file:///C:/Users/a/shared%20art/two.png');
  assert.equal(resolveImageUrl('D:\\art\\three.png', document), 'file:///D:/art/three.png');
  assert.equal(resolveImageUrl('file:///D:/art/three.png', document), 'file:///D:/art/three.png');
  assert.equal(resolveImageUrl('https://example.com/four.png', document), 'https://example.com/four.png');
  assert.equal(resolveImageUrl('data:image/png;base64,AAAA', document), 'data:image/png;base64,AAAA');
  assert.equal(resolveImageUrl('pictures/one.png', null), 'pictures/one.png');
  assert.equal(resolveImageUrl('pictures/one.png', '/home/a/book/chapter.md'), 'file:///home/a/book/pictures/one.png');
});

test('a picture in a shared folder on another computer gets no address', () => {
  for (const document of ['C:\\Users\\a\\book\\chapter.md', '/home/a/chapter.md', null]) {
    for (const source of [
      '//evil/share/x.png', '\\\\evil\\share\\x.png', 'file://evil/share/x.png', 'file:////evil/share/x.png',
      'file://///evil/share/x.png', 'file:///%5C%5Cevil%5Cshare%5Cx.png', 'FILE://EVIL/share/x.png', '//evil.example.com/x.png',
    ]) assert.equal(resolveImageUrl(source, document), '', `${source} in ${document}`);
  }
});

test('a document on a share shows the pictures of its own computer, and of no other', () => {
  const document = '\\\\fileserver\\home\\a\\book\\chapter.md';
  assert.equal(resolveImageUrl('pictures/one.png', document), 'file://fileserver/home/a/book/pictures/one.png');
  assert.equal(resolveImageUrl('\\\\FileServer\\art\\two.png', document), 'file://fileserver/art/two.png');
  assert.equal(resolveImageUrl('file://fileserver/art/two.png', document), 'file://fileserver/art/two.png');
  assert.equal(resolveImageUrl('//evil/share/x.png', document), '');
  assert.equal(resolveImageUrl('file://evil/share/x.png', document), '');
  assert.equal(resolveImageUrl('C:\\local\\three.png', document), 'file:///C:/local/three.png');
});
