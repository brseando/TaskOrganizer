"""Draws the phone app's home-screen icons into mobile/web/icons/.

Same checklist design as windows/make_icon.py and macos/make_icon.py, but
square and edge-to-edge, because iOS and Android round the corners
themselves. The PNGs are checked in, so this only needs re-running after
changing the design. Needs Pillow (pip install -r requirements.txt).
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUTPUT_DIR = Path(__file__).resolve().parent / "web" / "icons"
BLUE = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)


def make_icon(size, line_span=0.5):
    """`line_span` is how much of the width the lines cover. Android's
    "maskable" icon can be cropped to a circle, so it uses shorter lines."""
    image = Image.new("RGBA", (size, size), BLUE)
    draw = ImageDraw.Draw(image)
    x0 = int(size * (1 - line_span) / 2)
    x1 = size - x0
    width = max(2, size // 13)
    for fraction in (0.32, 0.5, 0.68):
        y = int(size * fraction)
        draw.line((x0, y, x1, y), fill=WHITE, width=width)
    return image.convert("RGB")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = {
        "icon-192.png": make_icon(192),
        "icon-512.png": make_icon(512),
        "icon-maskable-512.png": make_icon(512, line_span=0.44),
        "apple-touch-icon.png": make_icon(180),
    }
    for name, image in outputs.items():
        image.save(OUTPUT_DIR / name, optimize=True)
        print(f"Wrote {OUTPUT_DIR / name}")


if __name__ == "__main__":
    main()
