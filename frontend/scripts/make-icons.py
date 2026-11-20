"""Draw the home-screen icons into public/ (run once: `python scripts/make-icons.py`).

A white briefcase with a check on the app's indigo. Drawn from shapes,
so there is no source image or font to keep. The glyph sits inside the middle
60% of the square, which is the safe zone for Android's "maskable" icons, so
the same drawing serves every size.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public"
BACKGROUND = (79, 70, 229)  # the app's indigo
INK = (255, 255, 255)
SCALE = 4  # draw big, shrink for smooth edges


def icon(size: int) -> Image.Image:
    n = size * SCALE
    img = Image.new("RGB", (n, n), BACKGROUND)
    d = ImageDraw.Draw(img)
    u = n / 100  # one percent of the side

    # Handle, then the case over it.
    d.rounded_rectangle((40 * u, 27 * u, 60 * u, 43 * u), radius=4 * u, outline=INK, width=round(4.5 * u))
    d.rounded_rectangle((22 * u, 36 * u, 78 * u, 74 * u), radius=7 * u, fill=INK)
    # The check: "this one is handled".
    d.line(
        [(39 * u, 55 * u), (47 * u, 63 * u), (62 * u, 47 * u)],
        fill=BACKGROUND,
        width=round(5.5 * u),
        joint="curve",
    )
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, size in [
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("icon-maskable.png", 512),
        ("apple-touch-icon.png", 180),
    ]:
        icon(size).save(OUT / name, optimize=True)
        print(name)


if __name__ == "__main__":
    main()
