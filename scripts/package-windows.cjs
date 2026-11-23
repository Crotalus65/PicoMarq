// Builds the portable Windows package from Electron's official Windows
// package: release/PicoMarQ-Windows-x64-<version>.zip. Used whenever the
// engine changes (1.3.4: Electron 44.11.5); releases that keep the engine
// can be assembled from the previous release instead (repack-windows-from-*.py).
const { downloadArtifact } = require('@electron/get');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { setWindowsIcon } = require('./windows-icon.cjs');
const exec = promisify(execFile);
const sha256 = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function main() {
  const project = require('../package.json');
  const version = project.devDependencies.electron;
  // Electron's package is downloaded (and kept in the user's cache), or a
  // copy fetched beforehand is named in PICOMARQ_ELECTRON_ZIP. Either way it
  // must be the file the Electron project published: its checksum is
  // compared with the list inside the electron npm package, and that package
  // is pinned by package-lock.json.
  const electronPackage = path.dirname(require.resolve('electron/package.json'));
  const installed = require(path.join(electronPackage, 'package.json')).version;
  if (installed !== version) throw new Error(`node_modules has Electron ${installed}, package.json asks for ${version}: run npm ci`);
  const artifact = `electron-v${version}-win32-x64.zip`;
  const published = require(path.join(electronPackage, 'checksums.json'))[artifact];
  const zip = process.env.PICOMARQ_ELECTRON_ZIP || await downloadArtifact({ version, artifactName: 'electron', platform: 'win32', arch: 'x64' });
  const packageSum = await sha256(zip);
  if (!published || packageSum !== published) throw new Error(`${zip} is not ${artifact} as published: SHA-256 ${packageSum}, published ${published}`);
  const name = project.productName;
  const release = path.resolve(`release/${name}`);
  await fs.rm(release, { recursive: true, force: true });
  await fs.mkdir(release, { recursive: true });
  await exec('unzip', ['-q', zip, '-d', release]);
  const app = path.join(release, 'resources/app');
  await fs.mkdir(app, { recursive: true });
  for (const name of ['dist', 'desktop']) await fs.cp(name, path.join(app, name), { recursive: true });
  for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.txt', 'app.ico']) await fs.copyFile(name, path.join(app, name));
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: project.name, productName: project.productName, version: project.version, main: 'desktop/main.cjs' }, null, 2) + '\n');
  await fs.rm(path.join(release, 'resources/default_app.asar'), { force: true });
  const electronExeSum = await sha256(path.join(release, 'electron.exe'));
  await setWindowsIcon(path.join(release, 'electron.exe'), path.join(release, `${name}.exe`), path.resolve('app.ico'), { productName: project.productName, version: project.version });
  await fs.rm(path.join(release, 'electron.exe'));
  const exeSum = await sha256(path.join(release, `${name}.exe`));
  await fs.copyFile('START-HERE.txt', path.join(release, 'START-HERE.txt'));
  await fs.copyFile('docs/KEYBOARD-SHORTCUTS.md', path.join(release, 'KEYBOARD-SHORTCUTS.md'));
  await fs.copyFile('LICENSE', path.join(release, 'APP-LICENSE.txt'));
  await fs.copyFile('THIRD-PARTY-NOTICES.txt', path.join(release, 'THIRD-PARTY-NOTICES.txt'));
  await fs.writeFile(path.join(release, 'RELEASE-VALIDATION.txt'), [
    `${name} ${project.version} portable Windows release`,
    '',
    `Built from Electron's official Windows package, version ${version}`,
    `(${artifact}), whose checksum was compared`,
    'with the one the Electron project publishes. Every file of that',
    `package is here as it came, with two exceptions: electron.exe is`,
    `${name}.exe, with the ${name} icon, name and version in place of`,
    "Electron's (its code and data are unchanged), and Electron's sample",
    'application (resources\\default_app.asar) is left out. The program',
    'itself is in resources\\app.',
    '',
    `The renderer is compiled from the ${project.version} source (npm ci, npm run`,
    `build). Tested on Linux with the same Electron ${version}: unit tests,`,
    'Chromium browser checks, and the desktop, typography, startup,',
    'close, settings, spelling, word-count, Ignore All, dictionary,',
    'Find, long-paragraph, Undo and pictures checks (see VALIDATION.md',
    'in the source package). Not run on Windows here; this unsigned',
    'build should be checked on Windows 10/11.',
    '',
    `Electron package SHA-256:        ${packageSum}`,
    `Electron's electron.exe SHA-256: ${electronExeSum}`,
    `${name}.exe SHA-256:            ${exeSum}`,
    '',
  ].join('\n'));
  const archive = path.resolve(`release/${name}-Windows-x64-${project.version}.zip`);
  await fs.rm(archive, { force: true });
  await exec('zip', ['-q', '-r', '-6', archive, path.basename(release)], { cwd: path.dirname(release), maxBuffer: 1024 * 1024 });
  console.log(JSON.stringify({ electron: version, electron_package_sha256: packageSum, electron_exe_sha256: electronExeSum, exe_sha256: exeSum }, null, 2));
  console.log(archive);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
