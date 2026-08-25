import type { DeviceBackend } from "./deviceBackend.js";
import type { VendorDeviceSource } from "./vendors/vendorBackend.js";
import type { BackendStatus, KLColor, KLDevice, ModeParamsPatch } from "./types.js";

/**
 * One device list from two sources: OpenRGB, and whatever vendor software is
 * connected.
 *
 * Everything above this — the effect runner, the Gallery, per-device
 * persistence, the second screen — sees a single flat list of devices and
 * never learns which source a given device came from. That is the whole
 * point: a Razer keyboard driven through Chroma should be as ordinary as a
 * motherboard driven through OpenRGB, and every feature should work on it
 * without a special case.
 *
 * Routing is by device id. Vendor devices are numbered from a high base (see
 * vendorDevices.ts), so which source owns an id is decidable without keeping
 * a lookup table in step.
 */
export class CompositeBackend implements DeviceBackend {
  readonly kind = "openrgb" as const;

  constructor(
    /**
     * Readable from outside so a caller can reach the real OpenRGB backend
     * for the few things that are about the *server* rather than about
     * devices -- restarting it, in particular. Everything else goes through
     * the wrapper, which is the whole point of it.
     */
    readonly primary: DeviceBackend,
    private readonly vendors: VendorDeviceSource
  ) {}

  async connect(): Promise<void> {
    await this.primary.connect();
    this.vendors.refresh();
  }

  async disconnect(): Promise<void> {
    await this.primary.disconnect();
  }

  async rescan(): Promise<void> {
    await this.primary.rescan();
    this.vendors.refresh();
  }

  getStatus(): BackendStatus {
    const status = this.primary.getStatus();
    // Vendor devices are real devices. If OpenRGB found nothing but a vendor
    // did, the app is connected to something and should say so rather than
    // reporting an empty error state over a working keyboard.
    if (status !== "connected" && this.vendors.getDevices().length > 0) return "connected";
    return status;
  }

  getStatusMessage(): string | undefined {
    return this.primary.getStatusMessage();
  }

  getDevices(): KLDevice[] {
    return [...this.primary.getDevices(), ...this.vendors.getDevices()];
  }

  /** Refreshes the vendor half and announces the merged list — called when vendor connections change. */
  refreshVendors(): void {
    this.vendors.refresh();
    this.emitDevices();
  }

  async setDeviceColor(deviceId: number, color: KLColor): Promise<void> {
    if (this.vendors.owns(deviceId)) {
      await this.vendors.setDeviceColor(deviceId, color);
      this.emitDevices();
      return;
    }
    await this.primary.setDeviceColor(deviceId, color);
  }

  async setZoneColor(deviceId: number, zoneId: number, color: KLColor): Promise<void> {
    if (this.vendors.owns(deviceId)) {
      await this.vendors.setZoneColor(deviceId, zoneId, color);
      this.emitDevices();
      return;
    }
    await this.primary.setZoneColor(deviceId, zoneId, color);
  }

  /**
   * Sets a resizable zone's LED count, on the real hardware.
   *
   * This method being missing is what made ARGB headers stay dark on a real
   * board *after* the resize feature was written: `resizeZone` is optional on
   * DeviceBackend, so a wrapper that didn't implement it made every call a
   * silent no-op — no error, no log line, nothing to notice. Vendor devices
   * have no resizable zones, so this always goes to the primary backend.
   */
  async resizeZone(deviceId: number, zoneId: number, ledCount: number): Promise<void> {
    if (this.vendors.owns(deviceId)) return;
    await this.primary.resizeZone?.(deviceId, zoneId, ledCount);
  }

  async setLedColors(deviceId: number, zoneId: number | null, colors: KLColor[]): Promise<void> {
    if (this.vendors.owns(deviceId)) {
      // Deliberately no emitDevices here: this is the 30fps effect path, and
      // broadcasting the whole device list on every frame would cost far more
      // than the write itself.
      await this.vendors.setLedColors(deviceId, zoneId, colors);
      return;
    }
    await this.primary.setLedColors(deviceId, zoneId, colors);
  }

  async setNativeMode(deviceId: number, modeId: number): Promise<void> {
    // Vendor devices have exactly one mode, so there is nothing to switch to.
    if (this.vendors.owns(deviceId)) return;
    await this.primary.setNativeMode(deviceId, modeId);
  }

  async updateModeParams(
    deviceId: number,
    modeId: number,
    patch: ModeParamsPatch,
    persist: boolean
  ): Promise<void> {
    if (this.vendors.owns(deviceId)) return;
    await this.primary.updateModeParams(deviceId, modeId, patch, persist);
  }

  async setRawLedColors(deviceId: number, colors: KLColor[]): Promise<void> {
    if (this.vendors.owns(deviceId)) {
      await this.vendors.setLedColors(deviceId, null, colors);
      this.emitDevices();
      return;
    }
    await this.primary.setRawLedColors(deviceId, colors);
  }

  onDevicesChanged(cb: (devices: KLDevice[]) => void): () => void {
    this.deviceListeners.add(cb);
    const unsubscribe = this.primary.onDevicesChanged(() => cb(this.getDevices()));
    return () => {
      this.deviceListeners.delete(cb);
      unsubscribe();
    };
  }

  onStatusChanged(cb: (status: BackendStatus, message?: string) => void): () => void {
    return this.primary.onStatusChanged((_, message) => cb(this.getStatus(), message));
  }

  private deviceListeners = new Set<(devices: KLDevice[]) => void>();

  private emitDevices(): void {
    const devices = this.getDevices();
    for (const listener of this.deviceListeners) {
      try {
        listener(devices);
      } catch {
        // One bad listener must not stop the others hearing about it.
      }
    }
  }
}
