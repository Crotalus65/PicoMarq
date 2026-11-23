#!/usr/bin/env python3
"""Repackage PicoMarQ 1.3.2 from the 1.3.1 portable Windows release.

Keeps the 1.3.1 package's Electron 44.6.0 runtime, replaces the application
files (resources/app: desktop, dist, package.json) with this source, which
must already be built (npm ci && npm run build), and updates the version
information of the unsigned executable from 1.3.1 to 1.3.2: the two version
strings and the two numbers of the fixed version record that hold the third
part of the version.
Usage:
  python scripts/repack-windows-from-1.3.1.py BASE-1.3.1.zip [OUTPUT-1.3.2.zip]
"""
import json
import hashlib
import shutil
import struct
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
OLD = '1.3.1'
NEW = '1.3.2'


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def version_numbers(version):
    """'1.3.1' as the two 32-bit values of VS_FIXEDFILEINFO: (major.minor, patch.0)."""
    major, minor, patch = (int(part) for part in version.split('.'))
    return (major << 16) | minor, patch << 16


def pe_sections(data):
    """Return PE section extents and the security directory for sanity checks."""
    if data[:2] != b'MZ':
        raise ValueError('Not a Windows PE executable (no MZ).')
    e_lfanew = struct.unpack_from('<I', data, 0x3C)[0]
    if data[e_lfanew:e_lfanew + 4] != b'PE\0\0':
        raise ValueError('Not a PE executable (no PE signature).')
    coff = e_lfanew + 4
    count = struct.unpack_from('<H', data, coff + 2)[0]
    optional = coff + 20
    opt_size = struct.unpack_from('<H', data, coff + 16)[0]
    if struct.unpack_from('<H', data, optional)[0] != 0x20b:
        raise ValueError('Expected 64-bit PE32+ executable.')
    if struct.unpack_from('<II', data, optional + 112 + 8*4) != (0, 0):
        raise ValueError('Expected an unsigned executable; refusing to break a signature.')
    checksum = struct.unpack_from('<I', data, optional + 64)[0]
    if checksum:
        raise ValueError('Expected zero PE checksum; refusing to overwrite a checksummed executable.')
    sections = {}
    for index in range(count):
        at = optional + opt_size + index*40
        name = bytes(data[at:at+8]).split(b'\0')[0].decode('ascii')
        virtual_size, virtual_addr, raw_size, raw_ptr = struct.unpack_from('<IIII', data, at + 8)
        if raw_ptr + raw_size > len(data):
            raise ValueError(f'Invalid section {name} raw size.')
        sections[name] = (raw_ptr, raw_size)
    if '.rsrc' not in sections:
        raise ValueError('Missing PE resource section.')
    return sections


def update_version_resource(exe_path):
    original = exe_path.read_bytes()
    sections = pe_sections(original)
    resource_start, resource_length = sections['.rsrc']
    new_bytes = bytearray(original)
    resource = original[resource_start:resource_start+resource_length]
    old_unicode = OLD.encode('utf-16-le')
    new_unicode = NEW.encode('utf-16-le')
    if len(old_unicode) != len(new_unicode):
        raise ValueError('The version strings must have the same length to be replaced in place.')
    matches = []
    where = 0
    while True:
        index = resource.find(old_unicode, where)
        if index == -1:
            break
        matches.append(index)
        where = index + len(old_unicode)
    # Existing unsigned PicoMarQ.exe contains FileVersion and ProductVersion.
    if len(matches) != 2:
        raise ValueError(f'Expected two strings {OLD} in .rsrc; found {len(matches)}')
    for index in matches:
        at = resource_start + index
        new_bytes[at:at+len(old_unicode)] = new_unicode
    fixed_signature = struct.pack('<I', 0xFEEF04BD)
    positions = []
    where = 0
    while True:
        index = resource.find(fixed_signature, where)
        if index == -1:
            break
        positions.append(index)
        where = index + 4
    if len(positions) != 1:
        raise ValueError(f'Expected one VS_FIXEDFILEINFO structure, got {len(positions)}')
    at = resource_start + positions[0]
    fixed = struct.unpack_from('<13I', original, at)
    old_parts = version_numbers(OLD)
    new_parts = version_numbers(NEW)
    if (fixed[2],fixed[3],fixed[4],fixed[5]) != old_parts*2:
        raise ValueError(f'Unexpected numeric version metadata: {fixed[2:6]}')
    # File version and product version, each as (major.minor, patch.0).
    for rel_offset, value in zip((2,3,4,5), new_parts*2):
        struct.pack_into('<I', new_bytes, at + rel_offset*4, value)
    if pe_sections(new_bytes) != sections:
        raise ValueError('Patch changed PE section layout.')
    # No original runtime bytes outside the .rsrc section have changed.
    assert new_bytes[:resource_start] == original[:resource_start]
    assert new_bytes[resource_start+resource_length:] == original[resource_start+resource_length:]
    for name,(offset,length) in sections.items():
        if name != '.rsrc' and new_bytes[offset:offset+length] != original[offset:offset+length]:
            raise ValueError(f'Non-resource section changed: {name}')
    old_strings = new_bytes[resource_start:resource_start+resource_length].count(old_unicode)
    new_strings = new_bytes[resource_start:resource_start+resource_length].count(new_unicode)
    if old_strings != 0 or new_strings != 2:
        raise ValueError('Incorrect updated resource version strings.')
    updated = struct.unpack_from('<13I', new_bytes, at)
    if (updated[2],updated[3],updated[4],updated[5]) != new_parts*2:
        raise ValueError('Numeric version verification failed.')
    exe_path.write_bytes(new_bytes)
    return {
        'original_exe_sha256': hashlib.sha256(original).hexdigest(),
        'updated_exe_sha256': hashlib.sha256(new_bytes).hexdigest(),
        'version_strings_changed': len(matches),
        'numeric_version_values_changed': sum(1 for a, b in zip(old_parts*2, new_parts*2) if a != b),
        'runtime_sections_unchanged': True,
    }


