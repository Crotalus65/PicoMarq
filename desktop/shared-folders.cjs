// Files on other computers' shared folders.
//
// Asking another computer for a file makes Windows sign in to it, which
// gives that computer the user's name and a form of the password that can be
// attacked. A document from someone else can point a picture at a computer
// set up for that. The page does not ask for such pictures (resolveImageUrl
// in src/lib/desktop.ts); this is the second barrier, in the main process:
// no file is fetched from another computer, except from the one a document
// that is open here is on, or the one PicoMarQ itself runs from.

/**
 * The other computer a file: address points at ("file://server/share/x.png",
 * or the same written with more slashes or with backslashes), or null for a
 * file on this computer and for any other kind of address.
 */
function shareHostOf(address) {
  // Four or more slashes after "file:" name a share on Windows; other systems
  // read them as a path on this computer. (Tabs and line breaks inside an
  // address are ignored by browsers.)
  const plain = String(address).replace(/[\t\n\r]/g, '').trim();
  const slashes = /^file:[\\/]{4,}([^\\/?#]*)/i.exec(plain);
  if (slashes) return slashes[1].toLowerCase();
  let url;
  try { url = new URL(plain); } catch { return null; }
  if (url.protocol !== 'file:') return null;
  if (url.hostname && url.hostname.toLowerCase() !== 'localhost') return url.hostname.toLowerCase();
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* as it is */ }
  // A path on this computer starts with one slash: /C:/Users/..., /home/...
  const share = /^\/{2,}([^/]*)/.exec(path.replace(/\\/g, '/'));
  return share ? share[1].toLowerCase() : null;
}

/** The computer a path such as \\server\share\file.md is on, or null for a path on this computer. */
function shareHostOfPath(file) {
  const share = /^[\\/]{2,}([^\\/]*)/.exec(String(file || ''));
  return share ? share[1].toLowerCase() : null;
}

/**
 * Whether a request must be refused. `trustedPaths` are the paths of the
 * open documents and of the program itself.
 */
function refusesRequest(address, trustedPaths) {
  const host = shareHostOf(address);
  if (host === null) return false;
  return !trustedPaths.some(file => shareHostOfPath(file) === host);
}

module.exports = { shareHostOf, shareHostOfPath, refusesRequest };
