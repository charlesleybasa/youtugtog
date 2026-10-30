#!/usr/bin/env python3
"""
Generates the Tugtog app mark: a Philippine sun with a music note at its centre,
on a rounded-square tile in the brand gradient.

Deliberately NOT a play triangle. The previous mark was a gradient play-button
silhouette, which Google Play cited under the Impersonation policy — a play
triangle reads as both the YouTube and the Google Play logo. The shape of the
tile is what keeps this mark distinct; the motif and palette are unchanged.

Outputs (all 1024x1024, supersampled 4x then downsampled):
    assets/icon.png             full mark on the rounded tile  (store / web source)
    assets/icon-background.png  full-bleed gradient            (Android adaptive)
    assets/icon-foreground.png  sun + note, transparent        (Android adaptive)

Run from the repo root:
    python3 assets/make-icon.py
Then regenerate the derived sizes:
    npx @capacitor/assets generate --android
"""

import math
import os

from PIL import Image, ImageDraw

OUT = 1024
SS = 4  # supersample factor
S = OUT * SS

GRAD_FROM = (255, 138, 43)  # --accent-soft #ff8a2b
GRAD_TO = (245, 49, 127)  # --accent      #f5317f

# Geometry, as fractions of the canvas edge, measured from the canvas centre.
TILE_RADIUS = 0.225  # rounded-square corner radius
DISC_R = 0.196  # white centre disc
RAY_INNER = 0.140  # rays start inside the disc so there is no seam
RAY_MAIN_R = 0.422
RAY_MINOR_R = 0.302
RAY_MAIN_HALF = 13.0  # degrees
RAY_MINOR_HALF = 4.6
RAY_MINOR_OFFSET = 16.5
NOTE_SCALE = 0.92  # keeps the note clear of the disc edge


def gradient(size):
    """Diagonal brand gradient, top-left to bottom-right."""
    small = 64
    g = Image.new("RGB", (small, small))
    px = g.load()
    for y in range(small):
        for x in range(small):
            t = (x + y) / (2 * (small - 1))
            px[x, y] = tuple(
                round(a + (b - a) * t) for a, b in zip(GRAD_FROM, GRAD_TO)
            )
    return g.resize((size, size), Image.BICUBIC)


def rounded_tile_mask(size):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(TILE_RADIUS * size), fill=255
    )
    return m


def ray(cx, cy, size, angle_deg, half_deg, inner, outer):
    """One tapered sun ray: a wedge base at `inner`, a single point at `outer`."""
    a = math.radians(angle_deg)
    h = math.radians(half_deg)
    return [
        (cx + math.cos(a - h) * inner * size, cy + math.sin(a - h) * inner * size),
        (cx + math.cos(a) * outer * size, cy + math.sin(a) * outer * size),
        (cx + math.cos(a + h) * inner * size, cy + math.sin(a + h) * inner * size),
    ]


def sun_mask(size, scale=1.0):
    """White Philippine sun: 8 main rays, 16 minor, and the centre disc."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    cx = cy = size / 2

    for k in range(8):
        base = k * 45.0 - 90.0
        d.polygon(
            ray(cx, cy, size, base, RAY_MAIN_HALF, RAY_INNER * scale, RAY_MAIN_R * scale),
            fill=255,
        )
        for off in (-RAY_MINOR_OFFSET, RAY_MINOR_OFFSET):
            d.polygon(
                ray(
                    cx, cy, size, base + off, RAY_MINOR_HALF,
                    RAY_INNER * scale, RAY_MINOR_R * scale,
                ),
                fill=255,
            )

    r = DISC_R * scale * size
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    return m


def quad(p0, p1, p2, n=48):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def note_mask(size, scale=1.0):
    """An eighth note, centred on the canvas, in canvas-fraction coordinates."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    cx = cy = size / 2
    k = NOTE_SCALE * scale * size

    def pt(x, y):
        return (cx + x * k, cy + y * k)

    # Stem
    d.polygon([pt(0.028, -0.126), pt(0.049, -0.126), pt(0.049, 0.090), pt(0.028, 0.090)],
              fill=255)

    # Flag: the area between two quadratic curves off the top of the stem.
    outer = quad((0.049, -0.126), (0.151, -0.086), (0.100, 0.012))
    inner = quad((0.049, -0.058), (0.105, -0.050), (0.100, 0.012))
    d.polygon([pt(*p) for p in outer] + [pt(*p) for p in reversed(inner)], fill=255)

    # Head: an ellipse drawn upright on its own tile, then rotated.
    rx, ry = 0.074 * k, 0.056 * k
    pad = round(max(rx, ry) * 2.4)
    head = Image.new("L", (pad, pad), 0)
    ImageDraw.Draw(head).ellipse(
        (pad / 2 - rx, pad / 2 - ry, pad / 2 + rx, pad / 2 + ry), fill=255
    )
    head = head.rotate(20, resample=Image.BICUBIC)
    hx, hy = pt(-0.040, 0.082)
    m.paste(head, (round(hx - pad / 2), round(hy - pad / 2)), head)

    return m


def compose(size, tile=True, sun=True, scale=1.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = gradient(size)

    if tile:
        img.paste(grad, (0, 0), rounded_tile_mask(size))

    if sun:
        white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        img.paste(white, (0, 0), sun_mask(size, scale))
        # The note is punched out of the disc in the brand gradient.
        img.paste(grad, (0, 0), note_mask(size, scale))

    return img


def save(img, path):
    img.resize((OUT, OUT), Image.LANCZOS).save(path)
    print("wrote", path)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    a = lambda *p: os.path.join(root, *p)

    save(compose(S, tile=True, sun=True), a("assets", "icon.png"))

    bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg.paste(gradient(S), (0, 0))
    save(bg, a("assets", "icon-background.png"))

    # Adaptive foreground: the launcher XML already insets by 16.7%, so the art
    # is drawn at 70% here to land inside the 66% safe circle after that inset.
    save(compose(S, tile=False, sun=True, scale=0.70),
         a("assets", "icon-foreground.png"))


if __name__ == "__main__":
    main()
