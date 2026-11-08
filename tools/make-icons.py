#!/usr/bin/env python3
"""Draws the desktop app icons (the watcher-eye of Abyssal Stride) into desktop/icons/.

  python3 tools/make-icons.py      (needs Pillow)

Outputs icon.png (512 px, Linux and the window), icon.ico (Windows, multi-size) and icon.icns (macOS).
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'desktop', 'icons')
N = 1024
CRIMSON = (179, 18, 42)
GOLD = (201, 164, 90)
INK = (9, 6, 10)


def background():
    """Rounded square with a dark radial gradient."""
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    grad = Image.new('RGBA', (N, N))
    px = grad.load()
    for y in range(N):
        for x in range(N):
            d = math.hypot(x - N * 0.5, y - N * 0.46) / (N * 0.72)
            t = min(1.0, d)
            r = int(44 * (1 - t) + 5 * t)
            g = int(18 * (1 - t) + 3 * t)
            b = int(30 * (1 - t) + 6 * t)
            px[x, y] = (r, g, b, 255)
    mask = Image.new('L', (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, N - 1, N - 1), radius=210, fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def eye(img):
    """An eclipse: a black disc ringed by a crimson corona with rays, and a glowing slit pupil."""
    cx, cy = N * 0.5, N * 0.5
    rays = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rays)
    for i in range(18):
        a = i * math.tau / 18
        inner, outer = 292, 430 if i % 2 == 0 else 378
        rd.line([(cx + math.cos(a) * inner, cy + math.sin(a) * inner),
                 (cx + math.cos(a) * outer, cy + math.sin(a) * outer)], fill=CRIMSON + (255,), width=14)
    rays = rays.filter(ImageFilter.GaussianBlur(5))
    glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((cx - 330, cy - 330, cx + 330, cy + 330), fill=CRIMSON + (230,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(60)))
    img.alpha_composite(rays)
    d = ImageDraw.Draw(img)
    r = 280
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=INK + (255,), outline=GOLD + (255,), width=10)
    slit = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(slit).ellipse((cx - 58, cy - 210, cx + 58, cy + 210), fill=CRIMSON + (255,))
    img.alpha_composite(slit.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(img)
    d.ellipse((cx - 40, cy - 190, cx + 40, cy + 190), fill=(255, 196, 170, 255))
    d.ellipse((cx - 22, cy - 170, cx + 22, cy - 120), fill=(255, 248, 235, 255))


def main():
    os.makedirs(OUT, exist_ok=True)
    img = background()
    eye(img)
    final = img.resize((512, 512), Image.LANCZOS)
    final.save(os.path.join(OUT, 'icon.png'))
    img.save(os.path.join(OUT, 'icon-1024.png'))
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    final.save(os.path.join(OUT, 'icon.ico'), sizes=sizes)
    try:
        final.save(os.path.join(OUT, 'icon.icns'))
    except Exception as e:  # Pillow without icns support: electron-builder can convert the PNG on macOS
        print('icns skipped:', e)
    print('icons written to', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
