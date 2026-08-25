import { createRequire } from "node:module";
import type { SensorProvider, SensorReading } from "../sensorTypes.js";

const require = createRequire(import.meta.url);

/**
 * GPU temperature from AMD's display library.
 *
 * Like NVML on the NVIDIA side, `atiadlxx.dll` is installed with the Adrenalin
 * graphics driver, so this needs no download and no elevation.
 *
 * Two deliberate simplifications, because ADL is a much larger and more
 * version-dependent API than NVML:
 *
 * **Temperature only.** Fan and load live behind Overdrive version-specific
 * calls that differ between GCC, RDNA and RDNA3 cards, and getting one wrong
 * returns plausible-looking nonsense rather than an error. A user who wants
 * the full picture on an AMD card is better served by the
 * LibreHardwareMonitor bridge, which HARE already supports.
 *
 * **Adapters are probed rather than enumerated.** The proper route is
 * `ADL2_Adapter_AdapterInfo_Get`, which fills a large array of a struct whose
 * layout has changed across SDK versions — exactly the kind of thing that
 * misreads silently. Instead HARE asks each adapter index in turn for a
 * temperature and keeps the ones that answer. Inactive indices simply return
 * an error code, which costs one call and cannot be misinterpreted.
 *
 * Temperatures come back in **millidegrees**, which is the single easiest
 * thing to get wrong here (a raw reading would display as "52000 °C").
 *
 * NOT verified against a real AMD GPU — no such hardware here.
 */

const ADL_OK = 0;
/** Adapter indices beyond a handful are not real; ADL's own tools cap enumeration similarly. */
const MAX_ADAPTERS = 16;

interface AdlApi {
  mainControlCreate(callback: unknown, enumConnected: number, context: unknown[]): number;
  mainControlDestroy(context: unknown): number;
  numberOfAdapters(context: unknown, out: Int32Array): number;
  /** Overdrive 6 — older cards. Three arguments, millidegrees out. */
  overdrive6Temperature?(context: unknown, adapterIndex: number, out: Int32Array): number;
  /** Overdrive N — newer cards. Takes a sensor type as well; 1 is the core/edge sensor. */
  overdriveNTemperature?(context: unknown, adapterIndex: number, type: number, out: Int32Array): number;
}

/** ADLODNTemperatureType_CORE — the die sensor, the one every tool shows as "GPU temp". */
const ODN_TEMPERATURE_CORE = 1;

/** Millidegrees Celsius to °C, rounded to one decimal — ADL's Overdrive temperature unit. */
export function milliDegreesToCelsius(value: number): number {
  return Math.round(value / 100) / 10;
}

/** A temperature ADL could plausibly have meant. Anything outside this is a misread struct, not a hot GPU. */
export function isPlausibleGpuTemperature(celsius: number): boolean {
  return Number.isFinite(celsius) && celsius > 0 && celsius < 150;
}

export class AmdGpuProvider implements SensorProvider {
  readonly id = "amd-gpu" as const;
  readonly name = "AMD GPU";
  private api: AdlApi | null = null;
  private context: unknown = null;
  private adapters: number[] = [];
  /** Kept alive for as long as ADL might call it — a garbage-collected callback would crash the process. */
  private allocCallback: unknown = null;

  async probe(): Promise<{ available: boolean; detail: string }> {
    if (process.platform !== "win32") return { available: false, detail: "Windows only." };
    if (!this.api) {
      this.api = this.loadLibrary();
      if (!this.api) return { available: false, detail: "No AMD graphics driver found on this PC." };
    }
    if (!this.context) {
      try {
        const holder: unknown[] = [null];
        // enumConnected = 1: only adapters that are actually present.
        if (this.api.mainControlCreate(this.allocCallback, 1, holder) !== ADL_OK) {
          return { available: false, detail: "AMD's display library wouldn't start." };
        }
        this.context = holder[0];
      } catch (err) {
        return { available: false, detail: describe(err) };
      }
    }
    this.adapters = this.findAdaptersWithTemperature();
    if (this.adapters.length === 0) {
      return { available: false, detail: "No AMD GPU reporting a temperature." };
    }
    return { available: true, detail: `Temperature from ${this.adapters.length} AMD GPU${this.adapters.length === 1 ? "" : "s"}.` };
  }

