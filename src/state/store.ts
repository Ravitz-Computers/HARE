import { create } from "zustand";
import { getHareApi } from "@/lib/hareApi";
import { startMusicReactive, stopMusicReactive } from "@/lib/musicReactive";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../electron/backend/types";
import { EMPTY_SNAPSHOT, type SensorSnapshot } from "../../electron/backend/sensors/sensorTypes";
import { createClaimCounter } from "../../electron/backend/sensors/sensorClaims";
import type {
  AppSettings,
  BackendState,
  DeviceDbStatus,
  EffectAssignment,
  EffectDefinition,
  EffectId,
  FileDialogResult,
  ImportBackupResult,
  KLColor,
  KLDisplayDevice,
  KLDisplayInfo,
  ElevationStatus,
  PawnIoStatus,
  ModuleStatus,
  DetectedConflict,
  SavedLook,
  SavedLookInput,
  ThemeState,
  VendorId,
  VendorStatus,
  ModeParamsPatch,
} from "../../electron/backend/types";

/** Flips the .dark class on <html> to match the resolved theme — the one DOM side effect that has to live outside React (Tailwind's dark: variant, and the plain-CSS custom properties in index.css, both key off this class, not off React state). */
function applyThemeClass(effective: "light" | "dark") {
  document.documentElement.classList.toggle("dark", effective === "dark");
}

/**
 * Runs the renderer's audio capture only while some device is actually using
 * the Music Reactive effect.
 *
 * The capture itself has to live in the renderer (Web Audio needs a DOM
 * media context the main process doesn't have), but the decision belongs to
 * the backend state — so this keys off the devices' own activeEffectId
 * rather than a separate setting that could drift out of sync with what's
 * really running. Holding an open getUserMedia loopback when nothing needs
 * it is exactly the kind of thing that should never be left running.
 */
function syncAudioCapture(state: BackendState) {
  const wanted = state.devices.some((d) => d.activeEffectId === "music-reactive");
  if (wanted) void startMusicReactive();
  else stopMusicReactive();
}

