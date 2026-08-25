import type { KLColor } from "./types.js";

/**
 * Turning a captured frame into the colours Screen Sync uses.
 *
 * Split out from ambientSync.ts because that file imports Electron, which
 * can't be loaded outside an Electron process — and this is the half worth
 * testing directly. Electron hands back **BGRA**, and reading it as RGBA
 * swaps red and blue: a bug that looks like "the colours are wrong" rather
 * than like a failure, and exactly the sort of thing a test should catch
 * instead of a user.
 */

/** Wide enough to resolve left from right, small enough to be nearly free. */
export const SAMPLE_WIDTH = 48;
export const SAMPLE_HEIGHT = 27;
/** How many colours across the screen are reported. */
export const BAND_COUNT = 16;

/**
 * Splits the captured frame into vertical bands and averages each one.
 *
 * Bands rather than a grid because that is what lighting behind a monitor
 * actually needs: LEDs run left to right, so a colour per horizontal position
 * maps onto them directly. NativeImage bitmaps from Electron are BGRA on
 * every platform.
 */
export function sampleBands(
  bitmap: Buffer,
  size: { width: number; height: number },
  bandCount: number
): KLColor[] {
  const bands = Math.max(1, bandCount);
  if (size.width <= 0 || size.height <= 0) return new Array(bands).fill({ r: 0, g: 0, b: 0 });

  const totals = Array.from({ length: bands }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const i = (y * size.width + x) * 4;
      if (i + 3 >= bitmap.length) break;
      const band = totals[Math.min(bands - 1, Math.floor((x / size.width) * bands))];
      band.b += bitmap[i];
      band.g += bitmap[i + 1];
      band.r += bitmap[i + 2];
      band.n++;
    }
  }
  return totals.map((band) =>
    band.n === 0
      ? { r: 0, g: 0, b: 0 }
      : { r: Math.round(band.r / band.n), g: Math.round(band.g / band.n), b: Math.round(band.b / band.n) }
  );
}

/** The single colour for anything that can only show one — the average of the bands. */
export function averageOfBands(bands: KLColor[]): KLColor {
  if (bands.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const band of bands) {
    r += band.r;
    g += band.g;
    b += band.b;
  }
  return {
    r: Math.round(r / bands.length),
    g: Math.round(g / bands.length),
    b: Math.round(b / bands.length),
  };
}
