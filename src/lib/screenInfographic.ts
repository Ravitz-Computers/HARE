import type { ScreenTile } from "./screenMetrics";

/**
 * Draws one to four readings on a cooler screen.
 *
 * WHY BANDS AND NOT A GRID
 *
 * These panels are small, and several of them — the Galahad II's among them —
 * are round. A 2x2 grid puts a tile in each corner, which is exactly where a
 * round panel has no glass. Equal horizontal bands keep everything on the
 * vertical centre line, so the same layout is right on a circle and on a
 * square, and nothing has to know which it is drawing on.
 *
 * Bands also degrade properly: one metric is one big number, four is four
 * smaller ones, and nothing moves sideways in between.
 *
 * WHY IT IS DARK
 *
 * Same reason as the single gauge next door: these sit behind tinted glass and
 * are read at arm's length across a desk. A dark ground with a few large
 * numbers is legible there; anything busier is not.
 */

const BANDS: { max: number; color: string }[] = [
  { max: 0.15, color: "#3ddc97" },
  { max: 0.45, color: "#5cc8ff" },
  { max: 0.65, color: "#ffc857" },
  { max: 0.8, color: "#ff8f3f" },
  { max: Infinity, color: "#ff4d6d" },
];

function scaleColor(fraction: number | null): string {
  if (fraction === null) return "#9b7cff";
  return BANDS.find((b) => fraction < b.max)!.color;
}

/**
 * How far in from the edge a band has to start to stay on a round panel.
 *
 * A circle of radius r, at a vertical distance dy from the centre, is only
 * `2 * sqrt(r^2 - dy^2)` wide. Bands near the top and bottom therefore need a
 * much larger inset than the middle one. Computing it means the top band's
 * caption doesn't run off the edge of a circular screen — which is the kind of
 * thing that looks fine in a preview on a rectangular monitor and wrong on the
 * cooler.
 */
function safeInset(centreY: number, width: number, height: number): number {
  const r = Math.min(width, height) / 2;
  const dy = Math.abs(centreY - height / 2);
  if (dy >= r) return width / 2;
  const halfChord = Math.sqrt(r * r - dy * dy);
  // A little extra, so nothing sits exactly on the bezel.
  return Math.max(0, width / 2 - halfChord * 0.92);
}

/**
 * Renders the chosen readings as raw RGBA at the screen's native size — the
 * shape setDisplayImage takes.
 */
export interface InfographicOptions {
  /** What the numbers and captions are drawn in. The bars keep their own scale colours, which carry meaning. */
  textColor?: string;
  /**
   * An already-cropped background to draw the readings over.
   *
   * When one is present the text gets a shadow and the bands get no dividing
   * rules: hairlines that read as structure on black read as scratches over a
   * photograph.
   */
  background?: CanvasImageSource | null;
}

export function renderInfographic(
  tiles: ScreenTile[],
  width: number,
  height: number,
  options: InfographicOptions = {}
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the frame.");

  const textColor = options.textColor ?? "#ffffff";
  const hasBackground = Boolean(options.background);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  if (options.background) {
    ctx.drawImage(options.background, 0, 0, width, height);
  }
  // Over a photograph, a plain-coloured number can land on anything. A shadow
  // costs nothing on a dark ground and is the difference between readable and
  // not on a light one.
  if (hasBackground) {
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = Math.max(4, Math.round(height * 0.02));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (tiles.length === 0) {
    // Nothing to say. With a background this is a picture, not an error.
    if (hasBackground) return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
    ctx.fillStyle = "#8b8b9a";
    ctx.font = `500 ${Math.round(height * 0.07)}px sans-serif`;
    ctx.fillText("Nothing selected", width / 2, height / 2);
    return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
  }

  const count = tiles.length;
  const bandHeight = height / count;
  // One reading gets to be enormous; four have to share. Scaled off the band
  // rather than the screen so the numbers stay proportional either way.
  const valueSize = Math.round(bandHeight * (count === 1 ? 0.42 : 0.4));
  const captionSize = Math.round(bandHeight * (count === 1 ? 0.1 : 0.15));
  const unitSize = Math.round(valueSize * 0.4);

  tiles.forEach((tile, index) => {
    const top = index * bandHeight;
    const centreY = top + bandHeight / 2;
    const inset = safeInset(centreY, width, height);
    const usable = width - inset * 2;
    const cx = width / 2;
    const color = tile.missing ? "#6b6b78" : scaleColor(tile.fraction);

    // A hairline between bands, so four numbers don't read as one column.
    if (index > 0 && !hasBackground) {
      ctx.strokeStyle = "#1c1c24";
      ctx.lineWidth = Math.max(1, Math.round(height * 0.004));
      ctx.beginPath();
      const rule = safeInset(top, width, height);
      ctx.moveTo(rule + width * 0.04, top);
      ctx.lineTo(width - rule - width * 0.04, top);
      ctx.stroke();
    }

    const hasCaption = tile.caption.length > 0;
    const valueY = hasCaption ? centreY - bandHeight * 0.08 : centreY;

    // Value and unit are drawn as one line, measured first so the pair is
    // centred together. Centring the number alone and hanging the unit off it
    // makes a row of readings visibly wander.
    ctx.font = `700 ${valueSize}px sans-serif`;
    const valueWidth = ctx.measureText(tile.value).width;
    ctx.font = `600 ${unitSize}px sans-serif`;
    const unitWidth = tile.unit ? ctx.measureText(` ${tile.unit}`).width : 0;
    const startX = cx - (valueWidth + unitWidth) / 2;

    ctx.textAlign = "left";
    ctx.fillStyle = tile.missing ? "#6b6b78" : textColor;
    ctx.font = `700 ${valueSize}px sans-serif`;
    ctx.fillText(tile.value, startX, valueY);
    if (tile.unit) {
      ctx.fillStyle = hasBackground ? textColor : color;
      ctx.font = `600 ${unitSize}px sans-serif`;
      ctx.fillText(` ${tile.unit}`, startX + valueWidth, valueY + valueSize * 0.12);
    }
    ctx.textAlign = "center";

    if (hasCaption) {
      // The caption is the chosen colour, dimmed, rather than a fixed grey —
      // fixed grey disappears against a light background whatever the numbers
      // are set to.
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = textColor;
      ctx.font = `600 ${captionSize}px sans-serif`;
      ctx.fillText(tile.caption, cx, centreY + bandHeight * 0.28);
      ctx.globalAlpha = 1;
    }

    // The bar only appears where a fraction means something. A fan speed has
    // no agreed maximum, so it gets a number and nothing else.
    if (tile.fraction !== null && !tile.missing && count > 1) {
      const barWidth = usable * 0.5;
      const barY = centreY + bandHeight * 0.4;
      const barHeight = Math.max(2, Math.round(bandHeight * 0.045));
      ctx.fillStyle = "#1c1c24";
      ctx.fillRect(cx - barWidth / 2, barY, barWidth, barHeight);
      ctx.fillStyle = color;
      ctx.fillRect(cx - barWidth / 2, barY, barWidth * tile.fraction, barHeight);
    }
  });

  return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
}
