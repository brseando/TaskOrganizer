"""Generates windows/icon.ico used for the exe/taskbar icon.

Run once during the build (see build.bat) so there's no hand-authored
binary asset checked into the repo - just a small script that draws a
simple checklist icon with Pillow.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUTPUT_PATH = Path(__file__).resolve().parent / "icon.ico"


def make_icon_image(size=256):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = size // 16
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=size // 5,
        fill=(37, 99, 235, 255),
    )
    line_x0 = size // 4
    line_x1 = size - size // 4
    line_width = max(2, size // 13)
    for fraction in (0.32, 0.5, 0.68):
        y = int(size * fraction)
        draw.line((line_x0, y, line_x1, y), fill=(255, 255, 255, 255), width=line_width)
    return image


def main():
    image = make_icon_image()
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    image.save(OUTPUT_PATH, format="ICO", sizes=sizes)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
