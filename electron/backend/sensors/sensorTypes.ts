/**
 * What a sensor reading is, and where one can come from.
 *
 * HARE reads sensors from whatever it can reach *without* installing a
 * kernel driver of its own. That constraint is the whole design: motherboard
 * temperatures and case-fan RPM live behind ring-0 port I/O, which is why
 * every hardware monitor ships a driver and asks for administrator rights on
 * every launch. HARE deliberately doesn't, so it takes what's available:
 *
 *   - the operating system (CPU and memory load — always there),
 *   - the GPU vendor's own user-mode library, installed with the graphics
 *     driver (NVML for NVIDIA, ADL for AMD),
 *   - hardware HARE already talks to over USB (an AIO's liquid temperature),
 *   - and, when the user already runs one, a real hardware monitor
 *     (LibreHardwareMonitor or HWiNFO), which fills in everything above.
 *
 * A missing source is never an error. It's simply a source that reports
 * nothing, and the UI says which ones are live and what would add more.
 */

export type SensorKind = "temperature" | "load" | "fan" | "power" | "memory" | "clock";

export type SensorSourceId =
  | "system"
  | "nvidia"
  | "amd-gpu"
  | "cooler"
  | "libre-hardware-monitor"
  | "hwinfo";

export type SensorUnit = "°C" | "%" | "RPM" | "W" | "GB" | "MHz";

export interface SensorReading {
  /** Stable across polls, so the UI can animate a value rather than remount a row. */
  id: string;
  label: string;
  kind: SensorKind;
  value: number;
  unit: SensorUnit;
  source: SensorSourceId;
}

export interface SensorSourceStatus {
  id: SensorSourceId;
  name: string;
  available: boolean;
  /** One line, in the user's terms: what it's providing, or what would make it work. */
  detail: string;
}

export interface SensorSnapshot {
  readings: SensorReading[];
  sources: SensorSourceStatus[];
  /** ISO timestamp of the last successful poll, or null before the first one. */
  updatedAt: string | null;
}

export const EMPTY_SNAPSHOT: SensorSnapshot = { readings: [], sources: [], updatedAt: null };

/**
 * One place sensors come from.
 *
 * Both methods must resolve rather than reject, always. A provider that
 * throws is a provider that would take the whole snapshot down with it, and
 * "my GPU vendor's DLL isn't installed" must never be able to do that — so
 * the hub also catches, but providers are written not to need it.
 */
export interface SensorProvider {
  id: SensorSourceId;
  name: string;
  /** Cheap capability check, run once when watching starts. */
  probe(): Promise<{ available: boolean; detail: string }>;
  read(): Promise<SensorReading[]>;
  /** Minimum gap between reads, for sources that are slower or more intrusive than the rest. */
  minIntervalMs?: number;
  /** Releases anything held open (a child process, a USB handle) when nothing is watching. */
  dispose?(): void | Promise<void>;
}

/** Formats a reading the way it should appear on screen, including how many decimals it deserves. */
export function formatReading(reading: SensorReading): string {
  const decimals = reading.unit === "°C" || reading.unit === "GB" ? 1 : 0;
  return `${reading.value.toFixed(decimals)}${reading.unit === "%" ? "" : " "}${reading.unit}`;
}

/** The hottest thing in a snapshot, which is what a thermal display or effect actually wants. */
export function hottestTemperature(snapshot: SensorSnapshot): SensorReading | null {
  let hottest: SensorReading | null = null;
  for (const reading of snapshot.readings) {
    if (reading.kind !== "temperature") continue;
    if (!hottest || reading.value > hottest.value) hottest = reading;
  }
  return hottest;
}
