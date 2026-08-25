import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DevicePreference, ZoneSizes } from "./types.js";
import { isDevicePreference } from "./deviceIdentity.js";

/**
 * Remembers how each device was last set, so lighting survives a restart.
 *
 * Until now, a HARE effect lasted exactly as long as HARE was running: reboot
 * the PC and everything reverted, unless the user had picked a firmware mode
 * stored on the device itself. That's the single most-felt gap in the app.
 *
 * The interesting problem here is identity. OpenRGB's device id is just an
 * index into whatever it enumerated this run — plug in a keyboard and every
 * id after it shifts, so it is useless as a persistent key. Instead each
 * device is fingerprinted by properties that survive a reboot:
 *
 *   vendor :: name :: ledCount :: ordinal
 *
 * The ordinal disambiguates genuinely identical hardware — four matching RAM
 * sticks share vendor, name and LED count, and without it they would all
 * collapse onto one saved preference. It's the device's position among its
 * own identical siblings, not its global index, so adding an unrelated device
 * doesn't disturb it.
 */

/** Same flat-JSON-in-userData approach as AppSettingsStore and GalleryStore — a small map doesn't need a database. */
export class DevicePrefsStore {
  private prefs = new Map<string, DevicePreference>();
  /**
   * Remembered ARGB-header lengths, per device fingerprint, keyed by zone
   * name. Kept apart from `prefs` because it's a different kind of fact — how
   * long the strip physically is, rather than what it's currently showing —
   * and a device legitimately has both.
   */
  private zoneSizes = new Map<string, ZoneSizes>();
  /** Fingerprints already restored this session, so a reconnect or rescan never fights what the user just chose. */
  private restored = new Set<string>();

  private get filePath(): string {
    return path.join(app.getPath("userData"), "hare-device-prefs.json");
  }

  private get zoneSizesPath(): string {
    return path.join(app.getPath("userData"), "hare-zone-sizes.json");
  }

  /** How long the user said each of this device's resizable zones is. */
  getZoneSizes(fingerprint: string): ZoneSizes | null {
    return this.zoneSizes.get(fingerprint) ?? null;
  }

  async setZoneSize(fingerprint: string, zoneName: string, ledCount: number): Promise<void> {
    const existing = this.zoneSizes.get(fingerprint) ?? {};
    this.zoneSizes.set(fingerprint, { ...existing, [zoneName]: Math.max(0, Math.round(ledCount)) });
    await this.saveZoneSizes();
  }

  private async saveZoneSizes(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.zoneSizesPath), { recursive: true });
      await fs.writeFile(
        this.zoneSizesPath,
        JSON.stringify(Object.fromEntries(this.zoneSizes), null, 2),
        "utf-8"
      );
    } catch (err) {
      // In-memory still works for this session; it just won't survive a
      // restart, which is a smaller loss than failing the action.
      console.warn("[HARE] Couldn't save zone sizes:", err);
    }
  }

  private async loadZoneSizes(): Promise<void> {
    try {
      const raw = await fs.readFile(this.zoneSizesPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      this.zoneSizes = new Map(
        Object.entries(parsed ?? {}).flatMap(([key, value]) => {
          if (!value || typeof value !== "object") return [];
          const sizes: ZoneSizes = {};
          for (const [zone, count] of Object.entries(value as Record<string, unknown>)) {
            if (typeof count === "number" && Number.isFinite(count) && count >= 0) sizes[zone] = count;
          }
          return Object.keys(sizes).length > 0 ? [[key, sizes] as [string, ZoneSizes]] : [];
        })
      );
    } catch {
      this.zoneSizes = new Map();
    }
  }

  async load(): Promise<void> {
    await this.loadZoneSizes();
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      this.prefs = new Map(
        Object.entries((parsed ?? {}) as Record<string, unknown>).filter(
          (entry): entry is [string, DevicePreference] => isDevicePreference(entry[1])
        )
      );
    } catch {
      // First run, or a missing/corrupt file. Starting empty is correct and
      // silent — a lost preference is a cosmetic loss, not worth an error.
      this.prefs = new Map();
    }
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(Object.fromEntries(this.prefs), null, 2), "utf-8");
    } catch (err) {
      console.warn("[HARE] Couldn't save device preferences:", err);
    }
  }

  get(fingerprint: string): DevicePreference | null {
    return this.prefs.get(fingerprint) ?? null;
  }

  async set(fingerprint: string, pref: DevicePreference): Promise<void> {
    this.prefs.set(fingerprint, pref);
    // Setting a preference means the user just chose something, so this
    // device counts as already settled for the session — the restore pass
    // must not later overwrite it with an older saved value.
    this.restored.add(fingerprint);
    await this.save();
  }

  async clear(fingerprint: string): Promise<void> {
    if (this.prefs.delete(fingerprint)) await this.save();
    this.restored.add(fingerprint);
  }

  /** Wipes everything — used by Settings → Backup & Restore on import, and available for a clean reset. */
  async clearAll(): Promise<void> {
    this.prefs.clear();
    await this.save();
  }

  /** True the first time a given device is seen this session; false forever after. */
  shouldRestore(fingerprint: string): boolean {
    if (this.restored.has(fingerprint)) return false;
    this.restored.add(fingerprint);
    return this.prefs.has(fingerprint);
  }
}
