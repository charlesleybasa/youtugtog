#!/usr/bin/env python3
"""
Generates the Play Store feature graphic (1024x500).

The previous version paired the play-triangle mark with the wordmark set in two
tones — "You" in orange fading to "tugtog" in pink — which mirrored YouTube's
own You/Tube lockup. Both are gone: this uses the new sun mark and sets the
wordmark in a single continuous gradient.

Run from the repo root, after make-icon.py:
    python3 assets/make-feature-graphic.py
"""

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1024, 500
SS = 3  # supersample

GRAD_FROM = (255, 138, 43)  # --accent-soft
GRAD_TO = (245, 49, 127)  # --accent
BG_FROM = (246, 248, 253)
BG_TO = (223, 229, 242)
MUTED = (95, 101, 128)  # --text-muted

FONT = "/System/Library/Fonts/Avenir Next.ttc"
FONT_HEAVY = 8  # face index
FONT_DEMI = 2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def linear_gradient(size, c0, c1):
    """Diagonal gradient, top-left to bottom-right."""
    w, h = size
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))
    return small.resize((w, h), Image.BICUBIC)


def main():
    w, h = W * SS, H * SS
    img = linear_gradient((w, h), BG_FROM, BG_TO).convert("RGBA")

    # A soft brand-coloured glow behind the mark, so the tile does not float on
    # flat grey. Blurred well past the tile edge to stay subtle.
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gcx, gcy, gr = 255 * SS, 250 * SS, 185 * SS
    gd.ellipse((gcx - gr, gcy - gr, gcx + gr, gcy + gr), fill=GRAD_TO + (46,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(70 * SS)))

    # Mark
    tile = 268 * SS
    icon = Image.open(os.path.join(ROOT, "assets", "icon.png")).convert("RGBA")
    icon = icon.resize((tile, tile), Image.LANCZOS)
    img.alpha_composite(icon, (121 * SS, (h - tile) // 2))

    # Wordmark, filled with the brand gradient through a text mask. The gradient
    # is mapped to the word's own bounding box rather than the whole canvas, so
    # the full orange-to-magenta sweep lands across the letters — the same
    # treatment `.brand-text` gives the wordmark in the app (src/index.css).
    word_font = ImageFont.truetype(FONT, 122 * SS, index=FONT_HEAVY)
    tag_font = ImageFont.truetype(FONT, 42 * SS, index=FONT_DEMI)

    text_x, baseline = 452 * SS, 194 * SS
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).text((text_x, baseline), "Tugtog", font=word_font,
                              fill=255, anchor="ls")

    bx0, by0, bx1, by1 = mask.getbbox()
    word_grad = Image.new("RGB", (w, h), GRAD_TO)
    word_grad.paste(linear_gradient((bx1 - bx0, by1 - by0), GRAD_FROM, GRAD_TO),
                    (bx0, by0))
    img.paste(word_grad, (0, 0), mask)

    ImageDraw.Draw(img).text((text_x + 5 * SS, 266 * SS), "Tugtog Pinoy anytime",
                             font=tag_font, fill=MUTED + (255,), anchor="ls")

    out = os.path.join(ROOT, "store-listing", "feature-graphic-1024x500.png")
    img.resize((W, H), Image.LANCZOS).convert("RGB").save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
