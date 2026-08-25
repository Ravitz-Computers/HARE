import type { DeviceBackend } from "./deviceBackend.js";
import type { KLColor, KLDevice, BackendStatus, ModeParamsPatch } from "./types.js";

/**
 * BackendManager's placeholder when a real OpenRGB connection can't be
 * reached at all (no server running, HARE not elevated, etc). This is
 * deliberately NOT a "demo mode" -- there used to be one (MockBackend, now
 * FixtureBackend, substituted five fake devices whenever real hardware
 * wasn't found), and it actively hid the truth from users: someone with a
 * real, unsupported, or not-yet-connected setup would see a fully populated
 * device list and have no way to tell it wasn't real. Removed on purpose.
 *
 * NoDeviceBackend always reports zero devices and carries whatever
 * human-readable reason BackendManager gives it (couldn't reach OpenRGB,
 * lost a previously-live connection, etc) so the UI can show an honest "no
 * devices detected" state with a real explanation instead of a fake one.
 */
export class NoDeviceBackend implements DeviceBackend {
  readonly kind = "none" as const;
  private statusListeners = new Set<(status: BackendStatus, message?: string) => void>();
  private deviceListeners = new Set<(devices: KLDevice[]) => void>();

  constructor(
    private status: BackendStatus = "disconnected",
    private statusMessage?: string
  ) {}

  async connect(): Promise<void> {
    this.statusListeners.forEach((cb) => cb(this.status, this.statusMessage));
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
  }

  /**
   * BackendManager special-cases rescan() for this backend kind and calls
   * start() again instead (re-attempting the real OpenRGB connection) — see
   * backendManager.ts. This exists only so NoDeviceBackend fully satisfies
   * DeviceBackend; it should never actually run.
   */
  async rescan(): Promise<void> {}

  getStatus(): BackendStatus {
    return this.status;
  }

  getStatusMessage(): string | undefined {
    return this.statusMessage;
  }

  getDevices(): KLDevice[] {
    return [];
  }

  async setDeviceColor(_deviceId: number, _color: KLColor): Promise<void> {}
  async setZoneColor(_deviceId: number, _zoneId: number, _color: KLColor): Promise<void> {}
  async setLedColors(_deviceId: number, _zoneId: number | null, _colors: KLColor[]): Promise<void> {}
  async setNativeMode(_deviceId: number, _modeId: number): Promise<void> {}
  async updateModeParams(_deviceId: number, _modeId: number, _patch: ModeParamsPatch, _persist: boolean): Promise<void> {}
  async setRawLedColors(_deviceId: number, _colors: KLColor[]): Promise<void> {}

  onDevicesChanged(cb: (devices: KLDevice[]) => void): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  onStatusChanged(cb: (status: BackendStatus, message?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}
