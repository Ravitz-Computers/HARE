import type { DevicePreference, KLDevice } from "./types.js";

/**
 * Device identity and preference validation.
 *
 * Deliberately free of any Electron import so it can be unit-tested directly
 * — this is the part with the actual reasoning in it, and it is exactly the
 * part worth testing. DevicePrefsStore handles the file on disk.
 */

/**
 * A stable key for a device across restarts.
 *
 * `allDevices` is needed to work out the ordinal among identical siblings, so
 * this must be given the full current device list, not just the one device.
 */
export function deviceFingerprint(device: KLDevice, allDevices: KLDevice[]): string {
  const base = `${device.vendor}::${device.name}::${device.colors.length}`;
  const siblings = allDevices.filter(
    (d) => `${d.vendor}::${d.name}::${d.colors.length}` === base
  );
  const ordinal = siblings.findIndex((d) => d.id === device.id);
  return `${base}::${ordinal < 0 ? 0 : ordinal}`;
}

/** Runtime guard — this comes off disk, so it is never trusted blindly. */
export function isDevicePreference(value: unknown): value is DevicePreference {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "color") return isColor(v.color);
  if (v.kind === "mode") return typeof v.modeId === "number";
  // A painting. Every entry has to be a colour: one bad element would be
  // written to the hardware as undefined on the next boot.
  if (v.kind === "raw") return Array.isArray(v.colors) && v.colors.length > 0 && v.colors.every(isColor);
  if (v.kind === "effect") {
    const a = v.assignment as Record<string, unknown> | undefined;
    return (
      typeof a === "object" &&
      a !== null &&
      typeof a.effectId === "string" &&
      typeof a.speed === "number" &&
      typeof a.brightness === "number" &&
      isColor(a.color)
    );
  }
  return false;
}

function isColor(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number";
}
