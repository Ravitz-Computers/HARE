import type { KLColor, KLDevice, BackendStatus, ModeParamsPatch } from "./types.js";

/**
 * Common interface every hardware backend must implement. Today there are
 * two: OpenRgbBackend (talks to a real OpenRGB SDK server) and
 * NoDeviceBackend (the placeholder BackendManager uses when OpenRGB itself
 * can't be reached at all -- not a fake-devices "demo mode", just an honest
 * empty state with a reason). A future VendorSdkBackend (Corsair iCUE,
 * Razer Chroma, etc.) slots in the same way — the rest of the app never
 * needs to know which backend is active.
 */
export interface DeviceBackend {
  // "fixture" is the third implementation, FixtureBackend -- populated
  // sample devices used ONLY by the browser-only dev preview
  // (src/lib/browserBackend.ts, never reachable in the packaged app) and by
  // the automated test suite. BackendManager (the real app's orchestrator)
  // never constructs one.
  readonly kind: "openrgb" | "none" | "fixture" | "vendor";

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  rescan(): Promise<void>;

  getStatus(): BackendStatus;
  /** The most recent human-readable detail that came with the current status (e.g. *why* no real devices were found), if any. */
  getStatusMessage(): string | undefined;
  getDevices(): KLDevice[];

  /** Sets every LED on a device to one flat color (used for "static" outside the effect loop, and as a fallback). */
  setDeviceColor(deviceId: number, color: KLColor): Promise<void>;
  setZoneColor(deviceId: number, zoneId: number, color: KLColor): Promise<void>;

  /** Pushes a full per-LED color frame — the hot path used by the effects engine. */
  /**
   * Tells the hardware how many LEDs are on a resizable zone. Optional: only
   * OpenRGB-backed devices have resizable zones, and a backend that has none
   * simply doesn't implement it.
   */
  resizeZone?(deviceId: number, zoneId: number, ledCount: number): Promise<void>;

  setLedColors(deviceId: number, zoneId: number | null, colors: KLColor[]): Promise<void>;

  /** Switches a device to one of its own native modes (e.g. built-in "Rainbow" on a motherboard). */
  setNativeMode(deviceId: number, modeId: number): Promise<void>;

  /**
   * Advanced Mode: updates a native mode's own parameters (speed, brightness,
   * direction, colorMode, its own color slots) rather than just picking which
   * mode is active. `persist` chooses whether this only takes effect live
   * (false) or is written to the device's own onboard memory too (true) —
   * mirrors OpenRGB's updateMode vs. saveMode.
   */
  updateModeParams(deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean): Promise<void>;

  /** Advanced Mode: pushes a full per-device LED color array directly, bypassing HARE's effect system entirely — the raw per-LED painter's write path. */
  setRawLedColors(deviceId: number, colors: KLColor[]): Promise<void>;

  onDevicesChanged(cb: (devices: KLDevice[]) => void): () => void;
  onStatusChanged(cb: (status: BackendStatus, message?: string) => void): () => void;
}
