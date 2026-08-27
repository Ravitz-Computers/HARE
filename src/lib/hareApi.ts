import { EFFECTS } from "../../electron/backend/types";
import { MODULE_DEFINITIONS } from "../../electron/backend/modules/moduleRegistry";
import type {
  BackendState,
  EffectAssignment,
  EffectId,
  KLColor,
  EffectDefinition,
  DeviceDbStatus,
  AppSettings,
  ThemeState,
  SavedLook,
  SavedLookInput,
  FileDialogResult,
  ImportBackupResult,
  VendorId,
  VendorStatus,
  ModeParamsPatch,
  KLDisplayDevice,
  KLDisplayInfo,
  ElevationStatus,
  ModuleStatus,
  DetectedConflict,
  LcdScreenState,
  PawnIoStatus,
  SystemReport,
} from "../../electron/backend/types";
import type { SensorSnapshot } from "../../electron/backend/sensors/sensorTypes";
import { BrowserBackend } from "./browserBackend";

export interface HareApi {
  getState(): Promise<BackendState>;
  getEffects(): Promise<EffectDefinition[]>;
  rescan(): Promise<BackendState>;
  setDeviceColor(deviceId: number, color: KLColor): Promise<void>;
  setZoneColor(deviceId: number, zoneId: number, color: KLColor): Promise<void>;
  /** Tells the board how many LEDs are on an ARGB header, so colours have somewhere to land. */
  resizeZone(deviceId: number, zoneId: number, ledCount: number): Promise<BackendState>;
  setNativeMode(deviceId: number, modeId: number): Promise<void>;
  applyEffect(assignment: EffectAssignment): Promise<void>;
  clearEffect(deviceId: number, zoneId: number | null): Promise<void>;
  syncAll(
    effectId: EffectId,
    color: KLColor,
    secondaryColor: KLColor,
    speed: number,
    brightness: number,
    rainbow?: boolean
  ): Promise<void>;
  getDeviceDbStatus(): Promise<DeviceDbStatus>;
  discoverDevices(): Promise<{ state: BackendState; dbStatus: DeviceDbStatus }>;
  getAppSettings(): Promise<AppSettings>;
  setAppSettings(partial: Partial<AppSettings>): Promise<AppSettings>;
  getThemeState(): Promise<ThemeState>;
  /** Electron-only (real desktopCapturer access) — returns null in the plain-browser dev fallback. See src/lib/musicReactive.ts. */
  getAudioLoopbackSource(): Promise<string | null>;
  reportAudioLevel(level: number): void;
  /** Per-band levels (bass first) plus whether this sample landed on a beat. */
  reportAudioSpectrum(bands: number[], beat: boolean): void;
  onStateChanged(cb: (state: BackendState) => void): () => void;
  onDeviceDbChanged(cb: (status: DeviceDbStatus) => void): () => void;
  onAppSettingsChanged(cb: (settings: AppSettings) => void): () => void;
  onThemeChanged(cb: (theme: ThemeState) => void): () => void;

  getGallery(): Promise<SavedLook[]>;
  saveLook(input: SavedLookInput): Promise<SavedLook>;
  deleteLook(id: string): Promise<SavedLook[]>;
  applyLook(lookId: string, deviceId: number): Promise<void>;
  exportLook(lookId: string): Promise<FileDialogResult>;
  importLook(): Promise<FileDialogResult>;
  onGalleryChanged(cb: (looks: SavedLook[]) => void): () => void;

  exportBackup(): Promise<FileDialogResult>;
  importBackup(): Promise<ImportBackupResult>;

  getVendorStatus(): Promise<VendorStatus[]>;
  recheckVendors(): Promise<VendorStatus[]>;
  syncVendorColor(vendorId: VendorId, color: KLColor): Promise<{ ok: true } | { ok: false; message: string }>;
  onVendorStatusChanged(cb: (status: VendorStatus[]) => void): () => void;

  /** Advanced Mode: writes a native mode's own parameters (direction/colorMode/brightness/colors), not just which mode is active. Returns the fresh backend state since the mode's real fields (re-read from the device) may differ slightly from what was requested. */
  updateModeParams(deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean): Promise<BackendState>;
  /** Advanced Mode: the raw per-LED painter's write path — pushes an exact color array with no processing. */
  setRawLedColors(deviceId: number, colors: KLColor[]): Promise<void>;

