"""Archive the clean portable output and verify every ZIP entry before delivery.

输入是 `node desktop/scripts/build-dist.mjs` 产出的目录，入口名以 BUILD-MANIFEST.json 的 entry 为准
（壳改名时不需要动这里）。
"""
import hashlib
import json
import os
from pathlib import Path
import zipfile

desktop = Path(__file__).resolve().parents[1]
version = json.loads((desktop / 'package.json').read_text(encoding='utf-8'))['version']
release = Path(os.environ['ZVIEWER_OUT_DIR']).resolve() if os.environ.get('ZVIEWER_OUT_DIR') else desktop / 'dist-gui'
portable = release / 'zviewer-windows-x64-GUI'
archive = release / 'zviewer-windows-x64-GUI.zip'
manifest_file = portable / 'BUILD-MANIFEST.json'
if not manifest_file.is_file():
    raise SystemExit('Build the portable application first (node scripts/build-dist.mjs)')
manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
entry_name = manifest['entry']
entry = portable / entry_name
if archive.exists():
    raise SystemExit(f'Archive already exists: {archive}')
files = sorted(p for p in portable.rglob('*') if p.is_file())
if not entry.is_file():
    raise SystemExit(f'Missing entry point: {entry_name}')
if sorted(file.name for file in portable.glob('*.exe')) != [entry_name]:
    raise SystemExit(f'The distribution must have exactly one top-level EXE entry ({entry_name})')
for file in files:
    if file.is_symlink() or file.suffix.lower() in {'.bat', '.cmd'} or file.name.lower() in {'.env', 'settings.json', 'key.pem', 'root-ca.key'}:
        raise SystemExit(f'Unexpected private file or link: {file}')
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as output:
    for file in files:
        output.write(file, file.relative_to(release).as_posix())
with zipfile.ZipFile(archive) as output:
    failure = output.testzip()
    if failure:
        raise SystemExit(f'ZIP CRC verification failed: {failure}')
def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
checksums = [(sha256(file), file.relative_to(release).as_posix()) for file in [archive, entry]]
checksum_file = release / 'SHA256SUMS.txt'
existing = checksum_file.read_text(encoding='ascii').splitlines() if checksum_file.exists() else []
names = {name for _, name in checksums}
existing = [line for line in existing if line.split('  ', 1)[-1] not in names]
checksum_file.write_text('\n'.join(existing + [f'{digest}  {name}' for digest, name in checksums]) + '\n', encoding='ascii')
print(json.dumps({'archive': str(archive), 'version': version, 'bytes': archive.stat().st_size, 'files': len(files), 'crc': 'passed', 'sha256': checksums[0][0]}, indent=2))
