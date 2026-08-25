import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_DASHBOARD_SETTINGS, type AppSettings } from "./types.js";
import { normalizeDashboardSettings } from "./dashboardLayout.js";

const DEFAULTS: AppSettings = {
  // On by default. HARE exists to keep your lighting how you left it, and a
  // lighting app that only runs when you remember to open it doesn't do that
  // — your PC boots dark until you notice. Turning it off is one switch in
  // Settings; an existing settings file keeps whatever it already says.
  launchOnStartup: true,
  // ...and when Windows is the one starting it, it goes to the tray. Nobody
  // wants a window in their face at logon.
  startMinimized: true,
  // "system" (the default) means "match Windows" — see main.ts, which
  // drives Electron's nativeTheme.themeSource from this on startup and on
  // every change.
  themePreference: "system",
  dashboard: { ...DEFAULT_DASHBOARD_SETTINGS },
  hasCompletedOnboarding: false,
  hasAskedForHardwareAccess: false,
  diagnosticLogging: false,
  screenGauges: {},
};

/**
 * Persists everything under Settings that isn't per-device: startup, theme,
 * and the second-screen dashboard's layout. Deliberately a flat JSON file in
 * Electron's per-user data directory rather than a database or extra
 * dependency — there's nothing here that needs more than that.
 */
export class AppSettingsStore {
  private settings: AppSettings = { ...DEFAULTS };
  private listeners = new Set<(settings: AppSettings) => void>();

  private get filePath(): string {
    return path.join(app.getPath("userData"), "hare-settings.json");
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.settings = {
        ...DEFAULTS,
        ...parsed,
        dashboard: normalizeDashboardSettings(parsed.dashboard),
        // A file written before screen readouts existed has no key at all,
        // and the spread would leave it undefined rather than absent.
        screenGauges:
          typeof parsed.screenGauges === "object" && parsed.screenGauges !== null ? parsed.screenGauges : {},
      };
    } catch {
      // First run, or a missing/corrupted file — defaults are fine, and
      // we'll write a fresh valid copy the next time anything changes.
      this.settings = { ...DEFAULTS };
    }
    return this.settings;
  }

  get(): AppSettings {
    return this.settings;
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    const previousDashboard = this.settings.dashboard;
    this.settings = { ...this.settings, ...partial };
    // The spread above is shallow, so a caller sending only part of the
    // dashboard block (just `enabled`, say) would otherwise drop everything
    // else in it. Merged onto what was already there, then normalised the
    // same way a file read is.
    if (partial.dashboard !== undefined) {
      this.settings.dashboard = normalizeDashboardSettings({ ...previousDashboard, ...partial.dashboard });
    }
    this.listeners.forEach((cb) => cb(this.settings));
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (err) {
      // Non-fatal — the in-memory setting still takes effect for this
      // session, it just won't survive a restart.
      console.warn("[HARE] Couldn't save settings to disk:", err);
    }
    return this.settings;
  }

  onChanged(cb: (settings: AppSettings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
