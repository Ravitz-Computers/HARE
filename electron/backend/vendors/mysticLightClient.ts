import { createRequire } from "node:module";
import type { KLColor } from "../types.js";

const require = createRequire(import.meta.url);

/**
 * Client for MSI Mystic Light, via MSI's own native SDK.
 *
 * A CORRECTION WORTH RECORDING
 *
 * This was previously described in HARE's own docs as blocked, on the grounds
 * that the Mystic Light DLL is 32-bit only and therefore can't be loaded into
 * a 64-bit process. That was true of the original 2018 SDK, and it is no
 * longer true: MSI ships `MysticLight_SDK_x64.dll` alongside the 32-bit one.
 * The integration is entirely possible; it's just fiddlier than the others.
 *
 * WHAT MAKES IT FIDDLY
 *
 * Unlike Chroma (JSON over HTTP) or Logitech (plain C ints), Mystic Light's
 * exports use two COM automation types:
 *
 *  - **BSTR** — a wide string with a 4-byte length prefix stored *before* the
 *    pointer you're given, allocated by `SysAllocString` from `OleAut32`. You
 *    cannot pass a normal C string where one is expected.
 *  - **SAFEARRAY** — a descriptor struct with the element data behind a
 *    pointer, used by `MLAPI_GetDeviceInfo` to hand back the device list and
 *    each device's LED count.
 *
 * Both are handled here through `koffi`, which already ships with HARE for
 * the Logitech binding. The device/LED enumeration is read by walking the
 * SAFEARRAY descriptor rather than guessing device names, so this reports
 * what the machine actually has instead of a hardcoded list.
 *
 * REQUIREMENTS AND OVERLAP
 *
 * MSI Center (or the older Dragon Center) must be installed and running, and
 * HARE needs administrator rights for the SDK to initialise. Both are real
 * costs, and for most people they buy nothing: MSI motherboard lighting is
 * already driven directly through OpenRGB with no vendor software at all.
 * This module is for MSI devices OpenRGB can't reach. See
 * modules/moduleRegistry.ts on why that distinction is surfaced in the UI.
 *
 * UNVERIFIED: no Windows machine, no MSI hardware and no MSI Center install
 * were available. The call shapes come from MSI's published SDK reference and
 * the community C++/Rust wrappers built against it. The translation layer is
 * covered by test/verify-vendor-modules.mjs against a simulated binding.
 */

/** Element type of a SAFEARRAY of BSTRs, from the COM VARENUM enum. */
const VT_BSTR = 8;

interface KoffiLib {
  func(signature: string): (...args: unknown[]) => unknown;
}
interface Koffi {
  load(name: string): KoffiLib;
  alloc(type: string, count: number): unknown;
  decode(ptr: unknown, type: string, length?: number): unknown;
  pointer(type: string): string;
  struct(name: string, fields: Record<string, string>): string;
  as(value: unknown, type: string): unknown;
}

export class MysticLightClient {
  private lib: KoffiLib | null = null;
  private oleaut: KoffiLib | null = null;
  private connected = false;

  /** Device type strings and their LED counts, as reported by the SDK. */
  private devices: { type: string; ledCount: number }[] = [];

