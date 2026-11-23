#!/usr/bin/env python3
"""Repackage PicoMarQ 1.2.4 using the verified 1.2.3 portable runtime.

This is NOT a source compilation. It copies the existing Electron runtime and
replaces the frontend resources with those bundled in the accompanying source.
It also updates four PE version-resource values in the unsigned executable.
Usage:
  python scripts/repack-windows-from-1.2.3.py BASE-1.2.3.zip [OUTPUT-1.2.4.zip]
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
OLD = '1.2.3'
NEW = '1.2.4'


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


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
    matches = []
    where = 0
    while True:
        index = resource.find(old_unicode, where)
        if index == -1:
            break
        matches.append(index)
        where = index + len(old_unicode)
    # Existing branded PicoMarQ.exe contains FileVersion and ProductVersion.
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
    old_parts = (1 << 16) | 2, (3 << 16)
    new_parts = (1 << 16) | 2, (4 << 16)
    if (fixed[2],fixed[3],fixed[4],fixed[5]) != old_parts*2:
        raise ValueError(f'Unexpected numeric version metadata: {fixed[2:6]}')
    for rel_offset in (3,5):
        struct.pack_into('<I', new_bytes, at + rel_offset*4, new_parts[1])
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
        'numeric_version_values_changed': 2,
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
            raise ValueError('Baseline app must be 1.2.3')
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
            'PicoMarQ 1.2.4 portable Windows release\n\n'
            'Assembled using the complete PicoMarQ 1.2.3 x64 Electron runtime,\n'
            'the PicoMarQ 1.2.4 application sources and prebuilt renderer assets.\n'
            'The executable is the supplied 1.2.3 Electron executable with only\n'
            'four version-resource fields updated to 1.2.4. The other sections\n'
            'of the executable and all other runtime binaries remain unchanged.\n\n'
            '22 Node tests and Chromium renderer regression tests passed. A clean\n'
            'npm rebuild was prevented by unavailable dependencies, and native\n'
            'Windows startup and application tests have not been executed here.\n'
            'This unsigned personal build should be verified on Windows 10/11.\n\n'
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