def package(base, output):
    source_pkg = json.loads((ROOT/'package.json').read_text())
    if source_pkg['version'] != NEW:
        raise ValueError('Source package version does not match expected release.')
    with tempfile.TemporaryDirectory(prefix='picomarq-windows-') as tmp:
        tmp = Path(tmp)
        with zipfile.ZipFile(base) as z:
            names = z.namelist()
            for member in names:
                p = PurePosixPath(member)
                if not p.parts or p.parts[0] != 'PicoMarQ' or '..' in p.parts or p.is_absolute() or '\\' in member:
                    raise ValueError(f'Unsafe/malformed ZIP entry: {member}')
            if 'PicoMarQ/PicoMarQ.exe' not in names:
                raise ValueError('Baseline portable ZIP is missing PicoMarQ.exe')
            z.extractall(tmp)
        win = tmp/'PicoMarQ'
        app = win/'resources/app'
        prior = json.loads((app/'package.json').read_text())
        if prior.get('version') != OLD:
            raise ValueError(f'Baseline app must be {OLD}')
        # Replace renderer and desktop app with the exact supplied source version.
        for directory in ('dist','desktop'):
            shutil.rmtree(app/directory)
            shutil.copytree(ROOT/directory,app/directory)
        for filename in ('LICENSE','THIRD-PARTY-NOTICES.txt','app.ico'):
            shutil.copy2(ROOT/filename,app/filename)
        (app/'package.json').write_text(json.dumps({
            'name': source_pkg['name'],
            'productName': source_pkg['productName'],
            'version': NEW,
            'main': source_pkg['main'],
        },indent=2)+'\n')
        for name,src in {
            'START-HERE.txt': 'START-HERE.txt',
            'KEYBOARD-SHORTCUTS.md':'docs/KEYBOARD-SHORTCUTS.md',
            'APP-LICENSE.txt':'LICENSE',
            'THIRD-PARTY-NOTICES.txt':'THIRD-PARTY-NOTICES.txt',
        }.items():
            shutil.copy2(ROOT/src,win/name)
        verification = update_version_resource(win/'PicoMarQ.exe')
        (win/'RELEASE-VALIDATION.txt').write_text(
            'PicoMarQ 1.3.2 portable Windows release\n\n'
            'Assembled from the PicoMarQ 1.3.1 portable release. Its Electron\n'
            '44.6.0 x64 runtime is unchanged; the application files in\n'
            'resources\\app are replaced with PicoMarQ 1.3.2, and the version\n'
            'information of PicoMarQ.exe changes from 1.3.1 to 1.3.2 (two\n'
            'strings and two numbers of the fixed version record). No\n'
            'other bytes of the executable or the runtime files change.\n\n'
            'The 1.3.2 renderer is compiled from the 1.3.2 source (npm ci,\n'
            'npm run build). Tested on Linux with the same Electron 44.6.0:\n'
            'unit tests, Chromium browser checks, and the desktop, typography,\n'
            'startup, close, settings, spelling, word-count, Ignore All,\n'
            'dictionary and Find checks (see VALIDATION.md in the source\n'
            'package). Not run on Windows here; this unsigned build should be\n'
            'checked on Windows 10/11.\n\n'
            f'Baseline executable SHA-256: {verification["original_exe_sha256"]}\n'
            f'Updated executable SHA-256:  {verification["updated_exe_sha256"]}\n'
        )
        if json.loads((app/'package.json').read_text())['version'] != NEW:
            raise AssertionError('App metadata version mismatch')
        output.parent.mkdir(parents=True,exist_ok=True)
        if output.exists():
            output.unlink()
        with zipfile.ZipFile(output,mode='w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
            for item in sorted(win.rglob('*')):
                if item.is_file():
                    z.write(item,arcname=Path('PicoMarQ')/item.relative_to(win))
        with zipfile.ZipFile(output) as z:
            corrupt = z.testzip()
            if corrupt:
                raise ValueError(f'Archive CRC failure: {corrupt}')
            assert json.loads(z.read('PicoMarQ/resources/app/package.json'))['version'] == NEW
            assert z.read('PicoMarQ/PicoMarQ.exe')[:2] == b'MZ'
        return verification

if __name__ == '__main__':
    if len(sys.argv) not in (2,3):
        raise SystemExit(__doc__)
    base = Path(sys.argv[1]).resolve()
    target = Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else ROOT/'release'/f'PicoMarQ-Windows-x64-{NEW}.zip'
    summary = package(base,target)
    print(f'Created: {target} ({target.stat().st_size:,} bytes)')
    print(json.dumps(summary,indent=2))