  private setLedColor: ((type: unknown, index: number, r: number, g: number, b: number) => unknown) | null = null;
  private sysAllocString: ((wide: Buffer) => unknown) | null = null;
  private sysFreeString: ((bstr: unknown) => unknown) | null = null;

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<{ ok: true } | { ok: false; message: string }> {
    if (process.platform !== "win32") {
      return { ok: false, message: "Mystic Light is a Windows-only integration." };
    }

    let koffi: Koffi;
    try {
      koffi = require("koffi") as Koffi;
    } catch {
      return { ok: false, message: "The Mystic Light module isn't installed." };
    }

    // x64 first — HARE is a 64-bit process, so the 32-bit DLL can never load
    // here. Trying it anyway (and reporting its failure) would be misleading.
    let lib: KoffiLib | null = null;
    for (const name of ["MysticLight_SDK_x64.dll", "MysticLight_SDK.dll"]) {
      try {
        lib = koffi.load(name);
        break;
      } catch {
        // Keep trying; the message below covers all failures.
      }
    }
    if (!lib) {
      return {
        ok: false,
        message:
          "Couldn't load MSI's lighting library. It comes with MSI Center — make sure that's installed and running.",
      };
    }

    try {
      this.oleaut = koffi.load("OleAut32.dll");
      // BSTR allocation and release. A BSTR is a pointer to UTF-16 with its
      // byte length stored in the four bytes before it, so it must come from
      // SysAllocString rather than being faked with a plain buffer.
      this.sysAllocString = this.oleaut.func("void* SysAllocString(const uint16_t *)") as typeof this.sysAllocString;
      this.sysFreeString = this.oleaut.func("void SysFreeString(void *)") as typeof this.sysFreeString;

      const initialize = lib.func("int MLAPI_Initialize()");
      const status = initialize() as number;
      // The SDK returns 0 on success. The most common non-zero cause by far
      // is running without administrator rights, so it's called out by name
      // rather than surfaced as a bare error code.
      if (status !== 0) {
        return {
          ok: false,
          message:
            `MSI's lighting library wouldn't start (code ${status}). ` +
            "It needs MSI Center running, and HARE started as administrator.",
        };
      }

      this.setLedColor = lib.func(
        "int MLAPI_SetLedColor(void *type, uint32_t index, uint32_t r, uint32_t g, uint32_t b)"
      ) as typeof this.setLedColor;

      this.devices = this.readDeviceInfo(koffi, lib);
      this.lib = lib;
      this.connected = true;
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: `MSI's lighting library failed to start: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Reads the device list out of the two SAFEARRAYs `MLAPI_GetDeviceInfo`
   * fills in.
   *
   * Both arrive as arrays of BSTR — including the LED counts, which the SDK
   * returns as strings rather than numbers. Walking the descriptor by hand is
   * the only way to get at them, since koffi has no native SAFEARRAY support.
   *
   * Failure here is deliberately non-fatal: without the device list HARE
   * simply has nothing to drive, which setColor reports honestly, rather than
   * the whole connection being treated as broken.
   */
  private readDeviceInfo(koffi: Koffi, lib: KoffiLib): { type: string; ledCount: number }[] {
    try {
      const getDeviceInfo = lib.func("int MLAPI_GetDeviceInfo(void **devices, void **ledCounts)");

      const devicesOut = koffi.alloc("void *", 1);
      const countsOut = koffi.alloc("void *", 1);
      const status = getDeviceInfo(devicesOut, countsOut) as number;
      if (status !== 0) return [];

      const deviceNames = this.readBstrSafeArray(koffi, koffi.decode(devicesOut, "void *"));
      const ledCounts = this.readBstrSafeArray(koffi, koffi.decode(countsOut, "void *"));

      return deviceNames.map((type, i) => ({
        type,
        // The SDK reports LED counts as strings; anything unparseable is
        // treated as a single zone rather than dropping the device entirely.
        ledCount: Math.max(1, Number.parseInt(ledCounts[i] ?? "1", 10) || 1),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Walks a SAFEARRAY of BSTRs.
   *
   * The layout is fixed by COM:
   *   uint16 cDims, uint16 fFeatures, uint32 cbElements, uint32 cLocks,
   *   void*  pvData, then one SAFEARRAYBOUND { uint32 cElements, int32 lLbound }.
   *
   * `pvData` points at `cElements` BSTR pointers, each of which is UTF-16
   * with its byte length in the four bytes immediately before it.
   */
  private readBstrSafeArray(koffi: Koffi, arrayPtr: unknown): string[] {
    if (!arrayPtr) return [];
    const SafeArray = koffi.struct("HARE_SAFEARRAY", {
      cDims: "uint16_t",
      fFeatures: "uint16_t",
      cbElements: "uint32_t",
      cLocks: "uint32_t",
      pvData: "void *",
      cElements: "uint32_t",
      lLbound: "int32_t",
    });

    const header = koffi.decode(arrayPtr, SafeArray) as {
      cDims: number;
      fFeatures: number;
      cElements: number;
      pvData: unknown;
    };
    // A single dimension of BSTRs is the only shape this SDK returns; anything
    // else means the layout assumption is wrong, and reading on would produce
    // garbage rather than an error.
    if (header.cDims !== 1 || !header.pvData) return [];
    if (header.fFeatures !== 0 && (header.fFeatures & VT_BSTR) === 0 && header.fFeatures !== 0x0100) {
      // FADF_BSTR is 0x0100; some builds report 0. Anything else is unexpected.
      return [];
    }

    const count = Math.min(header.cElements, 64); // sanity bound
    const pointers = koffi.decode(header.pvData, "void *", count) as unknown[];
    const out: string[] = [];
    for (const ptr of pointers) {
      if (!ptr) continue;
      try {
        out.push(String(koffi.decode(ptr, "str16")));
      } catch {
        out.push("");
      }
    }
    return out;
  }

  async setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.connected || !this.setLedColor || !this.sysAllocString) {
      return { ok: false, message: "Not connected to Mystic Light." };
    }
    if (this.devices.length === 0) {
      return { ok: false, message: "Mystic Light is running but reported no controllable devices." };
    }

    const r = clampByte(color.r);
    const g = clampByte(color.g);
    const b = clampByte(color.b);

    let wrote = 0;
    for (const device of this.devices) {
      // A fresh BSTR per device, freed immediately after use — the SDK copies
      // what it needs, and leaking one per call on a 30fps effect loop would
      // add up fast.
      const bstr = this.sysAllocString(toWideBuffer(device.type));
      try {
        for (let index = 0; index < device.ledCount; index++) {
          this.setLedColor(bstr, index, r, g, b);
          wrote++;
        }
      } finally {
        this.sysFreeString?.(bstr);
      }
    }

    return wrote > 0
      ? { ok: true }
      : { ok: false, message: "Mystic Light accepted the connection but nothing was lit." };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.devices = [];
    this.setLedColor = null;
    this.lib = null;
    // MSI's SDK has no documented shutdown call — releasing the references is
    // all there is to do.
  }
}

/** UTF-16LE with a null terminator, which is what SysAllocString expects. */
function toWideBuffer(value: string): Buffer {
  return Buffer.from(value + "\0", "utf16le");
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
