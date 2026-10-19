#!/usr/bin/env python3
"""Pack a webxdc app folder into a .xdc (a zip), reproducibly: sorted entries, fixed timestamps."""
import sys, zipfile, pathlib
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(p for p in src.rglob('*') if p.is_file() and not p.name.startswith('.')):
        info = zipfile.ZipInfo(str(f.relative_to(src)), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o644 << 16
        z.writestr(info, f.read_bytes())
print(f'{out} ({out.stat().st_size} bytes)')
