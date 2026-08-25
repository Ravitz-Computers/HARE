import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SensorKind, SensorProvider, SensorReading, SensorUnit } from "../sensorTypes.js";

const execFileAsync = promisify(execFile);

/**
 * Sensors from HWiNFO, for people who already run it.
 *
 * HWiNFO's own Shared Memory interface is a paid feature, but its free
 * "gadget" output writes whatever sensors the user has picked into the
 * registry under HKCU, where any program can read them without elevation.
 * That's the route HARE takes: no licence, no driver, no cost.
 *
 * The catch, and it's worth saying plainly in the UI: **the user chooses
 * which sensors appear there**, and the list is short (HWiNFO's gadget
 * publishes a limited number of entries). So this source reports exactly
 * what someone has already decided to put on their desktop gadget — no more.
 * LibreHardwareMonitor's bridge is the one that reports everything.
 */

const REGISTRY_KEY = "HKCU\\Software\\HWiNFO64\\VSB";

/** Maps the unit HWiNFO writes into the value string onto what kind of sensor it is. */
const UNIT_KINDS: { suffix: string; kind: SensorKind; unit: SensorUnit }[] = [
  { suffix: "°C", kind: "temperature", unit: "°C" },
  { suffix: "C", kind: "temperature", unit: "°C" },
  { suffix: "RPM", kind: "fan", unit: "RPM" },
  { suffix: "%", kind: "load", unit: "%" },
  { suffix: "W", kind: "power", unit: "W" },
  { suffix: "MHz", kind: "clock", unit: "MHz" },
];

interface Entry {
  label?: string;
  value?: string;
  raw?: string;
}

/**
 * Parses `reg query` output into readings.
 *
 * HWiNFO writes each sensor as a numbered set of values — `Label0`,
 * `Value0`, `ValueRaw0` — so the index is what ties a label to its number.
 * `ValueRaw` is preferred because `Value` is already formatted for display
 * and is locale-dependent, but `Value` is what carries the unit, so both are
 * needed: one for the number, the other to know what the number means.
 */
export function parseHwinfoRegistry(stdout: string): SensorReading[] {
  const entries = new Map<string, Entry>();

  for (const line of stdout.split(/\r?\n/)) {
    // "    Label0    REG_SZ    Total CPU Usage"
    const match = /^\s{2,}(Label|Value|ValueRaw)(\d+)\s+REG_SZ\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, field, index, rest] = match;
    const entry = entries.get(index) ?? {};
    if (field === "Label") entry.label = rest.trim();
    else if (field === "ValueRaw") entry.raw = rest.trim();
    else entry.value = rest.trim();
    entries.set(index, entry);
  }

  const out: SensorReading[] = [];
  for (const [index, entry] of [...entries.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (!entry.label) continue;
    const display = entry.value ?? "";
    const mapping = UNIT_KINDS.find((candidate) => display.endsWith(candidate.suffix));
    if (!mapping) continue;

    // ValueRaw uses a dot regardless of locale; Value may use a comma, so it
    // is only a fallback and is normalised before parsing.
    const numeric = entry.raw ?? display.slice(0, display.length - mapping.suffix.length).replace(",", ".");
    const value = Number.parseFloat(numeric);
    if (!Number.isFinite(value)) continue;

    out.push({
      id: `hwinfo:${index}`,
      label: entry.label,
      kind: mapping.kind,
      value,
      unit: mapping.unit,
      source: "hwinfo",
    });
  }
  return out;
}

export class HwinfoProvider implements SensorProvider {
  readonly id = "hwinfo" as const;
  readonly name = "HWiNFO";

  constructor(private readonly query: () => Promise<string> = defaultQuery) {}

  async probe(): Promise<{ available: boolean; detail: string }> {
    if (process.platform !== "win32") return { available: false, detail: "Windows only." };
    const readings = await this.read();
    if (readings.length === 0) {
      return {
        available: false,
        detail: "Not running, or its gadget values are switched off in HWiNFO's settings.",
      };
    }
    return { available: true, detail: `${readings.length} sensors you've picked in HWiNFO.` };
  }

  async read(): Promise<SensorReading[]> {
    try {
      return parseHwinfoRegistry(await this.query());
    } catch {
      // A missing key is the normal case (HWiNFO not installed), and `reg`
      // reports that as a failure — so it is not worth logging, let alone
      // surfacing.
      return [];
    }
  }
}

async function defaultQuery(): Promise<string> {
  const { stdout } = await execFileAsync("reg", ["query", REGISTRY_KEY], {
    windowsHide: true,
    timeout: 4000,
  });
  return stdout;
}
