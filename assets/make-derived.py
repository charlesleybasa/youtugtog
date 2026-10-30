#!/usr/bin/env python3
"""
Resizes the masters produced by make-icon.py into every size the app ships:
Android launcher mipmaps, Android splash screens, the PWA/favicon set, and the
Play Store hi-res icon. Each target keeps the dimensions it already had.

Run from the repo root, after make-icon.py:
    python3 assets/make-derived.py
"""
import glob, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda *p: os.path.join(ROOT, *p)

icon = Image.open(R("assets", "icon.png")).convert("RGBA")
fg = Image.open(R("assets", "icon-foreground.png")).convert("RGBA")
bg = Image.open(R("assets", "icon-background.png")).convert("RGBA")

SPLASH_MARK_FRAC = 0.20          # matches the previous splash composition
SPLASH_LIGHT = (255, 255, 255)
SPLASH_DARK = (17, 17, 17)


def fit(src, size):
    return src.resize((size, size), Image.LANCZOS)


def round_mask(size):
    m = Image.new("L", (size, size), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


count = 0
for path in sorted(glob.glob(R("android/app/src/main/res/mipmap-*/*.png"))):
    w, _ = Image.open(path).size
    name = os.path.basename(path)
    if name == "ic_launcher.png":
        out = fit(icon, w)
    elif name == "ic_launcher_round.png":
        out = Image.new("RGBA", (w, w), (0, 0, 0, 0))
        out.paste(fit(icon, w), (0, 0), round_mask(w))
    elif name == "ic_launcher_foreground.png":
        out = fit(fg, w)
    elif name == "ic_launcher_background.png":
        out = fit(bg, w)
    else:
        continue
    out.save(path)
    count += 1
print("android launcher icons:", count)

count = 0
for path in sorted(glob.glob(R("android/app/src/main/res/drawable*/splash.png"))):
    w, h = Image.open(path).size
    dark = "night" in path
    canvas = Image.new("RGBA", (w, h), (SPLASH_DARK if dark else SPLASH_LIGHT) + (255,))
    m = round(min(w, h) * SPLASH_MARK_FRAC)
    canvas.paste(fit(icon, m), ((w - m) // 2, (h - m) // 2), fit(icon, m))
    canvas.convert("RGB").save(path)
    count += 1
print("android splashes:", count)

for rel, size in [
    ("public/icon-512.png", 512),
    ("public/icon-192.png", 192),
    ("public/apple-touch-icon.png", 180),
    ("public/favicon-32.png", 32),
    ("public/favicon-16.png", 16),
]:
    fit(icon, size).save(R(rel))
print("web icons: 5")

fit(icon, 512).convert("RGB").save(R("store-listing/icon-512.png"))
print("store icon: 1")
