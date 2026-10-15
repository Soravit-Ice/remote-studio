"""Regenerate checked-in app icons from Remote-studio-icon.png on macOS.
Requires Pillow and Apple's iconutil. Release builds consume the generated files.
"""
from pathlib import Path
import subprocess
from PIL import Image

root = Path(__file__).resolve().parent.parent
source = Image.open(root / "Remote-studio-icon.png").convert("RGBA")
if source.width != source.height or source.width < 1024:
    raise ValueError("Use a square original of at least 1024 pixels.")

def resized(size):
    return source.resize((size, size), Image.Resampling.LANCZOS)

resized(1024).save(root / "resources/icon.png")
resized(256).save(root / "apps/desktop/src/assets/remote-studio-icon.png")
for size in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        suffix = "@2x" if scale == 2 else ""
        resized(size * scale).save(root / f"resources/icon.iconset/icon_{size}x{size}{suffix}.png")
source.save(root / "resources/icon.ico", format="ICO", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
subprocess.run(["iconutil", "-c", "icns", str(root / "resources/icon.iconset"), "-o", str(root / "resources/icon.icns")], check=True)
