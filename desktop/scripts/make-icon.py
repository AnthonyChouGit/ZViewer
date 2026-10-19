"""Convert the approved avatar into a native multi-frame Windows DIB icon."""
from pathlib import Path
from PIL import Image
import io
import struct

base = Path(__file__).resolve().parents[1]
source = Image.open(base / 'ui' / 'app-icon.png').convert('RGBA')
sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
frames = []
for size in sizes:
    image = source.resize((size, size), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format='BMP')
    dib = bytearray(out.getvalue()[14:])
    struct.pack_into('<i', dib, 8, size * 2)
    mask = bytes(((size + 31) // 32) * 4 * size)
    frames.append(bytes(dib) + mask)
offset = 6 + 16 * len(sizes)
entries = []
for size, frame in zip(sizes, frames):
    entries.append(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(frame), offset))
    offset += len(frame)
target = base / 'assets' / 'app.ico'
target.parent.mkdir(exist_ok=True)
target.write_bytes(struct.pack('<HHH', 0, 1, len(frames)) + b''.join(entries) + b''.join(frames))
print(target)
