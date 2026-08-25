import { createRequire } from "node:module";
import type { KLColor } from "../types.js";

type ComObject = any;

interface WinaxModule {
  Object: new (progId: string) => ComObject;
}

const require = createRequire(import.meta.url);

/**
 * Client for ASUS's Aura Sync SDK -- a local COM server (AuraServiceLib,
 * hosted by LightingService.exe) rather than a plain DLL or HTTP API, called
 * here via `winax` (Node COM automation, itself a native addon that needs to
 * compile for this machine — same optionalDependency caveat as
 * icueClient.ts's cue-sdk). COM objects are inherently dynamic (methods and
 * properties resolved at call time, not statically typed), so `ComObject`
 * here is deliberately `any` rather than a fabricated interface.
 *
 * The call sequence — `Dispatch("aura.sdk.1")`, `SwitchMode()`,
 * `Enumerate(0)`, per-device `Lights` collection, `Apply()` — and the packed
 * color format (`0x00GGBBRR`) come straight from ASUS's own Aura SDK v3.1
 * Python tutorial (asus.com/microsite/aurareadydevportal/tutorial_python.html),
 * translated to winax's COM automation calling convention. NOT verified
 * against a real Aura install in this environment (no Windows, no Aura
 * Sync, no ASUS hardware) — the biggest unknown is whether winax's COM
 * automation actually marshals a numeric collection-indexer call
 * (`devices(i)`) the same way Python's win32com does; double-check that
 * first on a real run.
 */
export class AuraClient {
  private winax: WinaxModule | null = null;
  private sdk: ComObject | null = null;

  get isConnected(): boolean {
    return this.sdk !== null;
  }

  async connect(): Promise<{ ok: true } | { ok: false; message: string }> {
    if (process.platform !== "win32") {
      return { ok: false, message: "Aura Sync's SDK is Windows-only." };
    }
    if (!this.winax) {
      try {
        this.winax = require("winax") as WinaxModule;
      } catch {
        return {
          ok: false,
          message: "The Aura COM bridge isn't available on this build (it didn't compile for this machine).",
        };
      }
    }
    try {
      const sdk: ComObject = new this.winax.Object("aura.sdk.1");
      sdk.SwitchMode();
      this.sdk = sdk;
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: `Couldn't reach Aura's SDK COM server: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.sdk) return { ok: false, message: "Not connected to Aura yet." };
    try {
      const devices: ComObject = this.sdk.Enumerate(0);
      const count = Number(devices.Count ?? 0);
      if (!count) return { ok: false, message: "Aura reported no controllable devices." };
      // Aura's packed color format per its own SDK docs: 0x00GGBBRR.
      const packed = (color.g << 16) | (color.b << 8) | color.r;
      let anySucceeded = false;
      for (let i = 0; i < count; i++) {
        const device: ComObject = devices(i);
        const lights: ComObject = device.Lights;
        const lightCount = Number(lights.Count ?? 0);
        for (let j = 0; j < lightCount; j++) {
          lights(j).color = packed;
        }
        device.Apply();
        anySucceeded = true;
      }
      return anySucceeded ? { ok: true } : { ok: false, message: "Aura didn't accept the color on any device." };
    } catch (err) {
      return { ok: false, message: `Aura SDK call failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async disconnect(): Promise<void> {
    this.sdk = null;
  }
}
