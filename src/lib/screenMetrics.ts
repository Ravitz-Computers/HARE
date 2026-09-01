import type { SensorReading, SensorSnapshot } from "../../electron/backend/sensors/sensorTypes";

/**
 * The things a cooler screen can be asked to show.
 *
 * WHY THESE ARE MATCHERS AND NOT SENSOR IDS
 *
 * Every sensor id is provider-specific — `amd:0:temp` from the AMD provider,
 * a registry path from HWiNFO, `cooler:0:liquid` from the cooler itself. A
 * saved layout that named ids directly would break the moment someone
 * installed LibreHardwareMonitor, or stopped running HWiNFO, or moved the
 * settings to another PC.
 *
 * So a choice is stored as "CPU temperature", and which reading that *is*
 * gets worked out fresh every time from whatever is reporting right now.
 */
export type ScreenMetricId =
  | "cpu-temp"
  | "gpu-temp"
  | "mb-temp"
  | "cpu-load"
  | "gpu-load"
  | "cpu-clock"
  | "fan"
  | "clock";

/** How many can be on screen at once. Four 480px-tall bands is 120px each, which is still readable across a desk. */
export const MAX_SCREEN_METRICS = 4;

interface MetricDef {
  id: ScreenMetricId;
  /** What the checkbox says. */
  label: string;
  /** What the screen says, in caps, under the number. Kept short — the panel is small. */
  caption: string;
  /** Picks the reading for this metric out of whatever is reporting, or null. */
  match: (readings: SensorReading[]) => SensorReading | null;
}

/** First match wins, so the patterns run from most specific to least. */
function find(
  readings: SensorReading[],
  kind: SensorReading["kind"],
  patterns: RegExp[]
): SensorReading | null {
  for (const pattern of patterns) {
    const hit = readings.find((r) => r.kind === kind && pattern.test(r.label));
    if (hit) return hit;
  }
  return null;
}

export const SCREEN_METRICS: MetricDef[] = [
  {
    id: "cpu-temp",
    label: "CPU temperature",
    caption: "CPU",
    // Tctl/Tdie are AMD's names and "Package" is Intel's; neither says "CPU".
    match: (r) => find(r, "temperature", [/\b(cpu|processor)\b/i, /tctl|tdie/i, /package/i, /core/i]),
  },
  {
    id: "gpu-temp",
    label: "GPU temperature",
    caption: "GPU",
    match: (r) => find(r, "temperature", [/\bgpu\b/i, /graphics/i, /geforce|radeon|nvidia|rtx|arc\b/i]),
  },
  {
    id: "mb-temp",
    label: "Motherboard temperature",
    caption: "BOARD",
    match: (r) =>
      find(r, "temperature", [/motherboard|mainboard/i, /\bvrm\b/i, /chipset/i, /system/i]),
  },
  {
    id: "cpu-load",
    label: "CPU usage",
    caption: "CPU LOAD",
    match: (r) => find(r, "load", [/\b(cpu|processor)\b.*total|total.*\b(cpu|processor)\b/i, /\b(cpu|processor)\b/i]),
  },
  {
    id: "gpu-load",
    label: "GPU usage",
    caption: "GPU LOAD",
    match: (r) => find(r, "load", [/\bgpu\b/i, /graphics/i]),
  },
  {
    id: "cpu-clock",
    label: "CPU speed",
    caption: "CPU CLOCK",
    match: (r) => find(r, "clock", [/\b(cpu|processor)\b/i, /core/i]),
  },
  {
    id: "fan",
    label: "Fan speed",
    caption: "FAN",
    // The cooler's own fan first — on a screen that is sitting on the cooler,
    // that is the fan someone means.
    match: (r) => find(r, "fan", [/cooler|pump|aio/i, /fan/i]),
  },
  {
    id: "clock",
    label: "Time",
    caption: "",
    // Not a sensor. Resolved at draw time — see `tilesFor`.
    match: () => null,
  },
];

export function metricDef(id: ScreenMetricId): MetricDef | undefined {
  return SCREEN_METRICS.find((m) => m.id === id);
}

/** One thing to draw: a value, its unit, and what to call it. */
export interface ScreenTile {
  id: ScreenMetricId;
  caption: string;
  /** Already formatted — "62", "41%", "1450", "14:26". */
  value: string;
  unit: string;
  /**
   * 0..1 for anything with a meaningful scale, or null.
   *
   * Drives the bar under the number. A fan speed has no agreed maximum, so it
   * gets no bar rather than one implying a scale nobody chose — the same rule
   * the single-gauge renderer already follows for its ring.
   */
  fraction: number | null;
  /** Null when nothing is reporting this right now, so the tile can say so instead of showing a stale number. */
  missing: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Turns the chosen metrics into what to draw, in the order they were chosen.
 *
 * A metric nothing is reporting still gets a tile, showing a dash. Silently
 * dropping it would rearrange the layout every time a sensor source came and
 * went, which on a screen glanced at across a room reads as a fault.
 */
export function tilesFor(
  metrics: ScreenMetricId[],
  snapshot: SensorSnapshot,
  now = new Date()
): ScreenTile[] {
  return metrics.slice(0, MAX_SCREEN_METRICS).map((id) => {
    if (id === "clock") {
      return {
        id,
        caption: "",
        value: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        unit: "",
        fraction: null,
        missing: false,
      };
    }

    const def = metricDef(id);
    const reading = def?.match(snapshot.readings) ?? null;
    if (!def || !reading) {
      return { id, caption: def?.caption ?? "", value: "--", unit: "", fraction: null, missing: true };
    }

    if (reading.unit === "°C") {
      return {
        id,
        caption: def.caption,
        value: String(Math.round(reading.value)),
        unit: "°C",
        // 30 to 100 is the range these panels are read at: below 30 nothing is
        // happening, above 100 nothing is fine.
        fraction: Math.max(0, Math.min(1, (reading.value - 30) / 70)),
        missing: false,
      };
    }
    if (reading.unit === "%") {
      return {
        id,
        caption: def.caption,
        value: String(Math.round(reading.value)),
        unit: "%",
        fraction: Math.max(0, Math.min(1, reading.value / 100)),
        missing: false,
      };
    }
    return {
      id,
      caption: def.caption,
      value: String(Math.round(reading.value)),
      unit: reading.unit,
      fraction: null,
      missing: false,
    };
  });
}
