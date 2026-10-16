"""Generates macos/icon.icns used for the .app bundle/Dock icon.

Run once during the build (see build.sh) so there's no hand-authored
binary asset checked into the repo - just a small script that draws a
simple checklist icon with Pillow. Pillow's ICNS writer works on any OS
(only *opening* .icns files needs to happen on a Mac), so this doesn't need
to run on a Mac either - though the rest of the macOS build does.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUTPUT_PATH = Path(__file__).resolve().parent / "icon.icns"


def make_icon_image(size=1024):
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
    sizes = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]
    image.save(OUTPUT_PATH, format="ICNS", sizes=sizes)
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