  /** Other RGB apps currently fighting HARE for the same hardware bus. */
  getConflicts(): Promise<DetectedConflict[]>;
  getModuleStatus(): Promise<ModuleStatus[]>;
  installModule(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  uninstallModule(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  getElevationStatus(): Promise<ElevationStatus>;
  setElevationEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; message: string }>;
  getDisplayDevices(): Promise<KLDisplayDevice[]>;
  getDisplayState(vendorId: number, productId: number): Promise<LcdScreenState | { ok: false; message: string }>;
  setDisplayImage(vendorId: number, productId: number, rgba: Uint8Array): Promise<{ ok: true } | { ok: false; message: string }>;
  setDisplayGif(vendorId: number, productId: number, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; message: string }>;
  setDisplayBrightness(vendorId: number, productId: number, percent: number): Promise<{ ok: true } | { ok: false; message: string }>;
  setDisplayOrientation(vendorId: number, productId: number, degrees: 0 | 90 | 180 | 270): Promise<{ ok: true } | { ok: false; message: string }>;
  setDisplayLiquidMode(vendorId: number, productId: number): Promise<{ ok: true } | { ok: false; message: string }>;

  /** System sensors — temperatures, load, fans. Nothing is polled until watchSensors(true). */
  getSensors(): Promise<SensorSnapshot>;
  watchSensors(watching: boolean): Promise<{ ok: true }>;
  refreshSensors(): Promise<SensorSnapshot>;
  onSensorsChanged(cb: (snapshot: SensorSnapshot) => void): () => void;
  /** Whether the driver that unlocks motherboard/RAM lighting and CPU temperature is installed. */
  getPawnIoStatus(): Promise<PawnIoStatus>;
  installPawnIo(): Promise<{ ok: true } | { ok: false; message: string }>;

  /** Picks a widget file. Declines to load it — see the main-process handler. */
  importWidget(): Promise<FileDialogResult>;
  /** Opens the folder diagnostic logs are written to. */
  openLogFolder(): Promise<{ ok: true } | { ok: false; message: string }>;
  getLogFolder(): Promise<string>;
  /** Opens the bundled OpenRGB's own window, to tell a HARE problem from a hardware one. */
  openOpenRgb(): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Stops the OpenRGB server and starts it again, for when it stops responding. */
  restartOpenRgb(): Promise<{ ok: true; message: string } | { ok: false; message: string }>;
  /** The few facts that make a bug report answerable. Gathered only when asked for. */
  getSystemReport(): Promise<SystemReport>;
  /** Tells the backend an effect this window drives can't get what it needs — or that it can again. */
  reportEffectProblem?(effectId: string, reason: string | null): void;
  /** Opens the user's email program with a bug report ready to send. */
  openBugReport(subject: string, body: string): Promise<{ ok: true } | { ok: false; message: string }>;

  /** Monitors HARE could put the second-screen dashboard on. */
  getMonitors(): Promise<KLDisplayInfo[]>;
  openDashboard(displayId: number | null): Promise<{ ok: true }>;
  closeDashboard(): Promise<{ ok: true }>;
}

declare global {
  interface Window {
    hare?: HareApi;
  }
}

/**
 * Sample sensors for the browser preview only.
 *
 * The same reasoning as the sample device list this preview already ships
 * (see browserBackend.ts): outside Electron there is no main process and so
 * no hardware to read, and a permanently empty panel would make the widget
 * unverifiable without a packaged build. Every source says plainly that
 * these are preview values, and none of this is reachable from the real app,
 * where an unreadable sensor reports nothing at all.
 */
const PREVIEW_SENSORS: SensorSnapshot = {
  readings: [
    { id: "preview:cpu-temp", label: "CPU", kind: "temperature", value: 58.4, unit: "°C", source: "libre-hardware-monitor" },
    { id: "preview:gpu-temp", label: "GPU", kind: "temperature", value: 67, unit: "°C", source: "nvidia" },
    { id: "preview:liquid", label: "Liquid", kind: "temperature", value: 34.2, unit: "°C", source: "cooler" },
    { id: "preview:cpu-load", label: "CPU", kind: "load", value: 23, unit: "%", source: "system" },
    { id: "preview:gpu-load", label: "GPU load", kind: "load", value: 61, unit: "%", source: "nvidia" },
    { id: "preview:memory", label: "Memory", kind: "load", value: 47, unit: "%", source: "system" },
    { id: "preview:pump", label: "Pump", kind: "fan", value: 1880, unit: "RPM", source: "cooler" },
    { id: "preview:fan", label: "Chassis fan", kind: "fan", value: 912, unit: "RPM", source: "libre-hardware-monitor" },
  ],
  sources: [
    { id: "system", name: "Windows", available: true, detail: "Sample values — this is the browser preview." },
    { id: "nvidia", name: "NVIDIA GPU", available: true, detail: "Sample values — this is the browser preview." },
    { id: "cooler", name: "AIO cooler", available: true, detail: "Sample values — this is the browser preview." },
    {
      id: "libre-hardware-monitor",
      name: "LibreHardwareMonitor",
      available: true,
      detail: "Sample values — this is the browser preview.",
    },
  ],
  updatedAt: null,
};

let browserBackendSingleton: BrowserBackend | null = null;

/**
 * Returns the HARE backend API. Inside the packaged Electron app this is
 * window.hare, injected by electron/preload.ts and backed by whatever
 * OpenRGB actually reports — real devices, or an honest empty state if it
 * finds none. Outside Electron — e.g. `npm run dev` opened directly in a
 * browser, or a headless screenshot pass — it transparently falls back to
 * an in-page sample-device backend (dev tooling only, never shipped) so the
 * whole UI is explorable without launching Electron at all.
 */
export async function getHareApi(): Promise<HareApi> {
  if (typeof window !== "undefined" && window.hare) {
    return window.hare;
  }

  if (!browserBackendSingleton) {
    browserBackendSingleton = new BrowserBackend();
    await browserBackendSingleton.init();
  }
  const backend = browserBackendSingleton;
  return {
    getState: () => Promise.resolve(backend.getState()),
    getEffects: () => Promise.resolve(EFFECTS),
    rescan: () => backend.rescan(),
    setDeviceColor: (deviceId, color) => backend.setDeviceColor(deviceId, color),
    setZoneColor: (deviceId, zoneId, color) => backend.setZoneColor(deviceId, zoneId, color),
    resizeZone: (deviceId, zoneId, ledCount) => backend.resizeZone(deviceId, zoneId, ledCount),
    setNativeMode: (deviceId, modeId) => backend.setNativeMode(deviceId, modeId),
    applyEffect: (assignment) => backend.applyEffect(assignment),
    clearEffect: (deviceId, zoneId) => backend.clearEffect(deviceId, zoneId),
    syncAll: (effectId, color, secondaryColor, speed, brightness, rainbow) =>
      backend.syncAll(effectId, color, secondaryColor, speed, brightness, rainbow),
    getDeviceDbStatus: () => Promise.resolve(backend.getDeviceDbStatus()),
    discoverDevices: () => backend.discoverDevices(),
    getAppSettings: () => Promise.resolve(backend.getAppSettings()),
    setAppSettings: (partial) => backend.setAppSettings(partial),
    getThemeState: () => Promise.resolve(backend.getThemeState()),
    // No real Electron main process behind the plain-browser dev fallback,
    // so there's no desktopCapturer to hand back a source id from.
    getAudioLoopbackSource: () => Promise.resolve(null),
    reportAudioLevel: () => {
      /* no-op outside Electron */
    },
    reportAudioSpectrum: () => {
      /* no-op outside Electron */
    },
    onStateChanged: (cb) => backend.onStateChanged(cb),
    onDeviceDbChanged: (cb) => backend.onDeviceDbChanged(cb),
    onAppSettingsChanged: (cb) => backend.onAppSettingsChanged(cb),
    onThemeChanged: (cb) => backend.onThemeChanged(cb),

    getGallery: () => Promise.resolve(backend.getGallery()),
    saveLook: (input) => backend.saveLook(input),
    deleteLook: (id) => backend.deleteLook(id),
    applyLook: (lookId, deviceId) => backend.applyLook(lookId, deviceId),
    exportLook: (lookId) => backend.exportLook(lookId),
    importLook: () => backend.importLook(),
    onGalleryChanged: (cb) => backend.onGalleryChanged(cb),

    exportBackup: () => backend.exportBackup(),
    importBackup: () => backend.importBackup(),

    getVendorStatus: () => Promise.resolve(backend.getVendorStatus()),
    recheckVendors: () => backend.recheckVendors(),
    syncVendorColor: (vendorId, color) => backend.syncVendorColor(vendorId, color),
    onVendorStatusChanged: (cb) => backend.onVendorStatusChanged(cb),

    updateModeParams: (deviceId, modeId, patch, persist) => backend.updateModeParams(deviceId, modeId, patch, persist),
    setRawLedColors: (deviceId, colors) => backend.setRawLedColors(deviceId, colors),
    getConflicts: () => Promise.resolve([]),
    // The dev preview can't install anything, but it should still show the
    // real module list — otherwise the panel is unverifiable outside a
    // packaged build. Everything is reported as unavailable, which is true.
    getModuleStatus: () =>
      Promise.resolve(
        MODULE_DEFINITIONS.map((def) => ({
          id: def.id,
          name: def.name,
          summary: def.summary,
          worthItWhen: def.worthItWhen,
          overlapsOpenRgb: def.overlapsOpenRgb,
          requiresVendorApp: def.requiresVendorApp,
          installed: def.packageName === null,
          available: false,
          builtIn: def.packageName === null,
          downloadBytes: null,
          installedBytes: null,
        }))
      ),
    installModule: () => Promise.resolve({ ok: false as const, message: "Not available in this preview." }),
    uninstallModule: () => Promise.resolve({ ok: false as const, message: "Not available in this preview." }),
    getElevationStatus: () => Promise.resolve({ enabled: false, supported: false }),
    setElevationEnabled: () =>
      Promise.resolve({ ok: false as const, message: "Not available in this preview." }),
    getDisplayDevices: () => backend.getDisplayDevices(),
    getDisplayState: () => Promise.resolve({ ok: false as const, message: "Screens aren't available in this preview." }),
    setDisplayImage: () => Promise.resolve({ ok: false as const, message: "Screens aren't available in this preview." }),
    setDisplayGif: () => Promise.resolve({ ok: false as const, message: "Screens aren't available in this preview." }),
    setDisplayBrightness: () => Promise.resolve({ ok: false as const, message: "Screens aren't available in this preview." }),
    setDisplayOrientation: () => Promise.resolve({ ok: false as const, message: "Screens aren't available in this preview." }),
    setDisplayLiquidMode: () => Promise.resolve({ ok: false as const, message: "Screens aren't available in this preview." }),

    // The dev preview has no main process, so there is no hardware to read.
    // Reporting an empty snapshot with a named reason is honest; inventing
    // plausible temperatures would make the panel unverifiable.
    getSensors: () => Promise.resolve(PREVIEW_SENSORS),
    watchSensors: () => Promise.resolve({ ok: true as const }),
    refreshSensors: () => Promise.resolve(PREVIEW_SENSORS),
    onSensorsChanged: () => () => {},
    getPawnIoStatus: () =>
      Promise.resolve({ installed: false, running: false, detail: "Not available in this preview.", canInstall: false }),
    installPawnIo: () => Promise.resolve({ ok: false as const, message: "Not available in this preview." }),

    // The dev preview runs in one browser tab, so there is no second window
    // to open — the dashboard is reachable there at #dashboard instead.
    importWidget: () =>
      Promise.resolve({ ok: false as const, canceled: false, reason: "Not available in this preview." }),
    openLogFolder: () => Promise.resolve({ ok: false as const, message: "Not available in this preview." }),
    getLogFolder: () => Promise.resolve(""),
    openOpenRgb: () => Promise.resolve({ ok: false as const, message: "Not available in this preview." }),
    restartOpenRgb: () => Promise.resolve({ ok: false as const, message: "Not available in this preview." }),
    openBugReport: () => Promise.resolve({ ok: false as const, message: "Not available in this preview." }),
    getSystemReport: () =>
      Promise.resolve({
        appVersion: "preview",
        buildStamp: "preview",
        os: navigator.userAgent,
        arch: "unknown",
        electron: "none",
        openRgbVersion: null,
        backendStatus: "disconnected",
        deviceCount: 0,
        deviceNames: [],
        pawnIoInstalled: false,
        pawnIoRunning: false,
        elevationEnabled: false,
        sensorSources: [],
        loggingEnabled: false,
        conflicts: [],
      }),
    getMonitors: () => Promise.resolve([]),
    openDashboard: () => Promise.resolve({ ok: true as const }),
    closeDashboard: () => Promise.resolve({ ok: true as const }),
  };
}
