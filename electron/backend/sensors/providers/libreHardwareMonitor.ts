import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { SensorKind, SensorProvider, SensorReading } from "../sensorTypes.js";

/**
 * Everything a real hardware monitor can see — CPU package temperature,
 * motherboard sensors, case-fan RPM — borrowed from LibreHardwareMonitor if
 * the user already runs it.
 *
 * This is the honest answer to the one thing HARE cannot do on its own.
 * Those sensors live behind ring-0 port I/O; reaching them means shipping a
 * kernel driver and asking for administrator rights at every boot, which HARE
 * deliberately doesn't do. LibreHardwareMonitor already made that trade, and
 * publishes everything it reads to a WMI namespace that any program can read
 * **unelevated**. So if it's running, HARE simply asks it.
 *
 * ONE CHILD PROCESS, NOT ONE PER POLL
 *
 * The natural implementation — run a PowerShell query every couple of
 * seconds — costs a process launch each time, which is by far the most
 * expensive thing HARE would do all day. Instead one PowerShell is started
 * when something begins watching sensors, prints a JSON line on a loop, and
 * is killed the moment the last watcher goes away. Zero cost when nobody is
 * looking, one process when somebody is.
 */

/** How LibreHardwareMonitor names the sensor types HARE displays. */
const SENSOR_KINDS: Record<string, { kind: SensorKind; unit: SensorReading["unit"] }> = {
  Temperature: { kind: "temperature", unit: "°C" },
  Load: { kind: "load", unit: "%" },
  Fan: { kind: "fan", unit: "RPM" },
  Power: { kind: "power", unit: "W" },
};

/** Keeps a runaway sensor list from filling the dashboard; real machines report 30-60. */
const MAX_READINGS = 48;

interface RawSensor {
  Identifier?: unknown;
  Name?: unknown;
  SensorType?: unknown;
  Value?: unknown;
}

/**
 * Turns one line of PowerShell's JSON into readings.
 *
 * Written as a pure function on purpose: it's the part that can be wrong in
 * ways a Windows machine would show and this one can't, so it's the part the
 * tests drive directly. `ConvertTo-Json` collapses a single-element array to
 * a bare object, which is exactly the case that breaks naive parsers on a
 * machine with one sensor.
 */
export function parseLibreHardwareMonitorJson(line: string): SensorReading[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  const rows: RawSensor[] = Array.isArray(parsed) ? (parsed as RawSensor[]) : [parsed as RawSensor];
  const out: SensorReading[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const type = typeof row.SensorType === "string" ? row.SensorType : "";
    const mapping = SENSOR_KINDS[type];
    if (!mapping) continue;

    // A sensor that is present but has never produced a value reports null,
    // and `Number(null)` is 0 — a plausible-looking lie that would show a
    // drive sitting at 0 °C. Empty strings do the same thing, so both are
    // rejected before the conversion rather than after it.
    if (row.Value === null || row.Value === undefined || row.Value === "") continue;
    const value = typeof row.Value === "number" ? row.Value : Number(row.Value);
    if (!Number.isFinite(value)) continue;

    const name = typeof row.Name === "string" && row.Name.trim() ? row.Name.trim() : type;
    const identifier = typeof row.Identifier === "string" ? row.Identifier : `${type}/${name}`;

    out.push({
      id: `lhm:${identifier}`,
      label: name,
      kind: mapping.kind,
      value,
      unit: mapping.unit,
      source: "libre-hardware-monitor",
    });
    if (out.length >= MAX_READINGS) break;
  }
  return out;
}

/** The PowerShell that does the polling, kept here so the test can assert what it asks for. */
export function buildPollScript(intervalSeconds: number): string {
  const seconds = Math.max(1, Math.round(intervalSeconds));
  return [
    "$ErrorActionPreference = 'Stop'",
    "while ($true) {",
    "  try {",
    "    $s = Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor",
    "    $j = $s | Select-Object Identifier,Name,SensorType,Value | ConvertTo-Json -Compress -Depth 2",
    "    [Console]::Out.WriteLine($j)",
    "  } catch {",
    "    [Console]::Out.WriteLine('[]')",
    "  }",
    `  Start-Sleep -Seconds ${seconds}`,
    "}",
  ].join("\n");
}

export class LibreHardwareMonitorProvider implements SensorProvider {
  readonly id = "libre-hardware-monitor" as const;
  readonly name = "LibreHardwareMonitor";
  private child: PollProcess | null = null;
  private latest: SensorReading[] = [];
  private buffer = "";

  constructor(
    private readonly intervalSeconds = 2,
    /** Test seam: swap in a fake process launcher. */
    private readonly launch: (script: string) => PollProcess = defaultLaunch
  ) {}

  async probe(): Promise<{ available: boolean; detail: string }> {
    if (process.platform !== "win32") return { available: false, detail: "Windows only." };
    if (!this.child) {
      try {
        this.start();
      } catch (err) {
        return { available: false, detail: describe(err) };
      }
    }
    // Waits for the first line rather than assuming: a running PowerShell
    // proves nothing, since the namespace only exists while
    // LibreHardwareMonitor itself is running.
    const first = await this.waitForFirstReading(5000);
    if (!first) {
      return {
        available: false,
        detail: "Not running. Start LibreHardwareMonitor for CPU, motherboard and fan sensors.",
      };
    }
    return { available: true, detail: `${this.latest.length} sensors, including CPU and fans.` };
  }

  async read(): Promise<SensorReading[]> {
    return this.latest;
  }

  dispose(): void {
    this.stop();
  }

  private start(): void {
    const child = this.launch(buildPollScript(this.intervalSeconds));
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    // Failures are ordinary here (no PowerShell, blocked by policy), and all
    // of them mean the same thing: this source has nothing to say.
    child.on("error", () => this.stop());
    child.on("exit", () => {
      this.child = null;
      this.latest = [];
    });
  }

  private stop(): void {
    const child = this.child;
    this.child = null;
    this.latest = [];
    this.buffer = "";
    if (!child) return;
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }

  /**
   * Accumulates stdout and parses whole lines only.
   *
   * A big sensor list arrives in several chunks, so parsing per chunk would
   * throw away most readings. The buffer is capped so a process that never
   * emits a newline can't grow it without limit.
   */
  private consume(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 1_000_000) this.buffer = "";
    let index = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) {
        const readings = parseLibreHardwareMonitorJson(line);
        // An empty result means the namespace vanished (the app was closed);
        // keeping the last good values would show a frozen temperature.
        this.latest = readings;
      }
      index = this.buffer.indexOf("\n");
    }
  }

  private async waitForFirstReading(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.latest.length > 0) return true;
      if (!this.child) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
}

/**
 * Only the parts of a child process this provider uses — which is also
 * exactly what a test needs to stand in for one.
 */
export interface PollProcess {
  stdout: Pick<Readable, "on" | "setEncoding">;
  on(event: "error" | "exit", listener: () => void): unknown;
  kill(): unknown;
}

function defaultLaunch(script: string): PollProcess {
  return spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
