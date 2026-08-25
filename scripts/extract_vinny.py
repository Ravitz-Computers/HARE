#!/usr/bin/env python3
"""
Cuts the individual Vinny assets out of the character sheet supplied by
Ravitz Computers.

Kept as a script rather than done once by hand so the artwork is
reproducible: if the sheet is ever revised, re-running this regenerates every
asset from it instead of someone re-cropping by eye and getting slightly
different edges.

    python3 scripts/extract_vinny.py path/to/character-sheet.pdf

Two things make this more than a crop:

**The sprites sit on a near-black backdrop**, and Vinny is a dark character
with black shading. A luminance threshold would punch holes straight through
him, so the background is removed by flood-filling inward from the edges —
only backdrop actually connected to the border is cleared.

**The sheet is a dense grid**, so a generous crop always catches a neighbour's
ear or a caption. After the cut-out, only the largest connected shape is kept,
which is the sprite the crop was aimed at.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src" / "assets" / "vinny"
BUILD = ROOT / "build"

# Boxes into the sheet's own 1536x1024 artwork, read off the layout.
# Generous on purpose: the largest-shape pass below tidies the edges.
REGIONS = {
    "badge-rgb": dict(box=(1358, 132, 1510, 302), solid=True, single=True),
    "mark-outline": dict(box=(1360, 452, 1510, 606), solid=False, single=True),
    # These two are poses with parts that don't touch the head — a raised
    # waving paw, hands held up under the chin. Keeping only the largest shape
    # amputated them, so anything of a reasonable size inside the crop is
    # kept, and the crop itself is drawn to exclude neighbours and captions.
    "hello": dict(box=(1118, 118, 1306, 318), solid=False, single=False),
    "love": dict(box=(852, 836, 976, 986), solid=False, single=False),
    # For the empty device list — Vinny looking for something is a friendlier
    # way to say "nothing found yet" than a bare line of text.
    "investigating": dict(box=(540, 356, 716, 566), solid=False, single=False),
}

# A fragment smaller than this share of the biggest shape is a caption
# serif or a neighbour's ear tip, not part of the pose.
FRAGMENT = 0.02

BACKDROP = 42


def sheet_from_pdf(pdf_path: Path) -> Image.Image:
    """Pulls the sheet's own raster out of the PDF rather than re-rendering the page."""
    import pymupdf

    doc = pymupdf.open(pdf_path)
    xref = doc[0].get_images(full=True)[0][0]
    data = doc.extract_image(xref)["image"]
    tmp = ROOT / "build" / ".vinny-sheet.png"
    tmp.write_bytes(data)
    image = Image.open(tmp).convert("RGBA")
    tmp.unlink(missing_ok=True)
    return image


def cut_out(crop: Image.Image, solid: bool, single: bool) -> Image.Image:
    rgb = np.array(crop.convert("RGB")).astype(np.int16)
    dark = (rgb.max(axis=2) <= BACKDROP)

    # Backdrop = dark pixels reachable from the border. Vinny's own blacks are
    # enclosed by his outline, so they survive.
    labels, _ = ndimage.label(dark)
    border = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border.discard(0)
    backdrop = np.isin(labels, list(border))

    subject = ~backdrop
    parts, count = ndimage.label(subject)
    if count > 1:
        sizes = ndimage.sum(subject, parts, range(1, count + 1))
        biggest = int(np.argmax(sizes)) + 1
        if single:
            subject = parts == biggest
        else:
            # Everything substantial, so a pose keeps its detached paws.
            keep = [i + 1 for i, size in enumerate(sizes) if size >= sizes[biggest - 1] * FRAGMENT]
            subject = np.isin(parts, keep)

    if solid:
        # A badge is a filled shape. Without this, backdrop-coloured fill
        # *inside* it (reached through a gap in the border) turns the middle
        # of the badge transparent.
        subject = ndimage.binary_fill_holes(subject)

    out = crop.copy()
    alpha = np.array(out.getchannel("A"))
    alpha[~subject] = 0
    out.putalpha(Image.fromarray(alpha))
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 scripts/extract_vinny.py <character-sheet.pdf>")
    sheet = sheet_from_pdf(Path(sys.argv[1]))
    ASSETS.mkdir(parents=True, exist_ok=True)

    for name, spec in REGIONS.items():
        art = cut_out(sheet.crop(spec["box"]), spec["solid"], spec["single"])
        art.save(ASSETS / f"{name}.png")
        print(f"  {name}.png  {art.size[0]}x{art.size[1]}")

    # The two that also drive Windows' own icons.
    Image.open(ASSETS / "badge-rgb.png").save(BUILD / "icon-source.png")
    Image.open(ASSETS / "mark-outline.png").save(BUILD / "tray-source.png")
    print("\nAlso wrote build/icon-source.png and build/tray-source.png.")
    print("Run scripts/build_icons.py next to regenerate icon.png/.ico/trayTemplate.png.")


if __name__ == "__main__":
    main()
