const path = require('node:path');

function recentFiles(files, newest, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const seen = new Set();
  const result = [];
  for (const file of [newest, ...(Array.isArray(files) ? files : [])]) {
    if (typeof file !== 'string' || !paths.isAbsolute(file)) continue;
    const normalized = paths.normalize(file);
    const key = platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length === 4) break;
  }
  return result;
}
module.exports = { recentFiles };
