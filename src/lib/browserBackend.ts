import { FixtureBackend } from "../../electron/backend/fixtureBackend";
import { EffectRunner } from "../../electron/backend/effectsEngine";
import { isSavedLook, DEFAULT_DASHBOARD_SETTINGS } from "../../electron/backend/types";
import { VENDOR_DEFINITIONS } from "../../electron/backend/vendors/vendorDefinitions";
import type {
  BackendState,
  EffectAssignment,
  EffectId,
  KLColor,
  DeviceDbStatus,
  AppSettings,
  ThemeState,
  SavedLook,
  SavedLookInput,
  FileDialogResult,
  ImportBackupResult,
  HareBackup,
  VendorId,
  VendorStatus,
  ModeParamsPatch,
  KLDisplayDevice,
} from "../../electron/backend/types";

const DEMO_DB_VERSION = "release_candidate_1.0rc3";

/** Browser-native stand-in for the Electron save dialog + fs.writeFile: triggers a real file download. */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Browser-native stand-in for the Electron open dialog + fs.readFile: pops
 * a real file picker and resolves with the picked file's contents, or null
 * if the user canceled. Browsers don't fire a reliable "canceled" event on
 * <input type=file>, so cancellation is inferred: the OS picker closing
 * always refocuses the window, and a real pick's "change" event always
 * fires before that — if focus comes back with no "change" having fired,
 * treat it as a cancel.
 */
function pickJsonFile(): Promise<{ file: File; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    let settled = false;
    const finish = (result: { file: File; text: string } | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      resolve(result);
    };
    const onFocus = () => {
      setTimeout(() => finish(null), 300);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      void file.text().then((text) => finish({ file, text }));
    });
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

/**
 * A pure browser/renderer-only stand-in for BackendManager, used only when
 * the app is running outside Electron (plain `vite dev`, or a headless
 * browser taking screenshots during development). It has the exact same
 * surface as the real backend so the UI code never has to know which one
 * it's talking to. In the packaged app, window.hare (from
 * electron/preload.ts) is used instead — see src/lib/hareApi.ts. Backed by
 * FixtureBackend's sample devices purely so this dev preview has something
 * to render — the real app never uses FixtureBackend (see its own doc
 * comment); it only ever shows real hardware or an honest empty state.
 */
export class BrowserBackend {
  private backend = new FixtureBackend();
  private effectRunner = new EffectRunner((assignment, colors) => {
    void this.backend.setLedColors(assignment.deviceId, assignment.zoneId, colors);
  });
  private listeners = new Set<(state: BackendState) => void>();
  private dbListeners = new Set<(status: DeviceDbStatus) => void>();
  private settingsListeners = new Set<(settings: AppSettings) => void>();
  // Outside Electron there's no main process to actually run Ambient Sync /
  // Music Reactive / launch-on-startup — these toggles just remember their
  // state in memory so the Settings page is explorable in `npm run dev`
  // without doing anything real. The packaged app's window.hare (backed by
  // electron/main.ts) is what makes them genuinely work.
  private appSettings: AppSettings = {
    launchOnStartup: true,
  startMinimized: true,
    themePreference: "system",
    dashboard: { ...DEFAULT_DASHBOARD_SETTINGS },
    hasCompletedOnboarding: false,
    hasAskedForHardwareAccess: false,
    diagnosticLogging: false,
    screenGauges: {},
  };
  private themeListeners = new Set<(theme: ThemeState) => void>();
  // Outside Electron there's no nativeTheme -- prefers-color-scheme is the
  // browser's own equivalent of "what's the OS set to", so "system" is
  // resolved from that instead.
  private darkMediaQuery =
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  // Outside Electron there's no real OpenRGB build to check/update — this
  // just simulates an always-up-to-date device database so Settings/
  // Dashboard have something real to render in dev-browser mode and
  // screenshots.
  private dbStatus: DeviceDbStatus = {
    installed: true,
    installedVersion: DEMO_DB_VERSION,
    latestVersion: DEMO_DB_VERSION,
    updateAvailable: false,
    checking: false,
    updating: false,
    lastCheckedAt: null,
    lastError: null,
    supportsAutoUpdate: false,
  };
  // Outside Electron there's no userData directory to persist a gallery
  // file to, and no native save/open dialog — this keeps looks in memory
  // for the session, and implements export/import for real using browser
  // primitives (a downloaded file / a file input) so the dev preview is
  // still genuinely testable, not just stubbed out.
  private looks: SavedLook[] = [];
  private galleryListeners = new Set<(looks: SavedLook[]) => void>();

  async init() {
    this.backend.onDevicesChanged(() => this.emit());
    this.backend.onStatusChanged(() => this.emit());
    await this.backend.connect();
    // Live-updates the dev preview if the OS-level color scheme changes
    // while "system" is selected -- same behavior the real app gets from
    // Electron's nativeTheme "updated" event.
    this.darkMediaQuery?.addEventListener("change", () => {
      if (this.appSettings.themePreference === "system") this.emitTheme();
    });
  }

