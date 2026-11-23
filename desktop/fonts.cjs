const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(execFile);
let cached;
async function installedFonts(refresh = false) {
  if (cached && !refresh) return cached;
  let families;
  if (process.platform === 'win32') {
    const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); Add-Type -AssemblyName PresentationCore; $all = @([System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source }); $userFonts = Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts'; if (Test-Path $userFonts) { $uri = New-Object System.Uri($userFonts + '\\'); $all += @([System.Windows.Media.Fonts]::GetFontFamilies($uri) | ForEach-Object { ($_.Source -split '#')[-1] }) }; @($all | Sort-Object -Unique) | ConvertTo-Json -Compress`;
    const { stdout } = await exec(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    const parsed = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    families = Array.isArray(parsed) ? parsed : [parsed];
  } else {
    const { stdout } = await exec('fc-list', ['--format=%{family}\n'], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    families = stdout.split('\n').flatMap(line => line.split(','));
  }
  cached = [...new Set(families.map(name => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return cached;
}
module.exports = { installedFonts };
