import { createRequire } from "node:module";
import type { SensorProvider, SensorReading } from "../sensorTypes.js";

const require = createRequire(import.meta.url);

/**
 * GPU temperature, load, fan and power from NVIDIA's own management library.
 *
 * NVML ships *with the graphics driver* — `nvml.dll` is placed in System32 by
 * every current NVIDIA install — so this needs nothing downloaded, nothing
 * installed, and no administrator rights. It is the reason a large share of
 * gaming PCs get real temperatures out of HARE without a kernel driver
 * anywhere in the picture.
 *
 * The function names and semantics below come from NVIDIA's published NVML
 * API (the `_v2` suffixes are the current ABI; the unsuffixed names still
 * exist but are the older ABI). Two conversions matter and are easy to get
 * silently wrong: power is reported in **milliwatts**, and utilisation comes
 * back as a two-field struct rather than a single number.
 *
 * NOT verified against a real NVIDIA GPU in this environment — there isn't
 * one. The call sequence is exercised against a simulated library in
 * test/verify-sensors.mjs, which proves HARE's side; what it cannot prove is
 * that the published API matches this driver revision.
 */

const NVML_SUCCESS = 0;
/** NVML_TEMPERATURE_GPU — the die sensor, the one every tool reports as "GPU temp". */
const NVML_TEMPERATURE_GPU = 0;
const NAME_BUFFER_BYTES = 96;

interface NvmlApi {
  init(): number;
  shutdown(): number;
  deviceGetCount(out: Uint32Array): number;
  deviceGetHandleByIndex(index: number, out: unknown): number;
  deviceGetName(handle: unknown, buffer: Uint8Array, length: number): number;
  deviceGetTemperature(handle: unknown, sensor: number, out: Uint32Array): number;
  deviceGetUtilizationRates(handle: unknown, out: Uint32Array): number;
  deviceGetFanSpeed(handle: unknown, out: Uint32Array): number;
  deviceGetPowerUsage(handle: unknown, out: Uint32Array): number;
}

/** Trims a fixed-size C string buffer at its NUL terminator. */
export function readCString(buffer: Uint8Array): string {
  const end = buffer.indexOf(0);
  return Buffer.from(buffer.subarray(0, end === -1 ? buffer.length : end)).toString("utf8");
}

/** Milliwatts to watts — NVML reports power in mW, and reporting it raw would show "185000 W". */
export function milliwattsToWatts(mw: number): number {
  return mw / 1000;
}

export class NvidiaGpuProvider implements SensorProvider {
  readonly id = "nvidia" as const;
  readonly name = "NVIDIA GPU";
  private api: NvmlApi | null = null;
  private initialized = false;
  private deviceCount = 0;

  async probe(): Promise<{ available: boolean; detail: string }> {
    if (process.platform !== "win32") {
      return { available: false, detail: "Windows only." };
    }
    if (!this.initialized) {
      this.api = this.loadLibrary();
      const api = this.api;
      if (!api) {
        return { available: false, detail: "No NVIDIA driver found on this PC." };
      }
      try {
        if (api.init() !== NVML_SUCCESS) {
          return { available: false, detail: "NVIDIA's management library wouldn't start." };
        }
        this.initialized = true;
      } catch (err) {
        return { available: false, detail: describe(err) };
      }
    }
    try {
      const count = new Uint32Array(1);
      if (!this.api || this.api.deviceGetCount(count) !== NVML_SUCCESS) {
        return { available: false, detail: "Couldn't count NVIDIA GPUs." };
      }
      this.deviceCount = count[0];
      if (this.deviceCount === 0) return { available: false, detail: "No NVIDIA GPU found." };
      return {
        available: true,
        detail: `Temperature, load, fan and power from ${this.deviceCount} NVIDIA GPU${this.deviceCount === 1 ? "" : "s"}.`,
      };
    } catch (err) {
      return { available: false, detail: describe(err) };
    }
  }

