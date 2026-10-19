"""Archive the clean portable output and verify every ZIP entry before delivery."""
import hashlib
import json
from pathlib import Path
import zipfile

desktop = Path(__file__).resolve().parents[1]
version = json.loads((desktop / 'package.json').read_text(encoding='utf-8'))['version']
release = desktop / 'release'
portable = release / 'ZViewer-win32-x64'
archive = release / f'ZViewer-Windows-GUI-v{version}-x64.zip'
if archive.exists():
    raise SystemExit(f'Archive already exists: {archive}')
files = sorted(p for p in portable.rglob('*') if p.is_file())
if not (portable / 'ZViewer.exe').is_file():
    raise SystemExit('Build the portable application first')
for file in files:
    if file.is_symlink() or file.name.lower() in {'.env', 'settings.json', 'key.pem', 'root-ca.key'}:
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
checksums = [(sha256(file), file.relative_to(release).as_posix()) for file in [archive, portable / 'ZViewer.exe']]
(release / 'SHA256SUMS.txt').write_text(''.join(f'{digest}  {name}\n' for digest, name in checksums), encoding='ascii')
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'files': len(files), 'crc': 'passed', 'sha256': checksums[0][0]}, indent=2))
