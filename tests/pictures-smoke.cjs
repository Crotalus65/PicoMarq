// Pictures and other computers' shared folders, in the real app.
//
// What it guards: a document cannot make PicoMarQ ask another computer for a
// file. On Windows such a request signs the user in to that computer, which
// hands it the user's name and a form of the password that can be attacked.
// The page gives such pictures no address, and the main process refuses the
// request if one is made all the same. Pictures next to the document and on
// the web still load, and the document's text keeps every address as it was.
//
// No real computer is named: the hosts end in .invalid, which never resolves.
// Run with: npm run test:pictures. Uses tests/spelling-harness.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startSpellingApp, active, pause } = require('./spelling-harness.cjs');

// A 1 x 1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DOCUMENT = [
  '# Pictures', '',
  '![beside](pictures/beside.png)', '',
  '![share one](//share-host.invalid/folder/one.png)', '',
  '![share two](file://share-host.invalid/folder/two.png)', '',
  '![share three](file:////share-host.invalid/folder/three.png)', '',
  '<img src="file://share-host.invalid/folder/four.png" alt="share four">', '',
  '![web](https://web-host.invalid/five.png)', '',
  'Text after the pictures.', '',
].join('\n');

// Everything else in a document that could carry an address.
const OTHER_WAYS = [
  '# Other ways', '',
  '```mermaid',
  'graph TD',
  '  A["<img src=\'//share-host.invalid/folder/label-one.png\'> label one"] --> B["<img src=\'file://share-host.invalid/folder/label-two.png\'> label two"]',
  '  B --> C["<a href=\'//share-host.invalid/folder/label-link\'>link</a>"]',
  '  click A "//share-host.invalid/folder/click-target" "tip"',
  '```', '',
  '$$\\includegraphics{//share-host.invalid/folder/math.png}$$', '',
  'Inline math $\\href{//share-host.invalid/folder/math-link}{x}$, a [link](//share-host.invalid/folder/link.md) and <a href="file://share-host.invalid/folder/raw-link">a raw one</a>.', '',
  '<video src="//share-host.invalid/folder/video.mp4"></video>', '',
  '<iframe src="//share-host.invalid/folder/frame.html"></iframe>', '',
  '<link rel="stylesheet" href="//share-host.invalid/folder/style.css">', '',
  '<object data="//share-host.invalid/folder/object.bin"></object>', '',
  '<div style="background:url(//share-host.invalid/folder/style-url.png)">styled</div>', '',
  'Text after.', '',
].join('\n');

