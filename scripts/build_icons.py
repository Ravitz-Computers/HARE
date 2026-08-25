#!/usr/bin/env python3
"""
Generates every app icon HARE needs from the Vinny artwork.

Three different pictures, because three different jobs:

  build/icon-source.png       Vinny in the RGB strip badge. The app icon —
                              desktop shortcut, Explorer, the .exe itself.
  build/tray-source.png       The black-and-white outline variant. The system
                              tray, where an icon is 16-32px on an unknown
                              background and detail turns to mush.
  build/icon-source.png       ...is also the fallback for the tray if no
                              outline art is present, so this script still
                              works with a single image.

Re-run this whenever the artwork changes:

    python3 scripts/build_icons.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
SOURCE = BUILD_DIR / "icon-source.png"
TRAY_SOURCE = BUILD_DIR / "tray-source.png"

# The largest size Windows asks for, and so the smallest source worth having.
ICON_TARGET = 256


def load_square(path: Path) -> Image.Image:
    """Loads an image and pads it to a square, so no generated size is distorted."""
    image = Image.open(path).convert("RGBA")
    if image.width == image.height:
        return image
    side = max(image.width, image.height)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(image, ((side - image.width) // 2, (side - image.height) // 2), image)
    return square


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing master logo at {SOURCE} — copy the Ravitz Computers logo there first.")

    src = load_square(SOURCE)

    # Windows shows this at 256px in Explorer's largest view, and the .ico
    # needs a real 256 frame. Art smaller than that has to be enlarged, which
    # is visibly soft — so say so rather than shipping a blurry icon quietly.
    if src.width < ICON_TARGET:
        print(
            f"  NOTE: the icon artwork is only {src.width}px. Windows wants {ICON_TARGET}px for its\n"
            f"        largest icon view, so it will be enlarged and will look soft there.\n"
            f"        Supply build/icon-source.png at {ICON_TARGET}px or more for a crisp icon."
        )
        src = src.resize((ICON_TARGET, ICON_TARGET), Image.LANCZOS)

    # Main app icon (used in-app on Linux/dev, and as the electron-builder source for macOS/Linux targets).
    icon_png = src if src.width <= 1024 else src.resize((1024, 1024), Image.LANCZOS)
    icon_png.save(BUILD_DIR / "icon.png")

    # Windows .ico needs several embedded resolutions. bitmap_format="bmp" is
    # deliberate, not Pillow's default: left unset, Pillow PNG-compresses
    # every embedded size, including the small ones (16/24/32/48px) that the
    # Windows taskbar and Explorer actually use day-to-day. Modern Windows
    # *can* read PNG-compressed small icon frames, but it's a known source of
    # icons rendering blank in the taskbar/shell on some Windows versions and
    # after some icon-cache states — classic uncompressed BMP/DIB frames are
    # what every Windows version has always reliably supported, and it's what
    # professional icon tools (e.g. the standard icoutils) produce. There's no
    # downside to it here (a 256x256 BMP frame is perfectly valid — the ICO
    # format's "0 means 256" width/height encoding handles it), so there's no
    # reason to use the riskier PNG path.
    # Pillow silently drops any frame larger than the source image, so a small
    # source produces an .ico that just stops at 128 — which is how the app
    # icon quietly got worse once. Sizes are filtered explicitly instead, and
    # the source above is already enlarged to the target, so all of these are
    # present.
    ico_sizes = [
        size for size in [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        if size[0] <= icon_png.width
    ]
    icon_png.save(BUILD_DIR / "icon.ico", sizes=ico_sizes, bitmap_format="bmp")
    print(f"  icon.ico frames: {', '.join(str(s[0]) for s in ico_sizes)}")

    # System tray icon. A separate, simplified source when one exists: at
    # 16-32px against a taskbar whose colour the app doesn't control, a
    # detailed full-colour badge becomes an unreadable smudge, which is
    # exactly what the outline variant of the artwork is for.
    tray_source = TRAY_SOURCE if TRAY_SOURCE.exists() else SOURCE
    tray = load_square(tray_source).resize((32, 32), Image.LANCZOS)
    tray.save(BUILD_DIR / "trayTemplate.png")

    which = "tray-source.png" if TRAY_SOURCE.exists() else "icon-source.png (no outline art supplied)"
    print(f"Wrote icon.png, icon.ico to {BUILD_DIR}")
    print(f"Wrote trayTemplate.png from {which}")


if __name__ == "__main__":
    main()
