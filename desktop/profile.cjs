const fs = require('node:fs');
const path = require('node:path');

function profileDirectory(appData) {
  const current = path.join(appData, 'PicoMarQ');
  // Reuse earlier personal builds' recovery data when adopting the new name:
  // Quill (0.1.6–0.1.11) and the custom Scratch builds before it.
  const candidates = [current, path.join(appData, 'Quill'), path.join(appData, 'Scratch Custom'), path.join(appData, 'scratch-custom')];
  for (const directory of candidates) {
    for (const file of ['session.json', 'session-backup.json']) {
      try {
        const session = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        if (session.version === 1 && session.settings && typeof session.settings === 'object' && !Array.isArray(session.settings)) return directory;
      } catch {}
    }
  }
  return current;
}
module.exports = { profileDirectory };