  getThemeState(): ThemeState {
    const systemPrefersDark = this.darkMediaQuery?.matches ?? true;
    const effective: "light" | "dark" =
      this.appSettings.themePreference === "system"
        ? systemPrefersDark
          ? "dark"
          : "light"
        : this.appSettings.themePreference;
    return { preference: this.appSettings.themePreference, effective };
  }

  onThemeChanged(cb: (theme: ThemeState) => void) {
    this.themeListeners.add(cb);
    return () => this.themeListeners.delete(cb);
  }

  private emitTheme() {
    const theme = this.getThemeState();
    this.themeListeners.forEach((cb) => cb(theme));
  }

  getState(): BackendState {
    return {
      status: this.backend.getStatus(),
      message: this.backend.getStatusMessage(),
      devices: this.backend.getDevices(),
    };
  }

  async rescan() {
    await this.backend.rescan();
    return this.getState();
  }

  async setDeviceColor(deviceId: number, color: KLColor) {
    this.effectRunner.clear(deviceId, null);
    await this.backend.setDeviceColor(deviceId, color);
  }

  /**
   * The sample devices have no resizable zones, so this only has to keep the
   * dev preview's API surface complete rather than do anything.
   */
  async resizeZone(_deviceId: number, _zoneId: number, _ledCount: number) {
    return this.getState();
  }

  async setZoneColor(deviceId: number, zoneId: number, color: KLColor) {
    this.effectRunner.clear(deviceId, zoneId);
    await this.backend.setZoneColor(deviceId, zoneId, color);
  }

  async setNativeMode(deviceId: number, modeId: number) {
    this.effectRunner.clear(deviceId, null);
    await this.backend.setNativeMode(deviceId, modeId);
  }

  async updateModeParams(deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean): Promise<BackendState> {
    this.effectRunner.clear(deviceId, null);
    await this.backend.updateModeParams(deviceId, modeId, patch, persist);
    return this.getState();
  }

  async setRawLedColors(deviceId: number, colors: KLColor[]) {
    this.effectRunner.clear(deviceId, null);
    await this.backend.setRawLedColors(deviceId, colors);
  }

  // No real USB access from the plain-browser dev fallback — an honest
  // empty list, same discipline as "no real devices" everywhere else.
  async getDisplayDevices(): Promise<KLDisplayDevice[]> {
    return [];
  }

  async applyEffect(assignment: EffectAssignment) {
    const device = this.backend.getDevices().find((d) => d.id === assignment.deviceId);
    if (!device) return;

    if (assignment.effectId === "static") {
      this.effectRunner.clear(assignment.deviceId, assignment.zoneId);
      if (assignment.zoneId === null) {
        await this.backend.setDeviceColor(assignment.deviceId, assignment.color);
      } else {
        await this.backend.setZoneColor(assignment.deviceId, assignment.zoneId, assignment.color);
      }
      device.activeEffectId = "static";
      this.emit();
      return;
    }

    const ledCount =
      assignment.zoneId === null
        ? device.colors.length
        : device.zones.find((z) => z.id === assignment.zoneId)?.ledCount ?? device.colors.length;
    this.effectRunner.set(assignment, ledCount);
    device.activeEffectId = assignment.effectId;
    this.emit();
  }

  async clearEffect(deviceId: number, zoneId: number | null) {
    this.effectRunner.clear(deviceId, zoneId);
    const device = this.backend.getDevices().find((d) => d.id === deviceId);
    if (device && zoneId === null) device.activeEffectId = null;
    this.emit();
  }

  async syncAll(
    effectId: EffectId,
    color: KLColor,
    secondaryColor: KLColor,
    speed: number,
    brightness: number,
    rainbow = false
  ) {
    for (const device of this.backend.getDevices()) {
      await this.applyEffect({
        deviceId: device.id,
        zoneId: null,
        effectId,
        color,
        rainbow,
        secondaryColor,
        speed,
        brightness,
      });
    }
  }

  getDeviceDbStatus(): DeviceDbStatus {
    return { ...this.dbStatus };
  }

  async discoverDevices(): Promise<{ state: BackendState; dbStatus: DeviceDbStatus }> {
    this.patchDb({ checking: true });
    // A brief simulated delay so the "Discover" UI has something to show —
    // in the real app this is an actual Codeberg API round-trip.
    await new Promise((r) => setTimeout(r, 600));
    this.patchDb({ checking: false, lastCheckedAt: new Date().toISOString() });
    await this.rescan();
    return { state: this.getState(), dbStatus: this.getDeviceDbStatus() };
  }

  onStateChanged(cb: (state: BackendState) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onDeviceDbChanged(cb: (status: DeviceDbStatus) => void) {
    this.dbListeners.add(cb);
    return () => this.dbListeners.delete(cb);
  }

  getAppSettings(): AppSettings {
    return { ...this.appSettings };
  }

  async setAppSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.appSettings = { ...this.appSettings, ...partial };
    this.settingsListeners.forEach((cb) => cb(this.getAppSettings()));
    if (partial.themePreference !== undefined) this.emitTheme();
    return this.getAppSettings();
  }

