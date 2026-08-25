import os from "node:os";
import type { SensorProvider, SensorReading } from "../sensorTypes.js";

/**
 * CPU and memory load, from the operating system itself.
 *
 * No driver, no elevation, no vendor library — this is the one source that is
 * always available on every machine, which makes it the floor the dashboard
 * can always draw something from.
 *
 * It is deliberately load and not temperature: CPU package temperature comes
 * from a model-specific register, which needs ring-0 access. Load does not.
 */

export interface CpuTimesSample {
  idle: number;
  total: number;
}

/** Sums the tick counters Node reports for every core into one idle/total pair. */
export function sampleCpuTimes(cpus: os.CpuInfo[]): CpuTimesSample {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

/**
 * CPU busy percentage between two samples.
 *
 * Those counters are cumulative since boot, so a single reading says nothing
 * about *now* — the value only exists as a difference between two moments.
 * The first poll therefore has nothing to compare against and reports 0
 * rather than a made-up number; the second poll onwards is real.
 */
export function cpuLoadBetween(previous: CpuTimesSample | null, current: CpuTimesSample): number {
  if (!previous) return 0;
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  // A zero or negative delta means the counters wrapped, or two samples
  // landed in the same tick. Either way there is nothing to divide by.
  if (totalDelta <= 0) return 0;
  const busy = 1 - idleDelta / totalDelta;
  return Math.max(0, Math.min(100, busy * 100));
}

export class SystemLoadProvider implements SensorProvider {
  readonly id = "system" as const;
  readonly name = "Windows";
  private previous: CpuTimesSample | null = null;

  async probe(): Promise<{ available: boolean; detail: string }> {
    return { available: true, detail: "CPU and memory load." };
  }

  async read(): Promise<SensorReading[]> {
    const current = sampleCpuTimes(os.cpus());
    const load = cpuLoadBetween(this.previous, current);
    this.previous = current;

    const total = os.totalmem();
    const used = total - os.freemem();
    const toGb = (bytes: number) => bytes / 1024 ** 3;

    return [
      { id: "system:cpu-load", label: "CPU", kind: "load", value: load, unit: "%", source: this.id },
      {
        id: "system:memory-load",
        label: "Memory",
        kind: "load",
        value: total > 0 ? (used / total) * 100 : 0,
        unit: "%",
        source: this.id,
      },
      { id: "system:memory-used", label: "Memory used", kind: "memory", value: toGb(used), unit: "GB", source: this.id },
    ];
  }

  dispose(): void {
    // Nothing is held open, but the next watcher should start from a fresh
    // baseline rather than differencing against a sample from minutes ago.
    this.previous = null;
  }
}