  async read(): Promise<SensorReading[]> {
    if (!this.api || !this.context) return [];
    const out: SensorReading[] = [];
    this.adapters.forEach((adapterIndex, position) => {
      const celsius = this.temperatureOf(adapterIndex);
      if (celsius === null) return;
      out.push({
        id: `amd:${adapterIndex}:temp`,
        label: this.adapters.length === 1 ? "GPU" : `GPU ${position + 1}`,
        kind: "temperature",
        value: celsius,
        unit: "°C",
        source: this.id,
      });
    });
    return out;
  }

  async dispose(): Promise<void> {
    if (this.api && this.context) {
      try {
        this.api.mainControlDestroy(this.context);
      } catch {
        // Best-effort.
      }
    }
    this.context = null;
    this.adapters = [];
  }

  private findAdaptersWithTemperature(): number[] {
    if (!this.api || !this.context) return [];
    let count = MAX_ADAPTERS;
    try {
      const buffer = new Int32Array(1);
      if (this.api.numberOfAdapters(this.context, buffer) === ADL_OK && buffer[0] > 0) {
        count = Math.min(buffer[0], MAX_ADAPTERS);
      }
    } catch {
      // Fall back to probing the default range.
    }
    const found: number[] = [];
    for (let index = 0; index < count; index++) {
      if (this.temperatureOf(index) !== null) found.push(index);
    }
    return found;
  }

  /**
   * Asks whichever Overdrive generation this card answers to.
   *
   * AMD replaced the Overdrive API wholesale between card generations and
   * both are still exported by the same DLL, so there is no way to tell from
   * the library alone which one a given adapter supports. Trying Overdrive 6
   * first and falling back to Overdrive N costs one failed call on newer
   * cards and covers both without needing to identify the hardware.
   */
  private temperatureOf(adapterIndex: number): number | null {
    if (!this.api || !this.context) return null;
    const buffer = new Int32Array(1);

    if (this.api.overdrive6Temperature) {
      try {
        if (this.api.overdrive6Temperature(this.context, adapterIndex, buffer) === ADL_OK) {
          const celsius = milliDegreesToCelsius(buffer[0]);
          if (isPlausibleGpuTemperature(celsius)) return celsius;
        }
      } catch {
        // Fall through to Overdrive N.
      }
    }

    if (this.api.overdriveNTemperature) {
      try {
        if (this.api.overdriveNTemperature(this.context, adapterIndex, ODN_TEMPERATURE_CORE, buffer) === ADL_OK) {
          const celsius = milliDegreesToCelsius(buffer[0]);
          if (isPlausibleGpuTemperature(celsius)) return celsius;
        }
      } catch {
        // Neither generation answered for this adapter.
      }
    }
    return null;
  }

  private loadLibrary(): AdlApi | null {
    let koffi: typeof import("koffi");
    try {
      koffi = require("koffi") as typeof import("koffi");
    } catch {
      return null;
    }
    try {
      const lib = koffi.load("atiadlxx.dll");
      // ADL allocates through a caller-supplied allocator. Node's own
      // allocation is fine for this; what matters is that the callback stays
      // referenced for the library's whole lifetime.
      const AllocCallback = koffi.proto("void *ADL_Main_Memory_Alloc(int size)");
      this.allocCallback = koffi.register(
        (size: number) => Buffer.alloc(Math.max(0, size)),
        koffi.pointer(AllocCallback)
      );
      const api: AdlApi = {
        mainControlCreate: lib.func(
          "int ADL2_Main_Control_Create(void *callback, int enumConnected, _Out_ void **context)"
        ) as AdlApi["mainControlCreate"],
        mainControlDestroy: lib.func("int ADL2_Main_Control_Destroy(void *context)") as AdlApi["mainControlDestroy"],
        numberOfAdapters: lib.func(
          "int ADL2_Adapter_NumberOfAdapters_Get(void *context, _Out_ int *count)"
        ) as AdlApi["numberOfAdapters"],
      };
      // Each Overdrive generation is bound only if this driver exports it,
      // so an older driver missing the newer symbol still works.
      try {
        api.overdrive6Temperature = lib.func(
          "int ADL2_Overdrive6_Temperature_Get(void *context, int adapterIndex, _Out_ int *temperature)"
        ) as NonNullable<AdlApi["overdrive6Temperature"]>;
      } catch {
        // Not exported by this driver.
      }
      try {
        api.overdriveNTemperature = lib.func(
          "int ADL2_OverdriveN_Temperature_Get(void *context, int adapterIndex, int temperatureType, _Out_ int *temperature)"
        ) as NonNullable<AdlApi["overdriveNTemperature"]>;
      } catch {
        // Not exported by this driver.
      }
      if (!api.overdrive6Temperature && !api.overdriveNTemperature) return null;
      return api;
    } catch {
      return null;
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
