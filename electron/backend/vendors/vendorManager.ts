import { VENDOR_DEFINITIONS } from "./vendorDefinitions.js";
import { detectRunningVendors } from "./vendorDetection.js";
import { ChromaClient } from "./chromaClient.js";
import { IcueClient } from "./icueClient.js";
import { LogitechClient } from "./logitechClient.js";
import { AuraClient } from "./auraClient.js";
import { GamesenseClient } from "./gamesenseClient.js";
import { MysticLightClient } from "./mysticLightClient.js";
import { VendorDeviceSource } from "./vendorBackend.js";
import type { KLColor, VendorId, VendorStatus } from "../types.js";

interface VendorClient {
  readonly isConnected: boolean;
  connect(): Promise<{ ok: true } | { ok: false; message: string }>;
  setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }>;
  disconnect(): Promise<void>;
}

/**
 * Orchestrates vendor detection (vendorDetection.ts) and, for every vendor
 * with a real control path, that client's live connection lifecycle. Every
 * `controllable: true` vendor in VENDOR_DEFINITIONS must have an entry in
 * CLIENTS below — vendorManager.test-style code paths (getStatus, syncColor)
 * are generic over that map rather than hardcoding vendor IDs, so the
 * Settings panel's "Vendor Software" list can never drift from
 * VENDOR_DEFINITIONS' controllable/notControllableReason/verified source of
 * truth.
 */
export class VendorManager {
  private clients: Partial<Record<VendorId, VendorClient>> = {
    "razer-chroma": new ChromaClient(),
    "corsair-icue": new IcueClient(),
    "logitech-ghub": new LogitechClient(),
    "asus-aura": new AuraClient(),
    "steelseries-gamesense": new GamesenseClient(),
    "msi-mystic-light": new MysticLightClient(),
  };
  private detected: Record<VendorId, boolean> = Object.fromEntries(
    VENDOR_DEFINITIONS.map((v) => [v.id, false])
  ) as Record<VendorId, boolean>;
  /**
   * The same clients, presented as devices. This is what makes vendor
   * lighting a first-class citizen rather than a Test button — see
   * vendorBackend.ts.
   */
  readonly devices = new VendorDeviceSource(this.clients);
  private lastCheckedAt: string | null = null;
  private listeners = new Set<(status: VendorStatus[]) => void>();
  private rechecking = false;

  /** Current status snapshot without re-running detection — safe to call as often as needed. */
  getStatus(): VendorStatus[] {
    return VENDOR_DEFINITIONS.map((def) => {
      const detected = this.detected[def.id];
      const client = this.clients[def.id];

      if (!def.controllable || !client) {
        return {
          id: def.id,
          name: def.name,
          detected,
          controllable: false,
          connected: false,
          message: detected ? "Detected — control not available yet." : "Not detected.",
          lastCheckedAt: this.lastCheckedAt,
        };
      }

      const connected = client.isConnected;
      const unverified = def.verified === false;
      return {
        id: def.id,
        name: def.name,
        detected,
        controllable: true,
        connected,
        message: connected
          ? unverified
            ? "Connected — unverified, may not work yet."
            : "Connected."
          : detected
            ? "Detected — connecting…"
            : "Not detected.",
        lastCheckedAt: this.lastCheckedAt,
      };
    });
  }

  /** Re-runs process detection for every vendor and, for each controllable vendor, attempts a fresh connection if detected. Safe to call repeatedly (e.g. from a "Recheck" button) — concurrent calls collapse into one. */
  async recheck(): Promise<VendorStatus[]> {
    if (this.rechecking) return this.getStatus();
    this.rechecking = true;
    try {
      this.detected = await detectRunningVendors();
      this.lastCheckedAt = new Date().toISOString();

      for (const [id, client] of Object.entries(this.clients) as [VendorId, VendorClient][]) {
        const isDetected = this.detected[id];
        if (isDetected && !client.isConnected) {
          const result = await client.connect();
          if (!result.ok) {
            console.warn(`[HARE] ${id} detected but connect failed:`, result.message);
          }
        } else if (!isDetected && client.isConnected) {
          await client.disconnect();
        }
      }

      const status = this.getStatus();
      this.emit(status);
      return status;
    } finally {
      this.rechecking = false;
    }
  }

  /** Pushes a color to a vendor's real lighting, if controllable and connected. */
  async syncColor(vendorId: VendorId, color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    const client = this.clients[vendorId];
    if (!client) {
      return { ok: false, message: "Not supported for this vendor yet." };
    }
    if (!client.isConnected) {
      return { ok: false, message: "Not connected yet — try Recheck first." };
    }
    return client.setColor(color);
  }

  onChanged(cb: (status: VendorStatus[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(status: VendorStatus[]) {
    this.listeners.forEach((cb) => cb(status));
  }
}
