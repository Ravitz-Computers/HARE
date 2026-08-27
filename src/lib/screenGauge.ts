import {
  formatReading,
  hottestTemperature,
  type SensorReading,
  type SensorSnapshot,
} from "../../electron/backend/sensors/sensorTypes";

/**
 * Draws a temperature readout for an AIO or case screen.
 *
 * HARE could already read sensors, and could already send pixels to these
 * screens. What was missing was the thing that turns one into the other —
 * which is the entire reason anyone buys a cooler with a screen on it.
 *
 * The drawing happens here, in the window, for the same reason photos are
 * resized here: the browser engine already has a canvas, so HARE ships no
 * image library and the screen only ever receives pixels that are already the
 * right size.
 */

/** Where the ring changes colour. Below 40 nothing is happening; above 85 something is wrong. */
const BANDS: { max: number; color: string }[] = [
  { max: 40, color: "#3ddc97" },
  { max: 60, color: "#5cc8ff" },
  { max: 75, color: "#ffc857" },
  { max: 85, color: "#ff8f3f" },
  { max: Infinity, color: "#ff4d6d" },
];

function bandColor(celsius: number): string {
  return BANDS.find((b) => celsius < b.max)!.color;
}

/**
 * Picks what to show: the sensor someone chose, or — if they chose nothing, or
 * the one they chose has stopped reporting — the hottest thing in the machine,
 * which is what the screen is for.
 */
export function gaugeReading(snapshot: SensorSnapshot, sensorId: string | null): SensorReading | null {
  if (sensorId) {
    const chosen = snapshot.readings.find((r) => r.id === sensorId);
    if (chosen) return chosen;
  }
  return hottestTemperature(snapshot);
}

/**
 * Renders one frame as raw RGBA at the screen's exact native resolution —
 * the shape setDisplayImage requires.
 *
 * Deliberately drawn against black. These are small round or square panels
 * behind tinted glass, read at arm's length across a desk; anything but a dark
 * ground with one large number on it is unreadable there.
 */
export function renderGauge(
  reading: SensorReading | null,
  width: number,
  height: number,
  label?: string
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the frame.");

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.38;
  const ringWidth = Math.max(6, Math.min(width, height) * 0.055);

  if (!reading) {
    ctx.fillStyle = "#8b8b9a";
    ctx.font = `500 ${Math.round(height * 0.075)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No sensor", cx, cy);
    return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
  }

  // The arc is for temperatures only. A fan speed or a load percentage has no
  // meaningful 30–100 sweep, so those show as a number alone rather than as a
  // ring implying a scale nobody agreed to.
  const isTemp = reading.unit === "°C";
  const color = isTemp ? bandColor(reading.value) : "#9b7cff";

  if (isTemp) {
    const fraction = Math.max(0, Math.min(1, (reading.value - 30) / 70));
    const start = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;

    ctx.lineCap = "round";
    ctx.lineWidth = ringWidth;
    ctx.strokeStyle = "#1c1c24";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.stroke();

    if (fraction > 0) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + sweep * fraction);
      ctx.stroke();
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const value = isTemp ? String(Math.round(reading.value)) : formatReading(reading);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(height * (isTemp ? 0.3 : 0.2))}px sans-serif`;
  ctx.fillText(value, cx, cy - height * 0.01);

  if (isTemp) {
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.round(height * 0.1)}px sans-serif`;
    ctx.fillText("°C", cx, cy + height * 0.16);
  }

  const caption = (label ?? reading.label).toUpperCase();
  ctx.fillStyle = "#8b8b9a";
  ctx.font = `600 ${Math.round(height * 0.055)}px sans-serif`;
  ctx.fillText(caption.length > 18 ? `${caption.slice(0, 17)}…` : caption, cx, cy + height * 0.3);

  return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
}