interface HareStore {
  ready: boolean;
  hasSeenOnboarding: boolean;
  state: BackendState;
  effects: EffectDefinition[];
  dbStatus: DeviceDbStatus;
  appSettings: AppSettings;
  theme: ThemeState;
  gallery: SavedLook[];
  vendors: VendorStatus[];
  vendorsRechecking: boolean;
  /** Other RGB apps running right now that will stop HARE seeing hardware. */
  conflicts: DetectedConflict[];
  /**
   * Set when a scan was **refused** because one of those apps holds the bus.
   *
   * Distinct from `conflicts`, which is only ever a hint: this one means the
   * user asked for a scan and did not get one. Cleared by a successful scan
   * or by overriding with rescan(true).
   */
  scanBlockedBy: DetectedConflict[];
  refreshConflicts: () => Promise<void>;
  /** Optional vendor modules and what each one costs to add. */
  modules: ModuleStatus[];
  moduleBusy: string | null;
  refreshModules: () => Promise<void>;
  setModuleInstalled: (id: string, installed: boolean) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Whether the one elevated helper that unlocks motherboard/RAM lighting is installed. */
  elevation: ElevationStatus;
  elevationBusy: boolean;
  setElevationEnabled: (enabled: boolean) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** AIO/case LCD screens HARE drives over USB, separate from the vendors above (no vendor software involved). See krakenLcd.ts. */
  displayDevices: KLDisplayDevice[];
  displayDevicesLoading: boolean;
  refreshDisplayDevices: () => Promise<void>;
  /**
   * System sensors. Nothing is polled until something calls watchSensors —
   * see backend/sensors/sensorHub.ts.
   */
  sensors: SensorSnapshot;
  watchSensors: (watching: boolean) => Promise<void>;
  refreshSensors: () => Promise<void>;
  pawnIo: PawnIoStatus;
  refreshPawnIo: () => Promise<void>;
  installPawnIo: () => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Monitors the second-screen dashboard could open on. */
  monitors: KLDisplayInfo[];
  refreshMonitors: () => Promise<void>;
  importWidget: () => Promise<FileDialogResult>;
  openLogFolder: () => Promise<{ ok: true } | { ok: false; message: string }>;
  logFolder: string;
  refreshLogFolder: () => Promise<void>;
  openOpenRgb: () => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Stops the OpenRGB server and starts it again, for when it stops responding. */
  restartOpenRgb: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>;
  openDashboard: (displayId: number | null) => Promise<void>;
  closeDashboard: () => Promise<void>;
  /**
   * Bumped whenever a new effect is actually applied, which is what makes
   * Vinny appear for a moment. A counter rather than a boolean so two
   * applications in a row each get their own moment.
   */
  effectFlourish: number;
  /**
   * Short messages shown in the corner. Every action that reaches hardware
   * says whether it worked — silence after a click reads as a broken app.
   */
  toasts: Toast[];
  notify: (kind: ToastKind, text: string) => void;
  dismissToast: (id: number) => void;
  /**
   * Runs an action and reports the outcome. `success` is only shown if given,
   * so read-only refreshes can stay quiet while still surfacing failures.
   */
  run: (label: string, action: () => Promise<unknown>, success?: string) => Promise<boolean>;
  discovering: boolean;
  selectedDeviceId: number | null;
  init: () => Promise<void>;
  setAppSettings: (partial: Partial<AppSettings>) => Promise<void>;
  completeOnboarding: () => void;
  selectDevice: (id: number | null) => void;
  rescan: (force?: boolean) => Promise<void>;
  discover: () => Promise<void>;
  setDeviceColor: (deviceId: number, color: KLColor) => Promise<void>;
  setZoneColor: (deviceId: number, zoneId: number, color: KLColor) => Promise<void>;
  /** Tells the board how long the strip on an ARGB header is. */
  resizeZone: (deviceId: number, zoneId: number, ledCount: number) => Promise<void>;
  setNativeMode: (deviceId: number, modeId: number) => Promise<void>;
  /** Advanced Mode: writes a native mode's own parameters (direction/colorMode/brightness/its own color slots), not just which mode is active. `persist` also writes it to the device's onboard memory. */
  updateModeParams: (deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean) => Promise<void>;
  /** Advanced Mode: the raw per-LED painter's write path — pushes an exact color array with no processing. */
  setRawLedColors: (deviceId: number, colors: KLColor[]) => Promise<void>;
  applyEffect: (assignment: EffectAssignment) => Promise<void>;
  clearEffect: (deviceId: number, zoneId: number | null) => Promise<void>;
  syncAll: (
    effectId: EffectId,
    color: KLColor,
    secondaryColor: KLColor,
    speed: number,
    brightness: number,
    rainbow?: boolean
  ) => Promise<void>;
  saveLook: (input: SavedLookInput) => Promise<SavedLook>;
  deleteLook: (id: string) => Promise<void>;
  applyLook: (lookId: string, deviceId: number) => Promise<void>;
  exportLook: (lookId: string) => Promise<FileDialogResult>;
  importLook: () => Promise<FileDialogResult>;
  exportBackup: () => Promise<FileDialogResult>;
  importBackup: () => Promise<ImportBackupResult>;
  recheckVendors: () => Promise<void>;
  syncVendorColor: (vendorId: VendorId, color: KLColor) => Promise<{ ok: true } | { ok: false; message: string }>;
}

const EMPTY_STATE: BackendState = { status: "starting", devices: [] };

const EMPTY_DB_STATUS: DeviceDbStatus = {
  installed: false,
  installedVersion: null,
  latestVersion: null,
  updateAvailable: false,
  checking: false,
  updating: false,
  lastCheckedAt: null,
  lastError: null,
  supportsAutoUpdate: false,
};

const EMPTY_APP_SETTINGS: AppSettings = {
  launchOnStartup: true,
  startMinimized: true,
  themePreference: "system",
  dashboard: { ...DEFAULT_DASHBOARD_SETTINGS },
  hasCompletedOnboarding: false,
  hasAskedForHardwareAccess: false,
  diagnosticLogging: false,
  screenGauges: {},
};

