import { createRequire } from "node:module";
import { detectLcdDisplays } from "../../displays/krakenLcd.js";
import type { SensorProvider, SensorReading } from "../sensorTypes.js";

const require = createRequire(import.meta.url);

/**
 * Liquid temperature and pump speed, straight from the AIO.
 *
 * This is the one *hardware* temperature HARE can read with no driver, no
 * elevation and no third-party software: the cooler reports it over the same
 * USB HID channel HARE already uses to drive its screen. On a machine with a
 * supported AIO it is also the most useful number on the dashboard, because
 * liquid temperature is what the cooler is actually managing.
 *
 * The byte offsets come from liquidctl's `kraken3` driver, the same reference
 * the screen code was written from, and are unverified here for the same
 * reason: no Kraken in this environment. Every field is range-checked before
 * it's reported, so a misread offset shows up as "no reading" rather than as
 * a confident wrong number.
 *
 * BEING A GOOD NEIGHBOUR
 *
 * The device is opened, read and closed for each poll rather than held. NZXT
 * CAM wants the same device, and holding an exclusive handle for HARE's whole
 * lifetime would lock it out — the same reasoning as the screen driver. That
 * costs a connect per poll, which is why this source reads far less often
 * than the rest (liquid temperature moves slowly; there is nothing to miss).
 */

const READ_LENGTH = 64;
const MAX_READ_ATTEMPTS = 8;
/** Status request, and the reply prefix it produces. */
const STATUS_REQUEST = [0x74, 0x01];
const STATUS_REPLY: [number, number] = [0x75, 0x01];

export interface CoolerStatus {
  liquidCelsius: number | null;
  pumpRpm: number | null;
  fanRpm: number | null;
}

/**
 * Pulls the readable fields out of a Kraken status report.
 *
 * Temperature arrives as a whole number and a tenths byte in the next
 * position, which is the detail most likely to be transcribed wrongly — and
 * would read as a plausible 3-degree error rather than as nonsense, hence
 * the explicit range check on the result.
 */
export function parseKrakenStatus(msg: number[] | Uint8Array): CoolerStatus {
  const at = (index: number): number | null => {
    const value = msg[index];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const whole = at(15);
  const tenths = at(16);
  const liquid = whole === null || tenths === null ? null : whole + tenths / 10;

  const pumpLow = at(17);
  const pumpHigh = at(18);
  const pump = pumpLow === null || pumpHigh === null ? null : (pumpHigh << 8) | pumpLow;

  const fanLow = at(23);
  const fanHigh = at(24);
  const fan = fanLow === null || fanHigh === null ? null : (fanHigh << 8) | fanLow;

  return {
    // A cooler that is running reports something between room temperature
    // and the point water boils. Anything else means the offset is wrong.
    liquidCelsius: liquid !== null && liquid > 5 && liquid < 100 ? Math.round(liquid * 10) / 10 : null,
    pumpRpm: plausibleRpm(pump, 6000),
    fanRpm: plausibleRpm(fan, 5000),
  };
}

function plausibleRpm(value: number | null, max: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  // Zero is a legitimate reading for a stopped fan, so only the upper bound
  // rejects; an impossible number means a misread pair of bytes.
  return value >= 0 && value <= max ? value : null;
}

interface HidLike {
  write(data: number[]): number;
  readTimeout(timeoutMs: number): number[];
  close(): void;
}

export class CoolerProvider implements SensorProvider {
  readonly id = "cooler" as const;
  readonly name = "AIO cooler";
  /** Liquid temperature changes over minutes, and each read briefly opens the device. */
  readonly minIntervalMs = 8000;

  private coolers: { name: string; vendorId: number; productId: number }[] = [];

  async probe(): Promise<{ available: boolean; detail: string }> {
    if (process.platform !== "win32") return { available: false, detail: "Windows only." };
    try {
      const screens = await detectLcdDisplays();
      // Only coolers HARE can actually talk to — a detected-but-undriveable
      // panel has no status channel either.
      this.coolers = screens
        .filter((screen) => screen.controllable)
        .map(({ name, vendorId, productId }) => ({ name, vendorId, productId }));
    } catch (err) {
      return { available: false, detail: describe(err) };
    }
    if (this.coolers.length === 0) {
      return { available: false, detail: "No AIO cooler HARE can read." };
    }
    return { available: true, detail: `Liquid temperature and pump speed from ${this.coolers[0].name}.` };
  }

  async read(): Promise<SensorReading[]> {
    const out: SensorReading[] = [];
    for (const cooler of this.coolers) {
      const status = this.readStatus(cooler.vendorId, cooler.productId);
      if (!status) continue;
      const prefix = `cooler:${cooler.vendorId}:${cooler.productId}`;
      if (status.liquidCelsius !== null) {
        out.push({
          id: `${prefix}:liquid`,
          label: "Liquid",
          kind: "temperature",
          value: status.liquidCelsius,
          unit: "°C",
          source: this.id,
        });
      }
      if (status.pumpRpm !== null) {
        out.push({ id: `${prefix}:pump`, label: "Pump", kind: "fan", value: status.pumpRpm, unit: "RPM", source: this.id });
      }
      if (status.fanRpm !== null && status.fanRpm > 0) {
        out.push({ id: `${prefix}:fan`, label: "Cooler fan", kind: "fan", value: status.fanRpm, unit: "RPM", source: this.id });
      }
    }
    return out;
  }

  private readStatus(vendorId: number, productId: number): CoolerStatus | null {
    let hid: HidLike | null = null;
    try {
      const nodeHid = require("node-hid") as {
        devices: (vid: number, pid: number) => { path?: string }[];
        HID: new (path: string) => HidLike;
      };
      const entry = nodeHid.devices(vendorId, productId).find((d) => d.path);
      if (!entry?.path) return null;
      hid = new nodeHid.HID(entry.path);
      hid.write([...STATUS_REQUEST, ...new Array(62).fill(0)]);
      for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
        const msg = hid.readTimeout(300);
        if (!msg || msg.length < READ_LENGTH) continue;
        if (msg[0] === STATUS_REPLY[0] && msg[1] === STATUS_REPLY[1]) return parseKrakenStatus(msg);
      }
      return null;
    } catch {
      // The cooler being busy with another app is an ordinary outcome, not
      // something to report — the source simply has nothing this poll.
      return null;
    } finally {
      try {
        hid?.close();
      } catch {
        /* already gone */
      }
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