  onAppSettingsChanged(cb: (settings: AppSettings) => void) {
    this.settingsListeners.add(cb);
    return () => this.settingsListeners.delete(cb);
  }

  getGallery(): SavedLook[] {
    return this.looks;
  }

  async saveLook(input: SavedLookInput): Promise<SavedLook> {
    const look: SavedLook = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.looks = [look, ...this.looks];
    this.emitGallery();
    return look;
  }

  async deleteLook(id: string): Promise<SavedLook[]> {
    this.looks = this.looks.filter((l) => l.id !== id);
    this.emitGallery();
    return this.looks;
  }

  async applyLook(lookId: string, deviceId: number): Promise<void> {
    const look = this.looks.find((l) => l.id === lookId);
    if (!look) return;
    if (look.effectId === "static") {
      await this.setDeviceColor(deviceId, look.color);
    } else {
      await this.applyEffect({
        deviceId,
        zoneId: null,
        effectId: look.effectId,
        color: look.color,
        secondaryColor: look.secondaryColor,
        speed: look.speed,
        brightness: look.brightness,
      });
    }
  }

  async exportLook(lookId: string): Promise<FileDialogResult> {
    const look = this.looks.find((l) => l.id === lookId);
    if (!look) return { ok: false, canceled: false, reason: "That look isn't in the gallery anymore." };
    const filename = `${(look.name || "look").replace(/[\\/:*?"<>|]+/g, "_")}.hare-look.json`;
    downloadJson(filename, look);
    return { ok: true, path: filename };
  }

  async importLook(): Promise<FileDialogResult> {
    const picked = await pickJsonFile();
    if (!picked) return { ok: false, canceled: true };
    try {
      const parsed = JSON.parse(picked.text) as unknown;
      if (!isSavedLook(parsed)) {
        return { ok: false, canceled: false, reason: "That file isn't a HARE look — it's missing fields a real one has." };
      }
      this.looks = [parsed, ...this.looks.filter((l) => l.id !== parsed.id)];
      this.emitGallery();
      return { ok: true, path: picked.file.name };
    } catch (err) {
      return { ok: false, canceled: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  onGalleryChanged(cb: (looks: SavedLook[]) => void) {
    this.galleryListeners.add(cb);
    return () => this.galleryListeners.delete(cb);
  }

  async exportBackup(): Promise<FileDialogResult> {
    const backup: HareBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appSettings: this.getAppSettings(),
      gallery: this.looks,
    };
    const filename = `hare-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(filename, backup);
    return { ok: true, path: filename };
  }

  async importBackup(): Promise<ImportBackupResult> {
    const picked = await pickJsonFile();
    if (!picked) return { ok: false, canceled: true };
    try {
      const parsed = JSON.parse(picked.text) as Partial<HareBackup>;
      if (!parsed || typeof parsed !== "object" || !parsed.appSettings) {
        return { ok: false, canceled: false, reason: "That file isn't a HARE backup — it's missing the settings section a real one has." };
      }
      const next = await this.setAppSettings(parsed.appSettings);
      const incomingLooks = Array.isArray(parsed.gallery) ? parsed.gallery.filter(isSavedLook) : [];
      const existingIds = new Set(this.looks.map((l) => l.id));
      const fresh = incomingLooks.filter((l) => !existingIds.has(l.id));
      if (fresh.length > 0) {
        this.looks = [...fresh, ...this.looks];
        this.emitGallery();
      }
      return { ok: true, appSettings: next, gallery: this.looks };
    } catch (err) {
      return { ok: false, canceled: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  private emitGallery() {
    this.galleryListeners.forEach((cb) => cb(this.looks));
  }

  // No real OS process list or vendor SDKs are reachable from a plain
  // browser tab (this is only ever used outside Electron, for dev tooling).
  private vendorListeners = new Set<(status: VendorStatus[]) => void>();

  getVendorStatus(): VendorStatus[] {
    return VENDOR_DEFINITIONS.map((def) => ({
      id: def.id,
      name: def.name,
      detected: false,
      controllable: def.controllable,
      connected: false,
      unverified: def.verified === false,
      message: "Not available in this preview.",
      lastCheckedAt: null,
    }));
  }

  async recheckVendors(): Promise<VendorStatus[]> {
    const status = this.getVendorStatus();
    this.vendorListeners.forEach((cb) => cb(status));
    return status;
  }

  async syncVendorColor(vendorId: VendorId, _color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    return { ok: false, message: `Vendor lighting sync (${vendorId}) is only available in the desktop app.` };
  }

  onVendorStatusChanged(cb: (status: VendorStatus[]) => void) {
    this.vendorListeners.add(cb);
    return () => this.vendorListeners.delete(cb);
  }

  private patchDb(partial: Partial<DeviceDbStatus>) {
    this.dbStatus = { ...this.dbStatus, ...partial };
    this.dbListeners.forEach((cb) => cb(this.getDeviceDbStatus()));
  }

  private emit() {
    const state = this.getState();
    this.listeners.forEach((cb) => cb(state));
  }
}
