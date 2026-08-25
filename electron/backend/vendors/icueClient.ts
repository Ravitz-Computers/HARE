import { createRequire } from "node:module";
import type { KLColor } from "../types.js";

interface CueDevice {
  id: string;
}
interface CueLedPosition {
  id: number;
}
interface CueLedColor {
  id: number;
  r: number;
  g: number;
  b: number;
  a: number;
}
interface CueSdkModule {
  CorsairConnect: (cb: (evt: { data: { state: number } }) => void) => void;
  CorsairDisconnect?: () => void;
  CorsairGetDevices: (filter: { deviceTypeMask: number }) => { error: number; data: CueDevice[] };
  CorsairGetLedPositions: (deviceId: string) => { error: number; data: CueLedPosition[] };
  CorsairSetLedColors: (deviceId: string, leds: CueLedColor[]) => { error: number };
  CorsairSessionState: { CSS_Connected: number; CSS_ConnectionRefused: number; CSS_Timeout: number };
  CorsairError: { CE_Success: number };
  CorsairDeviceType: { CDT_All: number };
}

const require = createRequire(import.meta.url);

/**
 * Client for Corsair's official iCUE SDK (github.com/CorsairOfficial/cue-sdk),
 * via the first-party `cue-sdk` Node native addon
 * (github.com/CorsairOfficial/cue-sdk-node) -- an optionalDependency (see
 * package.json), not a plain HTTP API like Chroma. That package's own
 * install step tries a prebuilt binary first (only published for old
 * Node/Electron versions) and falls back to compiling from source with
 * node-gyp, which needs Python plus a C++ toolchain on whatever machine runs
 * `npm install` -- if that machine doesn't have one, or has no network
 * access to fetch Node's headers, the module simply won't be there at
 * runtime. `require()` failing is treated as a normal, expected outcome
 * here (same bucket as "iCUE isn't running"), not a crash.
 *
 * The call shape below (CorsairConnect's event callback, CorsairGetDevices,
 * CorsairGetLedPositions, CorsairSetLedColors) is copied from that package's
 * own example app (example/color_pulse/app.js), not guessed -- but this has
 * NOT been run against a real iCUE install (no Windows, no iCUE, no Corsair
 * hardware in this environment). Verify against a real run before trusting
 * it blindly.
 */
export class IcueClient {
  private sdk: CueSdkModule | null = null;
  private connected = false;

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<{ ok: true } | { ok: false; message: string }> {
    if (process.platform !== "win32" && process.platform !== "darwin") {
      return { ok: false, message: "iCUE's SDK only runs on Windows or macOS." };
    }
    if (!this.sdk) {
      try {
        this.sdk = require("cue-sdk") as CueSdkModule;
      } catch {
        return {
          ok: false,
          message: "The iCUE SDK module isn't available on this build (it didn't compile for this machine).",
        };
      }
    }
    const sdk = this.sdk;
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, message: "Timed out waiting for iCUE to accept the connection." });
      }, 5000);
      try {
        sdk.CorsairConnect((evt) => {
          if (settled) return;
          const state = evt.data.state;
          if (state === sdk.CorsairSessionState.CSS_Connected) {
            settled = true;
            clearTimeout(timer);
            this.connected = true;
            resolve({ ok: true });
          } else if (
            state === sdk.CorsairSessionState.CSS_ConnectionRefused ||
            state === sdk.CorsairSessionState.CSS_Timeout
          ) {
            settled = true;
            clearTimeout(timer);
            resolve({ ok: false, message: "iCUE refused the connection — check its SDK setting is enabled." });
          }
        });
      } catch (err) {
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          message: `iCUE SDK connect failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  }

  async setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.sdk || !this.connected) return { ok: false, message: "Not connected to iCUE yet." };
    const sdk = this.sdk;
    try {
      const { error, data: devices } = sdk.CorsairGetDevices({ deviceTypeMask: sdk.CorsairDeviceType.CDT_All });
      if (error !== sdk.CorsairError.CE_Success || !devices.length) {
        return { ok: false, message: "iCUE reported no controllable devices." };
      }
      let anySucceeded = false;
      for (const device of devices) {
        const { data: positions } = sdk.CorsairGetLedPositions(device.id);
        if (!positions?.length) continue;
        const leds: CueLedColor[] = positions.map((p) => ({ id: p.id, r: color.r, g: color.g, b: color.b, a: 255 }));
        const result = sdk.CorsairSetLedColors(device.id, leds);
        if (result.error === sdk.CorsairError.CE_Success) anySucceeded = true;
      }
      return anySucceeded ? { ok: true } : { ok: false, message: "iCUE didn't accept the color on any device." };
    } catch (err) {
      return { ok: false, message: `iCUE SDK call failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      this.sdk?.CorsairDisconnect?.();
    } catch {
      // Best-effort — nothing useful to do if the disconnect call itself fails.
    }
  }
}
