import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./backend/types.js";
import type { SensorSnapshot } from "./backend/sensors/sensorTypes.js";
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
  KLDisplayDevice,
  KLDisplayInfo,
  ElevationStatus,
  ModuleStatus,
  DetectedConflict,
  LcdScreenState,
  ModeParamsPatch,
  PawnIoStatus,
} from "./backend/types.js";

/**
 * The only surface the renderer can touch. Everything here is a thin,
 * typed wrapper over ipcRenderer.invoke/on — no Node/Electron APIs are
 * exposed directly, keeping the renderer sandboxed.
 */
const api = {
  getState: (): Promise<BackendState> => ipcRenderer.invoke(IPC.GET_STATE),
  getEffects: (): Promise<EffectDefinition[]> => ipcRenderer.invoke(IPC.GET_EFFECTS),
  rescan: (): Promise<BackendState> => ipcRenderer.invoke(IPC.RESCAN),
  setDeviceColor: (deviceId: number, color: KLColor): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_DEVICE_COLOR, deviceId, color),
  resizeZone: (deviceId: number, zoneId: number, ledCount: number): Promise<BackendState> =>
    ipcRenderer.invoke(IPC.RESIZE_ZONE, deviceId, zoneId, ledCount),
  setZoneColor: (deviceId: number, zoneId: number, color: KLColor): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_ZONE_COLOR, deviceId, zoneId, color),
  setNativeMode: (deviceId: number, modeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_NATIVE_MODE, deviceId, modeId),
  applyEffect: (assignment: EffectAssignment): Promise<void> =>
    ipcRenderer.invoke(IPC.APPLY_EFFECT, assignment),
  clearEffect: (deviceId: number, zoneId: number | null): Promise<void> =>
    ipcRenderer.invoke(IPC.CLEAR_EFFECT, deviceId, zoneId),
  syncAll: (
    effectId: EffectId,
    color: KLColor,
    secondaryColor: KLColor,
    speed: number,
    brightness: number,
    rainbow = false
  ): Promise<void> => ipcRenderer.invoke(IPC.SYNC_ALL, effectId, color, secondaryColor, speed, brightness, rainbow),
  getDeviceDbStatus: (): Promise<DeviceDbStatus> => ipcRenderer.invoke(IPC.GET_DEVICE_DB_STATUS),
  discoverDevices: (): Promise<{ state: BackendState; dbStatus: DeviceDbStatus }> =>
    ipcRenderer.invoke(IPC.DISCOVER_DEVICES),
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.GET_APP_SETTINGS),
  setAppSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SET_APP_SETTINGS, partial),
  getThemeState: (): Promise<ThemeState> => ipcRenderer.invoke(IPC.GET_THEME_STATE),
  getAudioLoopbackSource: (): Promise<string | null> => ipcRenderer.invoke(IPC.GET_AUDIO_LOOPBACK_SOURCE),
  reportAudioLevel: (level: number): void => {
    ipcRenderer.send(IPC.REPORT_AUDIO_LEVEL, level);
  },
  reportAudioSpectrum: (bands: number[], beat: boolean): void => {
    ipcRenderer.send(IPC.REPORT_AUDIO_SPECTRUM, bands, beat);
  },
  onStateChanged: (cb: (state: BackendState) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: BackendState) => cb(state);
    ipcRenderer.on(IPC.STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.STATE_CHANGED, listener);
  },
  onDeviceDbChanged: (cb: (status: DeviceDbStatus) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: DeviceDbStatus) => cb(status);
    ipcRenderer.on(IPC.DEVICE_DB_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.DEVICE_DB_CHANGED, listener);
  },
  onAppSettingsChanged: (cb: (settings: AppSettings) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, settings: AppSettings) => cb(settings);
    ipcRenderer.on(IPC.APP_SETTINGS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.APP_SETTINGS_CHANGED, listener);
  },
  onThemeChanged: (cb: (theme: ThemeState) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: ThemeState) => cb(theme);
    ipcRenderer.on(IPC.THEME_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.THEME_CHANGED, listener);
  },

  getGallery: (): Promise<SavedLook[]> => ipcRenderer.invoke(IPC.GET_GALLERY),
  saveLook: (input: SavedLookInput): Promise<SavedLook> => ipcRenderer.invoke(IPC.SAVE_LOOK, input),
  deleteLook: (id: string): Promise<SavedLook[]> => ipcRenderer.invoke(IPC.DELETE_LOOK, id),
  applyLook: (lookId: string, deviceId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.APPLY_LOOK, lookId, deviceId),
  exportLook: (lookId: string): Promise<FileDialogResult> => ipcRenderer.invoke(IPC.EXPORT_LOOK, lookId),
  importLook: (): Promise<FileDialogResult> => ipcRenderer.invoke(IPC.IMPORT_LOOK),
  onGalleryChanged: (cb: (looks: SavedLook[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, looks: SavedLook[]) => cb(looks);
    ipcRenderer.on(IPC.GALLERY_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.GALLERY_CHANGED, listener);
  },

  exportBackup: (): Promise<FileDialogResult> => ipcRenderer.invoke(IPC.EXPORT_BACKUP),
  importBackup: (): Promise<ImportBackupResult> => ipcRenderer.invoke(IPC.IMPORT_BACKUP),

  getVendorStatus: (): Promise<VendorStatus[]> => ipcRenderer.invoke(IPC.GET_VENDOR_STATUS),
  recheckVendors: (): Promise<VendorStatus[]> => ipcRenderer.invoke(IPC.RECHECK_VENDORS),
  syncVendorColor: (vendorId: VendorId, color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.SYNC_VENDOR_COLOR, vendorId, color),
  onVendorStatusChanged: (cb: (status: VendorStatus[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: VendorStatus[]) => cb(status);
    ipcRenderer.on(IPC.VENDOR_STATUS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.VENDOR_STATUS_CHANGED, listener);
  },

  getConflicts: (): Promise<DetectedConflict[]> => ipcRenderer.invoke(IPC.GET_CONFLICTS),
  getModuleStatus: (): Promise<ModuleStatus[]> => ipcRenderer.invoke(IPC.GET_MODULE_STATUS),
  installModule: (id: string): Promise<{ ok: true } | { ok: false; message: string }> => ipcRenderer.invoke(IPC.INSTALL_MODULE, id),
  uninstallModule: (id: string): Promise<{ ok: true } | { ok: false; message: string }> => ipcRenderer.invoke(IPC.UNINSTALL_MODULE, id),

  getElevationStatus: (): Promise<ElevationStatus> => ipcRenderer.invoke(IPC.GET_ELEVATION_STATUS),
  setElevationEnabled: (enabled: boolean): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.SET_ELEVATION_ENABLED, enabled),

  getDisplayDevices: (): Promise<KLDisplayDevice[]> => ipcRenderer.invoke(IPC.GET_DISPLAY_DEVICES),
  getDisplayState: (vendorId: number, productId: number): Promise<LcdScreenState | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.GET_DISPLAY_STATE, vendorId, productId),
  setDisplayImage: (vendorId: number, productId: number, rgba: Uint8Array): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.SET_DISPLAY_IMAGE, vendorId, productId, rgba),
  setDisplayGif: (vendorId: number, productId: number, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.SET_DISPLAY_GIF, vendorId, productId, bytes),
  setDisplayBrightness: (vendorId: number, productId: number, percent: number): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.SET_DISPLAY_BRIGHTNESS, vendorId, productId, percent),
  setDisplayOrientation: (
    vendorId: number,
    productId: number,
    degrees: 0 | 90 | 180 | 270
  ): Promise<{ ok: true } | { ok: false; message: string }> => ipcRenderer.invoke(IPC.SET_DISPLAY_ORIENTATION, vendorId, productId, degrees),
  setDisplayLiquidMode: (vendorId: number, productId: number): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.SET_DISPLAY_LIQUID, vendorId, productId),

  getSensors: (): Promise<SensorSnapshot> => ipcRenderer.invoke(IPC.GET_SENSORS),
  watchSensors: (watching: boolean): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.WATCH_SENSORS, watching),
  refreshSensors: (): Promise<SensorSnapshot> => ipcRenderer.invoke(IPC.REFRESH_SENSORS),
  getPawnIoStatus: (): Promise<PawnIoStatus> => ipcRenderer.invoke(IPC.GET_PAWNIO_STATUS),
  installPawnIo: (): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.INSTALL_PAWNIO),
  onSensorsChanged: (cb: (snapshot: SensorSnapshot) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: SensorSnapshot) => cb(snapshot);
    ipcRenderer.on(IPC.SENSORS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.SENSORS_CHANGED, listener);
  },

  importWidget: (): Promise<FileDialogResult> => ipcRenderer.invoke(IPC.IMPORT_WIDGET),
  openLogFolder: (): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.OPEN_LOG_FOLDER),
  getLogFolder: (): Promise<string> => ipcRenderer.invoke(IPC.GET_LOG_FOLDER),
  openOpenRgb: (): Promise<{ ok: true } | { ok: false; message: string }> =>
    ipcRenderer.invoke(IPC.OPEN_OPENRGB),
  getMonitors: (): Promise<KLDisplayInfo[]> => ipcRenderer.invoke(IPC.GET_MONITORS),
  openDashboard: (displayId: number | null): Promise<{ ok: true }> =>
    ipcRenderer.invoke(IPC.OPEN_DASHBOARD, displayId),
  closeDashboard: (): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.CLOSE_DASHBOARD),

  updateModeParams: (deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean): Promise<BackendState> =>
    ipcRenderer.invoke(IPC.UPDATE_MODE_PARAMS, deviceId, modeId, patch, persist),
  setRawLedColors: (deviceId: number, colors: KLColor[]): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_RAW_LED_COLORS, deviceId, colors),
};

contextBridge.exposeInMainWorld("hare", api);

export type HareApi = typeof api;
