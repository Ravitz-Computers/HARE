import { VENDOR_DEFINITIONS } from "./vendorDefinitions.js";
import { dominantColor, toKLDevice, vendorForDeviceId, type VendorDeviceSpec } from "./vendorDevices.js";
import type { KLColor, KLDevice, VendorId } from "../types.js";

/**
 * Presents connected vendor software as ordinary devices.
 *
 * The contract a vendor client has to meet is deliberately small — describe
 * your devices, take a frame — because that is all the effect engine needs.
 * Everything else HARE can do to a device (looks, layers, persistence, the
 * second screen) then works on vendor hardware for free, because none of it
 * knows or cares where a device came from.
 */

export interface FrameCapableVendorClient {
  readonly isConnected: boolean;
  connect(): Promise<{ ok: true } | { ok: false; message: string }>;
  setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }>;
  disconnect(): Promise<void>;
  /**
   * What this vendor is currently driving. Optional: a client that hasn't
   * been taught to enumerate reports nothing and simply contributes no
   * devices, rather than guessing at hardware that may not be there.
   */
  listDevices?(): VendorDeviceSpec[];
  /**
   * Writes one frame to one of those devices. Optional — without it, the
   * frame is reduced to a single colour and sent through setColor, which is
   * what most vendor SDKs accept anyway.
   */
  setDeviceFrame?(key: string, colors: KLColor[]): Promise<{ ok: true } | { ok: false; message: string }>;
}

interface Entry {
  vendorId: VendorId;
  spec: VendorDeviceSpec;
  device: KLDevice;
}

/**
 * What a vendor contributes when it can't enumerate its own hardware — which
 * is all of them today.
 *
 * This is the honest shape of these SDKs. Razer's REST API, for instance,
 * accepts writes to a "keyboard" category whether or not a Razer keyboard is
 * plugged in, and offers no way to ask what is actually connected. Listing
 * five per-category devices would therefore put hardware in the user's device
 * list that they may not own — exactly the fake-device problem HARE removed
 * everywhere else.
 *
 * So a vendor is one device, named for what it really is: everything that
 * vendor's software is driving. Effects run across it, it saves into looks,
 * it persists across reboots, and it appears on the second screen — all the
 * things it could not do before. What it can't do is show a gradient across
 * one keyboard, and that waits on an SDK that will say what's connected.
 */
function defaultSpecFor(vendorId: VendorId): VendorDeviceSpec {
  return {
    key: vendorId,
    name: `${VENDOR_DEFINITIONS.find((v) => v.id === vendorId)?.name ?? vendorId} lighting`,
    type: "unknown",
    // Enough LEDs for an effect to look like itself when previewed, few
    // enough that the per-frame reduction stays cheap.
    ledCount: 16,
    resolution: "whole-device",
  };
}

export class VendorDeviceSource {
  private entries: Entry[] = [];

  constructor(private readonly clients: Partial<Record<VendorId, FrameCapableVendorClient>>) {}

  /** Rebuilds the device list from whatever is connected right now. */
  refresh(): KLDevice[] {
    const entries: Entry[] = [];
    for (const definition of VENDOR_DEFINITIONS) {
      const client = this.clients[definition.id];
      if (!client?.isConnected) continue;
      let specs: VendorDeviceSpec[];
      try {
        specs = client.listDevices?.() ?? [defaultSpecFor(definition.id)];
      } catch {
        // A vendor that fails to enumerate contributes nothing. It must never
        // take the whole device list down with it.
        continue;
      }
      specs.forEach((spec, index) => {
        entries.push({
          vendorId: definition.id,
          spec,
          device: toKLDevice(definition.id, definition.name, spec, index),
        });
      });
    }
    this.entries = entries;
    return this.getDevices();
  }

  getDevices(): KLDevice[] {
    return this.entries.map((entry) => entry.device);
  }

  owns(deviceId: number): boolean {
    return vendorForDeviceId(deviceId) !== null && this.entries.some((e) => e.device.id === deviceId);
  }

  /**
   * Writes a frame to a vendor device.
   *
   * Where the SDK takes per-LED data it gets the frame as-is; where it takes
   * one colour, the frame is reduced first. The device's own cached colours
   * are updated either way, so the UI shows what was actually asked for
   * rather than what the hardware could manage.
   */
  async setLedColors(deviceId: number, zoneId: number | null, colors: KLColor[]): Promise<void> {
    const entry = this.entries.find((e) => e.device.id === deviceId);
    if (!entry) return;
    const client = this.clients[entry.vendorId];
    if (!client?.isConnected) return;

    const zone = zoneId === null ? null : entry.device.zones.find((z) => z.id === zoneId);
    if (zone) {
      for (let i = 0; i < zone.ledCount && i < colors.length; i++) {
        entry.device.colors[zone.ledStart + i] = colors[i];
      }
    } else {
      for (let i = 0; i < entry.device.colors.length; i++) {
        entry.device.colors[i] = colors[i] ?? colors[colors.length - 1] ?? { r: 0, g: 0, b: 0 };
      }
    }

    try {
      if (entry.spec.resolution === "per-led" && client.setDeviceFrame) {
        await client.setDeviceFrame(entry.spec.key, entry.device.colors);
      } else {
        await client.setColor(dominantColor(entry.device.colors));
      }
    } catch {
      // A failed write is a dropped frame, not an error worth surfacing —
      // the next frame is milliseconds away, and vendor software restarting
      // underneath HARE is an ordinary event.
    }
  }

  async setDeviceColor(deviceId: number, color: KLColor): Promise<void> {
    const entry = this.entries.find((e) => e.device.id === deviceId);
    if (!entry) return;
    await this.setLedColors(deviceId, null, new Array(entry.device.colors.length).fill(color));
  }

  async setZoneColor(deviceId: number, zoneId: number, color: KLColor): Promise<void> {
    const entry = this.entries.find((e) => e.device.id === deviceId);
    const zone = entry?.device.zones.find((z) => z.id === zoneId);
    if (!entry || !zone) return;
    await this.setLedColors(deviceId, zoneId, new Array(zone.ledCount).fill(color));
  }
}
