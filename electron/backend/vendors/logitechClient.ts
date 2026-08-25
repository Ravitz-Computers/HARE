import { createRequire } from "node:module";
import type { KLColor } from "../types.js";

interface LogitechLedApi {
  LogiLedInit: () => boolean;
  LogiLedSetLighting: (r: number, g: number, b: number) => boolean;
  LogiLedShutdown: () => void;
}

const require = createRequire(import.meta.url);

// G HUB installs LogitechLedEnginesWrapper.dll system-wide (so any app can
// call it without bundling its own copy) -- tried first by bare name,
// relying on Windows' normal DLL search order (System32/PATH). LogitechLed.dll
// is the older Logitech Gaming Software (LGS) SDK name, still seen on some
// installs, tried as a fallback.
const CANDIDATE_DLL_NAMES = ["LogitechLedEnginesWrapper.dll", "LogitechLed.dll"];

/**
 * Client for Logitech's LED illumination SDK. Unlike Corsair/Aura, this is
 * a plain native DLL with a small Cdecl C export surface (no COM, no native
 * Node addon to compile) -- called directly via `koffi` FFI, which is why
 * `koffi` is a regular dependency here rather than an optionalDependency
 * like cue-sdk/winax.
 *
 * The exported function names/signatures (LogiLedInit, LogiLedSetLighting
 * taking 0-100 percentages per channel — not 0-255, LogiLedShutdown) are
 * sourced from Logitech's own SDK header and community C#/Rust bindings
 * (iFaxity/Logitech-.Net-SDK, henninglive/logitech-led), not guessed. The
 * DLL name G HUB actually ships under on a current install is the least
 * certain part — NOT verified against a real G HUB install in this
 * environment (no Windows, no G HUB, no Logitech hardware).
 */
export class LogitechClient {
  private api: LogitechLedApi | null = null;
  private initialized = false;

  get isConnected(): boolean {
    return this.initialized;
  }

  async connect(): Promise<{ ok: true } | { ok: false; message: string }> {
    if (process.platform !== "win32") {
      return { ok: false, message: "Logitech's LED SDK is Windows-only." };
    }
    if (!this.api) {
      this.api = this.loadLibrary();
      if (!this.api) {
        return { ok: false, message: "Couldn't find the Logitech LED SDK DLL — is G HUB installed?" };
      }
    }
    try {
      const ok = this.api.LogiLedInit();
      this.initialized = ok;
      return ok ? { ok: true } : { ok: false, message: "LogiLedInit() returned false." };
    } catch (err) {
      return {
        ok: false,
        message: `Logitech LED SDK init failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.api || !this.initialized) return { ok: false, message: "Not connected to the Logitech LED SDK yet." };
    try {
      // The SDK takes 0-100 percentages per channel, not 0-255.
      const ok = this.api.LogiLedSetLighting(
        Math.round((color.r / 255) * 100),
        Math.round((color.g / 255) * 100),
        Math.round((color.b / 255) * 100)
      );
      return ok ? { ok: true } : { ok: false, message: "LogiLedSetLighting() returned false." };
    } catch (err) {
      return { ok: false, message: `Logitech LED SDK call failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async disconnect(): Promise<void> {
    this.initialized = false;
    try {
      this.api?.LogiLedShutdown();
    } catch {
      // Best-effort — nothing useful to do if shutdown itself fails.
    }
  }

  private loadLibrary(): LogitechLedApi | null {
    // Loaded lazily (require, not a static import) so that if koffi's own
    // native binary is ever missing/incompatible for the machine HARE
    // actually runs on, that only takes down the Logitech vendor path —
    // never the whole app at startup. (koffi itself is cross-platform and
    // ships prebuilt binaries, so this is a defensive belt-and-suspenders
    // measure, not an expected failure mode.)
    let koffi: typeof import("koffi");
    try {
      koffi = require("koffi") as typeof import("koffi");
    } catch {
      return null;
    }
    for (const name of CANDIDATE_DLL_NAMES) {
      try {
        const lib = koffi.load(name);
        return {
          LogiLedInit: lib.func("bool LogiLedInit()") as () => boolean,
          LogiLedSetLighting: lib.func("bool LogiLedSetLighting(int, int, int)") as (
            r: number,
            g: number,
            b: number
          ) => boolean,
          LogiLedShutdown: lib.func("void LogiLedShutdown()") as () => void,
        };
      } catch {
        // Try the next candidate name.
      }
    }
    return null;
  }
}