(async () => {
  const watchdog = setTimeout(() => { console.error('Pictures test timed out'); process.exit(1); }, 120000);
  const app = await startSpellingApp({ name: 'pictures', display: process.env.SCRATCH_DISPLAY_NUMBER || '133' });
  const refused = () => app.electron.evaluate(() => [...globalThis.picomarqRefusedRequests]);
  const file = await app.write('Pictures.md', DOCUMENT);
  fs.mkdirSync(path.join(path.dirname(file), 'pictures'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(file), 'pictures', 'beside.png'), PNG);
  await app.open(file);
  await app.page.waitForFunction(active => [...document.querySelectorAll(`${active} .tiptap img`)].some(img => img.alt === 'beside' && img.complete), active, { timeout: 8000 });
  await pause(1500);
  const pictures = await app.page.evaluate(active => Object.fromEntries([...document.querySelectorAll(`${active} .tiptap img`)].map(img => [img.alt, { address: img.getAttribute('src'), width: img.naturalWidth }])), active);

  // 1. The picture next to the document is shown.
  assert.equal(pictures.beside.width, 1, `The picture beside the document did not load: ${JSON.stringify(pictures.beside)}`);
  assert(pictures.beside.address.startsWith('file:///') && pictures.beside.address.endsWith('/pictures/beside.png'));
  console.log('PASS: a picture next to the document is shown');

  // 2. Pictures on another computer's share get no address, and nothing is asked of that computer.
  for (const name of ['share one', 'share two', 'share three', 'share four']) {
    assert(pictures[name], `The picture "${name}" is missing from the document`);
    assert.equal(pictures[name].address, '', `"${name}" was given the address ${pictures[name].address}`);
  }
  assert.deepEqual(await refused(), [], 'The page asked for a file on another computer');
  console.log('PASS: pictures in a shared folder on another computer are given no address, however the address is written');

  // 3. A picture on the web keeps its address (it is asked for, as before).
  assert.equal(pictures.web.address, 'https://web-host.invalid/five.png');
  console.log('PASS: a picture on the web keeps its address');

  // 4. The document itself is not changed: every address is still in its text.
  const markdown = await app.markdown();
  for (const address of ['pictures/beside.png', '//share-host.invalid/folder/one.png', 'file://share-host.invalid/folder/two.png', 'file:////share-host.invalid/folder/three.png', 'file://share-host.invalid/folder/four.png', 'https://web-host.invalid/five.png']) {
    assert(markdown.includes(address), `The document lost the address ${address}`);
  }
  console.log('PASS: the document keeps every picture address as it was written');

  // 5. The second barrier: a request made past the page's own check is
  // stopped in the main process, before any file is asked for. (Such a
  // request fails here in any case, there being no such computer; "blocked"
  // is the answer that says it was stopped and never went out.)
  const failed = [];
  app.page.on('requestfailed', request => failed.push(`${request.url()} ${request.failure()?.errorText}`));
  const ask = address => app.page.evaluate(address => new Promise(resolve => {
    const picture = new Image();
    picture.onload = () => resolve('loaded');
    picture.onerror = () => resolve('refused');
    picture.src = address;
    setTimeout(() => resolve('no answer'), 5000);
  }), address);
  assert.equal(await ask('file://share-host.invalid/folder/direct.png'), 'refused');
  assert.deepEqual(await refused(), ['file://share-host.invalid/folder/direct.png'], 'The main process should have refused the request');
  for (let waited = 0; failed.length === 0 && waited < 2000; waited += 100) await pause(100);
  assert.deepEqual(failed, ['file://share-host.invalid/folder/direct.png net::ERR_BLOCKED_BY_CLIENT'], 'The request should have been stopped before it went out');
  // The page still gets its own files and the document's.
  assert.equal(await ask(await app.page.evaluate(() => document.querySelector('img[alt="beside"]').src + '?again')), 'loaded');
  assert.equal((await refused()).length, 1, 'A file on this computer was refused');
  console.log('PASS: a request for a file on another computer is stopped in the main process too, before it goes out, and files on this computer still load');

  // 6. Nothing else in a document asks another computer for a file: markup
  // in a diagram's labels is shown as text, the math commands that fetch
  // are off, other HTML is dropped, and a link does nothing until it is
  // clicked (and is then opened only as a web or mail link).
  await app.electron.evaluate(({ session }) => {
    globalThis.picomarqAskedFor = [];
    session.defaultSession.webRequest.onSendHeaders(details => globalThis.picomarqAskedFor.push(details.url));
    session.defaultSession.webRequest.onErrorOccurred(details => globalThis.picomarqAskedFor.push(details.url));
  });
  await app.open(await app.write('Other ways.md', OTHER_WAYS));
  await app.page.waitForFunction(active => [...document.querySelectorAll(`${active} .tiptap svg`)].some(svg => svg.textContent.includes('label one')), active, { timeout: 15000 });
  await pause(2500);
  const askedFor = await app.electron.evaluate(() => [...globalThis.picomarqAskedFor]);
  assert(askedFor.some(address => address.startsWith('file:///')), 'The record of requests is empty: it should hold the window\'s own files');
  assert.deepEqual(askedFor.filter(address => address.includes('share-host')), [], 'Something in the document asked another computer for a file');
  assert.equal((await refused()).length, 1, 'A request had to be refused in the main process');
  const carried = await app.page.evaluate(active => [...document.querySelectorAll(`${active} .tiptap :is([src], [data], [style*="url("])`)].map(element => element.outerHTML.slice(0, 160)), active);
  assert.deepEqual(carried.filter(html => html.includes('share-host')), [], 'An element in the document carries an address on another computer');
  const text = await app.page.evaluate(active => document.querySelector(`${active} .tiptap`).textContent, active);
  assert(text.includes("<img src='//share-host.invalid/folder/label-one.png'> label one"), 'The diagram label should show its markup as text');
  console.log('PASS: diagram labels, math, links and other HTML in a document ask no other computer for anything');

  assert.deepEqual(app.errors, [], `Renderer errors: ${app.errors.join('\n')}`);
  clearTimeout(watchdog);
  await app.stop();
  console.log('PICTURES CHECKS DONE');
})().catch(error => { console.error(error); process.exit(1); });