  async read(): Promise<SensorReading[]> {
    if (!this.api || !this.initialized) return [];
    const out: SensorReading[] = [];

    for (let index = 0; index < this.deviceCount; index++) {
      // Every call is individually tolerated: a card that reports temperature
      // but has no fan sensor (many laptops, and passively cooled cards)
      // should still contribute its temperature.
      const handle = this.handleFor(index);
      if (!handle) continue;
      const label = this.deviceCount === 1 ? "GPU" : `GPU ${index + 1}`;
      const prefix = `nvidia:${index}`;

      const temperature = this.readValue((buf) =>
        this.api!.deviceGetTemperature(handle, NVML_TEMPERATURE_GPU, buf)
      );
      if (temperature !== null) {
        out.push({ id: `${prefix}:temp`, label, kind: "temperature", value: temperature, unit: "°C", source: this.id });
      }

      // Utilisation is a struct of two uints — GPU busy, then memory-bus
      // busy — so it's read as a two-element array and the first field taken.
      const utilization = this.readValue((buf) => this.api!.deviceGetUtilizationRates(handle, buf), 2);
      if (utilization !== null) {
        out.push({ id: `${prefix}:load`, label: `${label} load`, kind: "load", value: utilization, unit: "%", source: this.id });
      }

      const fan = this.readValue((buf) => this.api!.deviceGetFanSpeed(handle, buf));
      if (fan !== null) {
        out.push({ id: `${prefix}:fan`, label: `${label} fan`, kind: "load", value: fan, unit: "%", source: this.id });
      }

      const power = this.readValue((buf) => this.api!.deviceGetPowerUsage(handle, buf));
      if (power !== null) {
        out.push({
          id: `${prefix}:power`,
          label: `${label} power`,
          kind: "power",
          value: milliwattsToWatts(power),
          unit: "W",
          source: this.id,
        });
      }
    }
    return out;
  }

  async dispose(): Promise<void> {
    if (!this.api || !this.initialized) return;
    try {
      this.api.shutdown();
    } catch {
      // Best-effort — there is nothing useful to do if shutdown fails.
    }
    this.initialized = false;
  }

  /** The device name, when a caller wants it — kept separate since it never changes between polls. */
  nameOf(index: number): string | null {
    const handle = this.handleFor(index);
    if (!handle || !this.api) return null;
    const buffer = new Uint8Array(NAME_BUFFER_BYTES);
    try {
      if (this.api.deviceGetName(handle, buffer, NAME_BUFFER_BYTES) !== NVML_SUCCESS) return null;
      return readCString(buffer);
    } catch {
      return null;
    }
  }

  private handleFor(index: number): unknown {
    if (!this.api) return null;
    try {
      const holder: unknown[] = [null];
      if (this.api.deviceGetHandleByIndex(index, holder) !== NVML_SUCCESS) return null;
      return holder[0];
    } catch {
      return null;
    }
  }

  private readValue(call: (buffer: Uint32Array) => number, fields = 1): number | null {
    try {
      const buffer = new Uint32Array(fields);
      if (call(buffer) !== NVML_SUCCESS) return null;
      const value = buffer[0];
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  private loadLibrary(): NvmlApi | null {
    // Loaded lazily, exactly as the vendor clients are: a missing or
    // incompatible koffi binary must take down this one source, never the app.
    let koffi: typeof import("koffi");
    try {
      koffi = require("koffi") as typeof import("koffi");
    } catch {
      return null;
    }
    // Bare name first, so Windows' normal search order finds the copy the
    // driver installed. The explicit path is the fallback for older installs
    // that only place it under the NVSMI directory.
    for (const name of ["nvml.dll", "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvml.dll"]) {
      try {
        const lib = koffi.load(name);
        return {
          init: lib.func("int nvmlInit_v2()") as NvmlApi["init"],
          shutdown: lib.func("int nvmlShutdown()") as NvmlApi["shutdown"],
          deviceGetCount: lib.func("int nvmlDeviceGetCount_v2(_Out_ uint32_t *count)") as NvmlApi["deviceGetCount"],
          deviceGetHandleByIndex: lib.func(
            "int nvmlDeviceGetHandleByIndex_v2(uint32_t index, _Out_ void **device)"
          ) as NvmlApi["deviceGetHandleByIndex"],
          deviceGetName: lib.func(
            "int nvmlDeviceGetName(void *device, _Out_ char *name, uint32_t length)"
          ) as NvmlApi["deviceGetName"],
          deviceGetTemperature: lib.func(
            "int nvmlDeviceGetTemperature(void *device, int sensorType, _Out_ uint32_t *temp)"
          ) as NvmlApi["deviceGetTemperature"],
          deviceGetUtilizationRates: lib.func(
            "int nvmlDeviceGetUtilizationRates(void *device, _Out_ uint32_t *utilization)"
          ) as NvmlApi["deviceGetUtilizationRates"],
          deviceGetFanSpeed: lib.func(
            "int nvmlDeviceGetFanSpeed(void *device, _Out_ uint32_t *speed)"
          ) as NvmlApi["deviceGetFanSpeed"],
          deviceGetPowerUsage: lib.func(
            "int nvmlDeviceGetPowerUsage(void *device, _Out_ uint32_t *milliwatts)"
          ) as NvmlApi["deviceGetPowerUsage"],
        };
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