// Matches the initial guess src/index.css/tailwind ship with before the
// real resolved theme arrives (avoids a flash of the wrong theme on the
// very first frame) — see index.html if this default ever needs to change.
const EMPTY_THEME: ThemeState = { preference: "system", effective: "dark" };

export type ToastKind = "ok" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

let nextToastId = 1;

/**
 * How many things in this window currently want sensor readings, so the main
 * process only hears about the first claim and the last release. See
 * backend/sensors/sensorClaims.ts for what goes wrong without it.
 *
 * Outside the store because it is not state anything renders from, and a
 * re-render must never reset it.
 */
const sensorClaims = createClaimCounter();

/**
 * Turns whatever a rejected promise carried into one readable sentence.
 * Errors from the backend arrive across the IPC bridge, which prefixes them
 * with its own channel name; that prefix means nothing to anyone reading it.
 */
function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "").trim();
}

export const useHareStore = create<HareStore>((set) => ({
  ready: false,
  hasSeenOnboarding: false,
  state: EMPTY_STATE,
  effects: [],
  dbStatus: EMPTY_DB_STATUS,
  appSettings: EMPTY_APP_SETTINGS,
  theme: EMPTY_THEME,
  gallery: [],
  vendors: [],
  vendorsRechecking: false,
  displayDevices: [],
  displayDevicesLoading: false,
  elevation: { enabled: false, supported: false },
  elevationBusy: false,
  modules: [],
  moduleBusy: null,
  conflicts: [],
  scanBlockedBy: [],
  monitors: [],
  effectFlourish: 0,
  toasts: [],
  logFolder: "",
  sensors: EMPTY_SNAPSHOT,
  pawnIo: { installed: false, running: false, detail: "" },
  discovering: false,
  selectedDeviceId: null,

  notify: (kind, text) => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts.filter((t) => t.text !== text), { id, kind, text }] }));
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  run: async (label, action, success) => {
    try {
      await action();
      if (success) useHareStore.getState().notify("ok", success);
      return true;
    } catch (error) {
      useHareStore.getState().notify("error", `${label} failed. ${describeError(error)}`.trim());
      return false;
    }
  },

  init: async () => {
    const api = await getHareApi();
    const [state, effects, dbStatus, appSettings, theme, gallery, vendors, displayDevices, elevation, modules, conflicts] =
      await Promise.all([
      api.getState(),
      api.getEffects(),
      api.getDeviceDbStatus(),
      api.getAppSettings(),
      api.getThemeState(),
      api.getGallery(),
      api.getVendorStatus(),
      api.getDisplayDevices(),
      api.getElevationStatus(),
      api.getModuleStatus(),
      api.getConflicts(),
    ]);
    api.onStateChanged((next) => {
      set({ state: next });
      syncAudioCapture(next);
    });
    api.onDeviceDbChanged((next) => set({ dbStatus: next }));
    api.onAppSettingsChanged((next) => set({ appSettings: next }));
    api.onThemeChanged((next) => {
      applyThemeClass(next.effective);
      set({ theme: next });
    });
    api.onGalleryChanged((next) => set({ gallery: next }));
    api.onVendorStatusChanged((next) => set({ vendors: next }));
    api.onSensorsChanged((next) => set({ sensors: next }));
    applyThemeClass(theme.effective);
    set({
      ready: true,
      state,
      effects,
      dbStatus,
      appSettings,
      theme,
      gallery,
      vendors,
      hasSeenOnboarding: appSettings.hasCompletedOnboarding,
      displayDevices,
      elevation,
      modules,
      conflicts,
      selectedDeviceId: state.devices[0]?.id ?? null,
    });
    (window as unknown as { __hareApi?: unknown }).__hareApi = api;

    // Covers the case where a device was already running Music Reactive when
    // this window opened (HARE was restarted, or the window was reopened
    // from the tray while effects kept running).
    syncAudioCapture(state);
  },

  watchSensors: async (watching) => {
    const api = await getHareApi();
    // Only the edges are worth telling the main process about — see the note
    // on `sensorClaims` above for why the count has to live here.
    if (!sensorClaims.change(watching)) return;
    await api.watchSensors(watching);
    if (watching) set({ sensors: await api.getSensors() });
  },

  refreshSensors: async () => {
    const api = await getHareApi();
    set({ sensors: await api.refreshSensors() });
  },

  refreshPawnIo: async () => {
    const api = await getHareApi();
    set({ pawnIo: await api.getPawnIoStatus() });
  },

  installPawnIo: async () => {
    const api = await getHareApi();
    const result = await api.installPawnIo();
    set({ pawnIo: await api.getPawnIoStatus() });
    return result;
  },

  openOpenRgb: async () => {
    const api = await getHareApi();
    return api.openOpenRgb();
  },

  restartOpenRgb: async () => {
    const api = await getHareApi();
    const result = await api.restartOpenRgb();
    // The device list almost always changes across a restart, and the panel
    // that asked for this is the one showing the count.
    set({ state: await api.getState(), conflicts: await api.getConflicts() });
    return result;
  },

  refreshLogFolder: async () => {
    const api = await getHareApi();
    set({ logFolder: await api.getLogFolder() });
  },

  openLogFolder: async () => {
    const api = await getHareApi();
    return api.openLogFolder();
  },

  importWidget: async () => {
    const api = await getHareApi();
    return api.importWidget();
  },

  refreshMonitors: async () => {
    const api = await getHareApi();
    set({ monitors: await api.getMonitors() });
  },

  openDashboard: async (displayId) => {
    const api = await getHareApi();
    await api.openDashboard(displayId);
    set({ appSettings: await api.getAppSettings() });
  },

  closeDashboard: async () => {
    const api = await getHareApi();
    await api.closeDashboard();
    set({ appSettings: await api.getAppSettings() });
  },

  refreshConflicts: async () => {
    const api = await getHareApi();
    set({ conflicts: await api.getConflicts() });
  },

  refreshModules: async () => {
    const api = await getHareApi();
    set({ modules: await api.getModuleStatus() });
  },

  setModuleInstalled: async (id, installed) => {
    set({ moduleBusy: id });
    try {
      const api = await getHareApi();
      const result = installed ? await api.installModule(id) : await api.uninstallModule(id);
      set({ modules: await api.getModuleStatus() });
      // A module can make a vendor controllable, so its row needs refreshing too.
      set({ vendors: await api.getVendorStatus() });
      return result;
    } finally {
      set({ moduleBusy: null });
    }
  },

  setElevationEnabled: async (enabled) => {
    set({ elevationBusy: true });
    try {
      const api = await getHareApi();
      const result = await api.setElevationEnabled(enabled);
      set({ elevation: await api.getElevationStatus() });
      return result;
    } finally {
      set({ elevationBusy: false });
    }
  },

  setAppSettings: async (partial) => {
    const api = await getHareApi();
    const next = await api.setAppSettings(partial);
    set({ appSettings: next });
  },

  completeOnboarding: () => {
    set({ hasSeenOnboarding: true });
    // Persisted, so HARE introduces itself once rather than on every launch.
    void (async () => {
      const api = await getHareApi();
      const next = await api.setAppSettings({ hasCompletedOnboarding: true });
      set({ appSettings: next });
    })();
  },

  selectDevice: (id) => set({ selectedDeviceId: id }),

  rescan: async (force = false) => {
    const api = await getHareApi();
    const { state, blockedBy } = await api.rescan(force);
    // A rescan is precisely the moment a bus conflict matters — the user is
    // asking why something isn't showing up. `blockedBy` is stronger than
    // that hint: it means no scan ran at all.
    set({ state, scanBlockedBy: blockedBy, conflicts: await api.getConflicts() });
  },

  discover: async () => {
    set({ discovering: true });
    try {
      const api = await getHareApi();
      const { state, dbStatus, blockedBy } = await api.discoverDevices();
      set({ state, dbStatus, scanBlockedBy: blockedBy ?? [] });
    } finally {
      set({ discovering: false });
    }
  },

  setDeviceColor: async (deviceId, color) => {
    const api = await getHareApi();
    await api.setDeviceColor(deviceId, color);
  },

  setZoneColor: async (deviceId, zoneId, color) => {
    const api = await getHareApi();
    await api.setZoneColor(deviceId, zoneId, color);
  },

  resizeZone: async (deviceId, zoneId, ledCount) => {
    const api = await getHareApi();
    // The whole device's LED layout changes, so the fresh state is taken
    // from the call rather than waiting for a broadcast.
    set({ state: await api.resizeZone(deviceId, zoneId, ledCount) });
  },

  setNativeMode: async (deviceId, modeId) => {
    const api = await getHareApi();
    await api.setNativeMode(deviceId, modeId);
  },

  updateModeParams: async (deviceId, modeId, patch, persist) => {
    const api = await getHareApi();
    await api.updateModeParams(deviceId, modeId, patch, persist);
  },

  setRawLedColors: async (deviceId, colors) => {
    const api = await getHareApi();
    await api.setRawLedColors(deviceId, colors);
  },

  applyEffect: async (assignment) => {
    const api = await getHareApi();
    await api.applyEffect(assignment);
    set((state) => ({ effectFlourish: state.effectFlourish + 1 }));
  },

  clearEffect: async (deviceId, zoneId) => {
    const api = await getHareApi();
    await api.clearEffect(deviceId, zoneId);
  },

  syncAll: async (effectId, color, secondaryColor, speed, brightness, rainbow) => {
    const api = await getHareApi();
    await api.syncAll(effectId, color, secondaryColor, speed, brightness, rainbow);
    set((state) => ({ effectFlourish: state.effectFlourish + 1 }));
  },

  saveLook: async (input) => {
    const api = await getHareApi();
    const look = await api.saveLook(input);
    // onGalleryChanged also fires from the same call in the real app, but
    // the plain-browser dev fallback doesn't round-trip through IPC, so it
    // wouldn't otherwise reach this store — set it directly either way,
    // it's a harmless no-op duplicate when the listener does also fire.
    set((s) => (s.gallery.some((l) => l.id === look.id) ? s : { gallery: [look, ...s.gallery] }));
    return look;
  },

  deleteLook: async (id) => {
    const api = await getHareApi();
    const gallery = await api.deleteLook(id);
    set({ gallery });
  },

  applyLook: async (lookId, deviceId) => {
    const api = await getHareApi();
    await api.applyLook(lookId, deviceId);
    set((state) => ({ effectFlourish: state.effectFlourish + 1 }));
  },

  exportLook: async (lookId) => {
    const api = await getHareApi();
    return api.exportLook(lookId);
  },

  importLook: async () => {
    const api = await getHareApi();
    const result = await api.importLook();
    if (result.ok) {
      const gallery = await api.getGallery();
      set({ gallery });
    }
    return result;
  },

  exportBackup: async () => {
    const api = await getHareApi();
    return api.exportBackup();
  },

  importBackup: async () => {
    const api = await getHareApi();
    const result = await api.importBackup();
    if (result.ok) {
      set({ appSettings: result.appSettings, gallery: result.gallery });
    }
    return result;
  },

  recheckVendors: async () => {
    const api = await getHareApi();
    set({ vendorsRechecking: true });
    try {
      const vendors = await api.recheckVendors();
      set({ vendors });
    } finally {
      set({ vendorsRechecking: false });
    }
  },

  syncVendorColor: async (vendorId, color) => {
    const api = await getHareApi();
    return api.syncVendorColor(vendorId, color);
  },

  refreshDisplayDevices: async () => {
    const api = await getHareApi();
    set({ displayDevicesLoading: true });
    try {
      const displayDevices = await api.getDisplayDevices();
      set({ displayDevices });
    } finally {
      set({ displayDevicesLoading: false });
    }
  },
}));
