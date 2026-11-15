"""Zeichnet das Weihnachts-Icon (Tannengruen, goldenes "JB", Schneehaube).

Aufruf im Repo-Wurzelverzeichnis:  python tools/make-xmas-icons.py
Schreibt nach icons/xmas/: icon-192.png, icon-512.png, icon-maskable-512.png

Das normale Icon erzeugt tools/make-icons.ps1. Wann welches Icon gilt,
regelt tools/saison-icon.mjs.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons", "xmas")
FONT = "C:/Windows/Fonts/segoeuib.ttf"   # Segoe UI Bold, wie im normalen Icon
S = 4                                    # Ueberabtastung fuer glatte Kanten
N = 512 * S
GOLD = (202, 166, 74)
GREEN_TOP, GREEN_BOT = (22, 92, 60), (9, 44, 30)
FLAKES = [(70, 150, 7, 230), (440, 170, 6, 220), (95, 390, 6, 200), (420, 400, 8, 230), (250, 440, 5, 190),
          (455, 290, 5, 180), (55, 270, 5, 180), (180, 135, 4, 170), (345, 125, 4, 170)]


def gradient(c1, c2):
    """Diagonaler Verlauf von oben links (c1) nach unten rechts (c2)."""
    m = Image.new("L", (N, N))
    d = ImageDraw.Draw(m)
    for i in range(2 * N):
        d.line([(i, 0), (0, i)], fill=int(255 * i / (2 * N)), width=2)
    return Image.composite(Image.new("RGB", (N, N), c2), Image.new("RGB", (N, N), c1), m).convert("RGBA")


def border(img):
    lay = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    i = 10 * S
    ImageDraw.Draw(lay).rounded_rectangle([i, i, N - i, N - i], radius=int(N * 0.22) - i,
                                          outline=GOLD + (150,), width=6 * S)
    img.alpha_composite(lay)


def flakes(img, scale=1.0):
    """Schneeflocken; scale < 1 rueckt sie zur Mitte (sichere Zone des maskierbaren Icons)."""
    for (x, y, r, a) in FLAKES:
        x, y = 256 + (x - 256) * scale, 256 + (y - 256) * scale
        lay = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        ImageDraw.Draw(lay).ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=(255, 255, 255, a))
        img.alpha_composite(lay)


def text(img, size, dy):
    f = ImageFont.truetype(FONT, int(N * size))
    ImageDraw.Draw(img).text((N / 2, N / 2 + dy * S), "JB", font=f, fill=GOLD + (255,), anchor="mm")


def snowcap(img, depth):
    """Schneehaube am oberen Rand; depth = ungefaehre Tiefe in 512er-Einheiten."""
    rnd = random.Random(3)
    lay = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    base = depth * S * 0.55
    d.rectangle([0, 0, N, base], fill=(255, 255, 255, 255))
    x = -40 * S
    while x < N + 40 * S:
        r = rnd.randint(34, 62) * S
        cy = base + rnd.randint(-6, 14) * S
        d.ellipse([x - r, cy - r * 0.8, x + r, cy + r * 0.8], fill=(255, 255, 255, 255))
        x += r * rnd.uniform(1.0, 1.4)
    shadow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    shadow.paste((10, 30, 40, 90), (0, 6 * S), lay.split()[3])
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5 * S)))
    img.alpha_composite(lay)


def any_icon():
    """Abgerundetes Icon mit durchsichtigen Ecken (purpose "any")."""
    img = gradient(GREEN_TOP, GREEN_BOT)
    border(img)
    flakes(img)
    text(img, 0.42, 22)
    snowcap(img, 70)
    mask = Image.new("L", (N, N), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=255)
    img.putalpha(ImageChops.multiply(img.split()[3], mask))
    return img


def maskable_icon():
    """Randlos, ohne Rahmen. Android schneidet aussen ab, deshalb sitzt alles
    Wichtige in der Mitte und die Schneehaube reicht tiefer."""
    img = gradient(GREEN_TOP, GREEN_BOT)
    flakes(img, 0.74)
    text(img, 0.33, 26)
    snowcap(img, 132)
    return img.convert("RGB")


def save(img, size, name):
    path = os.path.join(OUT, name)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print("Erzeugt: %s (%dx%d, %d Bytes)" % (path, size, size, os.path.getsize(path)))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    a = any_icon()
    save(a, 192, "icon-192.png")
    save(a, 512, "icon-512.png")
    save(maskable_icon(), 512, "icon-maskable-512.png")
