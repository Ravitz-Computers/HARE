import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, desktopCapturer, nativeTheme, dialog, shell, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import os from "node:os";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { BackendManager } from "./backend/backendManager.js";
import { OpenRgbBackend } from "./backend/openrgbBackend.js";
import { DeviceDatabase } from "./backend/deviceDatabase.js";
import { AmbientSyncController } from "./backend/ambientSync.js";
import { AppSettingsStore } from "./backend/appSettings.js";
import { GalleryStore } from "./backend/galleryStore.js";
import { VendorManager } from "./backend/vendors/vendorManager.js";
import { detectLcdDisplays } from "./backend/displays/krakenLcd.js";
import { KrakenLcdDriver } from "./backend/displays/krakenLcdDriver.js";
import { ElevationHelper } from "./backend/elevationHelper.js";
import { DevicePrefsStore } from "./backend/devicePrefsStore.js";
import { ModuleManager } from "./backend/modules/moduleManager.js";
import { detectConflicts } from "./backend/vendors/smbusConflicts.js";
import { DashboardWindow } from "./backend/dashboardWindow.js";
import { SensorHub } from "./backend/sensors/sensorHub.js";
import { SystemLoadProvider } from "./backend/sensors/providers/systemLoad.js";
import { NvidiaGpuProvider } from "./backend/sensors/providers/nvidiaGpu.js";
import { AmdGpuProvider } from "./backend/sensors/providers/amdGpu.js";
import { CoolerProvider } from "./backend/sensors/providers/coolerStatus.js";
import { LibreHardwareMonitorProvider } from "./backend/sensors/providers/libreHardwareMonitor.js";
import { HwinfoProvider } from "./backend/sensors/providers/hwinfoRegistry.js";
import { hottestTemperature } from "./backend/sensors/sensorTypes.js";
import { detectPawnIo } from "./backend/pawnIo.js";
import { DiagnosticLogger } from "./backend/logger.js";
import { APP_VERSION, BUILD_STAMP } from "./backend/generated/buildStamp.js";
import { canInstallPawnIo, installPawnIo } from "./backend/pawnIoInstaller.js";
import type { ModuleId } from "./backend/modules/moduleRegistry.js";
import {
  reportAmbientBands,
  reportAudioLevel,
  reportAudioSpectrum,
  reportHottestTemperature,
} from "./backend/effectsEngine.js";
import { stopGlobalInputHook } from "./backend/inputHook.js";
import {
  IPC,
  EFFECTS,
  isSavedLook,
  type EffectAssignment,
  type EffectId,
  type KLColor,
  type AppSettings,
  type SavedLookInput,
  type FileDialogResult,
  type HareBackup,
  type ImportBackupResult,
  type VendorId,
  type ModeParamsPatch,
  type SystemReport,
} from "./backend/types.js";

// Defense-in-depth, registered before anything else runs: a single
// unexpected error anywhere in the main process (a rejected promise nobody
// awaited, an EventEmitter's "error" event with no listener, etc.) would
// otherwise either show Electron's raw "A JavaScript error occurred in the
// main process" crash dialog or silently kill the process outright --
// exactly what happened on a real Windows PC from an unhandled OpenRGB
// socket reset (see openrgbBackend.ts's handleClientError for the specific
// fix; this is the general-purpose backstop for anything similar we
// haven't hit yet). HARE's whole premise is "idiot-proof" and "always
// works" -- logging and staying alive is always the better failure mode
// than a native crash dialog a non-technical user has no way to act on.
process.on("uncaughtException", (err) => {
  console.error("[HARE] Uncaught exception in the main process (recovered, not crashing):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[HARE] Unhandled promise rejection in the main process (recovered, not crashing):", reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let dashboard: DashboardWindow | null = null;
const openRgbDir = resolveOpenRgbDir();
const deviceDb = new DeviceDatabase({ openRgbDir });
const appSettings = new AppSettingsStore();
const gallery = new GalleryStore();
const vendorManager = new VendorManager();
const manager = new BackendManager({
  // Vendor software shows up as ordinary devices, driven by the same effect
  // runner as everything else. See backend/vendors/vendorBackend.ts.
  vendorDevices: vendorManager.devices,
  // HARE ships OpenRGB headlessly under the hood, resolved relative
  // to the packaged app's resources directory. In dev this simply won't
  // exist, so the manager falls back to its "no devices detected" state
  // automatically (see backendManager.ts — there's no demo-device fallback).
  openRgbExePath: resolveBundledOpenRgbPath(),
});
const ambientSync = new AmbientSyncController(
  (bands) => reportAmbientBands(bands),
  undefined,
  (reason) => {
    if (reason) manager.setEffectProblem("ambient-sync", reason);
    else manager.clearEffectProblem("ambient-sync");
  }
);
/**
 * Sensor sources, in preference order — the hub keeps the first reading it
 * sees for any given sensor, so direct sources win over bridged ones. Someone
 * running LibreHardwareMonitor gets GPU temperature from NVML (a direct call
 * into the driver) and everything NVML can't reach from the bridge.
 */
const sensors = new SensorHub([
  new SystemLoadProvider(),
  new NvidiaGpuProvider(),
  new AmdGpuProvider(),
  new CoolerProvider(),
  new LibreHardwareMonitorProvider(),
  new HwinfoProvider(),
]);
/** Held while any device is running the Thermal effect; released when none is. */
let thermalWatch: (() => void) | null = null;
/** Held while a window has the sensor view open. */
const sensorWatchers = new Map<number, () => void>();
const elevation = new ElevationHelper();
const devicePrefs = new DevicePrefsStore();
const modules = new ModuleManager();
/**
 * Diagnostic logging, off unless the user turns it on. Constructed early so
 * that once enabled it captures everything the main process reports, without
 * any call site needing to know it exists.
 */
const logger = new DiagnosticLogger(path.join(app.getPath("userData"), "logs"));

function resolveOpenRgbDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "openrgb")
    : path.join(__dirname, "..", "vendor", "openrgb");
}

function resolveBundledOpenRgbPath(): string | null {
  if (process.platform !== "win32") return null;
  const candidate = path.join(openRgbDir, "OpenRGB.exe");
  return existsSync(candidate) ? candidate : null;
}

/**
 * The name of the value HARE writes under Windows' Run key.
 *
 * Passed explicitly rather than left to Electron, which defaults it to the
 * app's AppUserModelId and therefore to something like `electron.app.HARE`.
 * The uninstaller has to delete this value by name, and a name nobody chose
 * is a name the uninstaller can get wrong — which would leave a permanent
 * startup entry pointing at a program that no longer exists.
 *
 * Keep in step with build/installer.nsh.
 */
const RUN_KEY_VALUE_NAME = "HARE";

/** Passed by the Run-key entry, and only by it. See applyLaunchOnStartup. */
const STARTED_BY_WINDOWS_FLAG = "--started-by-windows";

/** True when this launch came from Windows at logon rather than from a person. */
const startedByWindows = process.argv.includes(STARTED_BY_WINDOWS_FLAG);

/**
 * Where bug reports go. Fixed here rather than taken from the renderer, so
 * the only address HARE will ever open a mail window for is this one.
 * Keep in step with COMPANY.email in src/lib/appInfo.ts.
 */
const BUG_REPORT_EMAIL = "avrumi@ravitzcomputers.com";

/** Applies (or removes) Windows' "run at login" registration to match the setting. No-op outside a packaged build — registering the dev Electron binary to launch at login would be actively unhelpful. */
function applyLaunchOnStartup(enabled: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      name: RUN_KEY_VALUE_NAME,
      // The flag is how HARE later tells "Windows started me" from "someone
      // double-clicked me". Electron's own `wasOpenedAtLogin` is macOS-only,
      // and without this the two are indistinguishable — so either every
      // launch opens to the tray (a program that appears to do nothing when
      // you click it) or none does.
      args: [STARTED_BY_WINDOWS_FLAG],
    });
  } catch (err) {
    console.warn("[HARE] Couldn't update launch-on-startup registration:", err);
  }
}

// Windows reads its own taskbar/title-bar icon best from a real multi-size
// .ico (see scripts/build-art.mjs); .png is the right choice everywhere else
// (Linux dev runs, Electron's cross-platform BrowserWindow default).
// This path only resolves once packaged if build/ is actually shipped --
// see electron-builder.yml's `files` list, which had missed this entirely
// (electron-builder's own `win.icon` config embeds the icon into the .exe
// itself, but that's separate from this file being reachable at runtime).
const windowIconPathCandidate = path.join(
  __dirname,
  "..",
  "build",
  process.platform === "win32" ? "icon.ico" : "icon.png"
);
// Falls back to Electron's own default icon rather than an empty string --
// an empty/missing icon path silently produces a blank taskbar icon with no
// error anywhere, which is exactly the bug this guards against if the file
// ever goes missing again.
const windowIconPath = existsSync(windowIconPathCandidate) ? windowIconPathCandidate : undefined;

/**
 * The second screen's own badge.
 *
 * It gets its own taskbar button, so it needs its own icon -- with HARE's,
 * the taskbar showed two identical entries and the frameless fullscreen one
 * read as a dialog someone had left open. Falls back to HARE's icon rather
 * than to nothing, since a missing icon path silently produces a blank
 * taskbar button with no error anywhere.
 */
const dashboardIconCandidate = path.join(__dirname, "..", "build", "dashboard-icon.ico");
const dashboardIconPath =
  process.platform === "win32" && existsSync(dashboardIconCandidate)
    ? dashboardIconCandidate
    : windowIconPath;

/**
 * Stops the window being navigated or re-purposed into something other than
 * HARE.
 *
 * The renderer is already sandboxed with context isolation and no Node
 * integration, so this isn't guarding against a compromised renderer running
 * code — it's guarding against the window itself being taken somewhere else.
 * HARE renders text it didn't author (device names straight from OpenRGB,
 * names inside imported Gallery files), and a packaged Electron window with
 * no navigation policy will happily follow a link out of the app and keep all
 * of the app's privileges while doing it.
 *
 * Two rules, both deny-by-default:
 *   - Nothing may open a new window. Outbound links go to the user's real
 *     browser instead, which is where they expected them to go anyway.
 *   - Nothing may navigate the main window away from HARE's own page.
 */
function applyNavigationGuards(win: BrowserWindow): void {
  const isAppUrl = (target: string): boolean => {
    try {
      const url = new URL(target);
      if (isDev) return url.origin === "http://localhost:5173";
      return url.protocol === "file:";
    } catch {
      return false;
    }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only ordinary web links are handed to the browser. Anything else —
    // file:, and the various custom schemes that can launch local
    // applications — is dropped rather than passed to the OS.
    if (url.startsWith("https://")) void shell.openExternal(url);
    else console.warn("[HARE] Blocked an attempt to open:", url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (url.startsWith("https://")) void shell.openExternal(url);
    else console.warn("[HARE] Blocked navigation to:", url);
  });

  // Belt and braces: a renderer process should never be attaching webviews.
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

/**
 * A Content-Security-Policy for the renderer.
 *
 * Defence in depth rather than a patched hole — React escapes by default and
 * HARE uses no `dangerouslySetInnerHTML`. But the renderer does display
 * strings from outside the app, and a CSP costs one header and removes the
 * whole class of injection outcomes.
 *
 * Sent as a real header rather than a `<meta>` tag so the dev server's
 * hot-reload machinery can have the looser policy it needs without that
 * looseness ever shipping.
 */
function applyContentSecurityPolicy(): void {
  const production = [
    "default-src 'self'",
    "script-src 'self'",
    // React sets inline style attributes throughout (every colour swatch and
    // LED preview), which is what 'unsafe-inline' covers here. It does not
    // permit inline *scripts* — script-src above is unaffected.
    "style-src 'self' 'unsafe-inline'",
    // Fonts are bundled rather than fetched from a CDN, so no external origin
    // is needed. data: covers the inlined subsets Vite emits.
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    // The renderer talks to the main process over IPC, never the network.
    "connect-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  // Vite's dev server needs eval and a websocket for hot reload. Kept strictly
  // to the unpackaged case.
  const development = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws://localhost:5173 http://localhost:5173",
    "media-src 'self' blob:",
    "object-src 'none'",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [isDev ? development : production],
      },
    });
  });
}

// Must be .cjs, not .js -- see scripts/build-preload.mjs for why:
// package.json's "type": "module" makes a plain preload.js load as ESM,
// which Electron's preload context can't run.
const preloadPath = path.join(__dirname, "preload.cjs");
const indexHtmlPath = path.join(__dirname, "..", "dist", "index.html");

/**
 * The second-screen dashboard, created lazily so nothing about it costs
 * anything for the majority of people who only ever have one monitor.
 */
function getDashboard(): DashboardWindow {
  if (!dashboard) {
    dashboard = new DashboardWindow({
      isDev,
      preloadPath,
      indexHtmlPath,
      iconPath: dashboardIconPath,
      applyGuards: applyNavigationGuards,
      isTransparent: () => appSettings.get().dashboard.background.kind === "none",
      onChange: (open) => {
        // Closing it from the dashboard's own button (or by any other route)
        // has to switch the setting off, or Settings would keep claiming it's
        // on and reopening it would need two taps.
        //
        // Quitting is the one close that must NOT be recorded — every window
        // closes then, and writing that away would mean the dashboard never
        // came back after a restart.
        if ((app as unknown as { isQuitting?: boolean }).isQuitting) return;
        if (appSettings.get().dashboard.enabled !== open) {
          void applySettingsUpdate({ dashboard: { ...appSettings.get().dashboard, enabled: open } });
        }
      },
    });
  }
  return dashboard;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#0b0810",
    autoHideMenuBar: true,
    title: "HARE",
    icon: windowIconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Music Reactive's audio capture runs in this window, driven by
      // requestAnimationFrame. Chromium stops firing that for a hidden
      // window, and HARE hides rather than closes — so minimising to the
      // tray froze the lights on whatever colour they held at that moment,
      // while every other effect kept running. Which made it look like a
      // bug in the music effect rather than in the window.
      backgroundThrottling: false,
    },
    show: false,
  });

  // Straight to the tray when Windows started HARE and the setting says so.
  // Anything else shows the window: an app that opens to nothing when you
  // double-click it is broken, whatever a setting says.
  const openHidden = startedByWindows && appSettings.get().startMinimized;
  mainWindow.once("ready-to-show", () => {
    if (openHidden) {
      console.log("[HARE] Started by Windows -- staying in the tray.");
      return;
    }
    mainWindow?.show();
  });
  applyNavigationGuards(mainWindow);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(indexHtmlPath);
  }

  mainWindow.on("close", (e) => {
    // Minimize-to-tray so effects (like a screen-ambient sync, in a future
    // version) keep running without a taskbar window cluttering things up
    // for a user who just wants their PC to glow and forget about it.
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting && tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

/**
 * Brings the existing window back, wherever it went.
 *
 * `show()` alone doesn't restore a minimised window, so a minimised HARE
 * clicked from the tray would stay minimised — the same class of bug as
 * launching a second copy from the shortcut.
 */
function revealMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "build", "trayTemplate.png");
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("HARE");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show HARE", click: () => revealMainWindow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          (app as unknown as { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => revealMainWindow());
}

/**
 * Sends to every HARE window, not just the main one.
 *
 * The second-screen dashboard runs the same renderer bundle and the same
 * store, so it needs every broadcast the main window gets — otherwise it
 * would show whatever was true when it opened and never update. Addressing
 * all windows keeps that automatic: any window HARE opens in future is
 * covered without another change here.
 */
function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function broadcastState() {
  broadcast(IPC.STATE_CHANGED, manager.getState());
}

/**
 * Runs the screen sampler only while some device is actually using the
 * Screen Sync effect. Capturing the desktop every ~125ms is real background
 * cost, so it should never run just because a window is open — this is the
 * same "only pay for it while it's genuinely needed" rule the global input
 * hook follows for the Reactive effect (see BackendManager.syncReactiveHook).
 * Both start() and stop() are idempotent, so calling this on every state
 * change is safe.
 */
function syncAmbientSampler() {
  if (manager.isEffectActive("ambient-sync")) ambientSync.start();
  else ambientSync.stop();
}

function broadcastSensors() {
  broadcast(IPC.SENSORS_CHANGED, sensors.getSnapshot());
}

/**
 * Runs the sensor hub while any device is using the Thermal effect.
 *
 * Same rule as the screen sampler and the input hook: a capability that costs
 * something runs only while something needs it. The Thermal effect needs a
 * live temperature even when no window is open, so it holds its own watcher
 * independent of the UI's.
 */
function syncThermalSensors() {
  const wanted = manager.isEffectActive("thermal");
  if (wanted && !thermalWatch) thermalWatch = sensors.watch();
  else if (!wanted && thermalWatch) {
    thermalWatch();
    thermalWatch = null;
    // Nothing is reporting a temperature any more, and a stale one would
    // leave the effect frozen at whatever it last saw.
    reportHottestTemperature(null);
  }
}

function broadcastDeviceDbStatus() {
  broadcast(IPC.DEVICE_DB_CHANGED, deviceDb.getStatus());
}

function broadcastAppSettings() {
  broadcast(IPC.APP_SETTINGS_CHANGED, appSettings.get());
}

function broadcastGallery() {
  broadcast(IPC.GALLERY_CHANGED, gallery.getAll());
}

function broadcastVendorStatus() {
  broadcast(IPC.VENDOR_STATUS_CHANGED, vendorManager.getStatus());
}

/**
 * Resolves the user's theme preference into what the renderer actually
 * needs to paint — "system" isn't something CSS in the renderer can resolve
 * on its own the way a plain website could (Electron's nativeTheme is the
 * one source of truth for "what's Windows currently set to", and it's only
 * reachable from the main process).
 */
function getThemeState(): { preference: AppSettings["themePreference"]; effective: "light" | "dark" } {
  return {
    preference: appSettings.get().themePreference,
    effective: nativeTheme.shouldUseDarkColors ? "dark" : "light",
  };
}

function broadcastThemeState() {
  broadcast(IPC.THEME_CHANGED, getThemeState());
}

/**
 * Applies a settings change and every side effect that goes with it
 * (login-item registration, nativeTheme), then persists and broadcasts. Factored out of the
 * SET_APP_SETTINGS handler so Settings → Backup & Restore's import path can
 * restore a whole AppSettings object through the exact same logic instead
 * of a second, easy-to-drift copy of it.
 */
async function applySettingsUpdate(partial: Partial<AppSettings>): Promise<AppSettings> {
  const next = await appSettings.update(partial);

  if (partial.launchOnStartup !== undefined) {
    applyLaunchOnStartup(next.launchOnStartup);
  }

  if (partial.diagnosticLogging !== undefined) {
    await logger.setEnabled(next.diagnosticLogging);
    // Written straight away rather than only at the next startup, so the file
    // is useful the moment someone turns this on to chase a problem.
    if (next.diagnosticLogging) await logDiagnosticInventory();
  }

  if (partial.themePreference !== undefined) {
    // Setting this is what actually makes "system" mean anything --
    // nativeTheme.themeSource = "system" is what makes
    // nativeTheme.shouldUseDarkColors (and Chromium's own
    // prefers-color-scheme in the renderer) track Windows' live setting.
    // Its own "updated" event (registered in app.whenReady below) handles
    // the broadcast on any resulting change; this call covers the case
    // where the resolved effective theme doesn't actually change (e.g.
    // switching from "system" to an explicit "light" while Windows is
    // already light) and "updated" never fires.
    nativeTheme.themeSource = next.themePreference;
    broadcastThemeState();
  }


  broadcastAppSettings();
  return next;
}

function registerIpcHandlers() {
  ipcMain.handle(IPC.GET_STATE, () => manager.getState());
  ipcMain.handle(IPC.GET_EFFECTS, () => EFFECTS);

  ipcMain.handle(IPC.RESCAN, async () => {
    await manager.rescan();
    return manager.getState();
  });

  ipcMain.handle(IPC.SET_DEVICE_COLOR, async (_e, deviceId: number, color: KLColor) => {
    await manager.setDeviceColor(deviceId, color);
  });

  ipcMain.handle(IPC.RESIZE_ZONE, async (_e, deviceId: number, zoneId: number, ledCount: number) => {
    await manager.resizeZone(deviceId, zoneId, ledCount);
    return manager.getState();
  });

  ipcMain.handle(IPC.SET_ZONE_COLOR, async (_e, deviceId: number, zoneId: number, color: KLColor) => {
    await manager.setZoneColor(deviceId, zoneId, color);
  });

  ipcMain.handle(IPC.SET_NATIVE_MODE, async (_e, deviceId: number, modeId: number) => {
    await manager.setNativeMode(deviceId, modeId);
  });

  ipcMain.handle(IPC.APPLY_EFFECT, async (_e, assignment: EffectAssignment) => {
    manager.applyEffect(assignment);
  });

  ipcMain.handle(IPC.CLEAR_EFFECT, async (_e, deviceId: number, zoneId: number | null) => {
    manager.clearEffect(deviceId, zoneId);
  });

  // Advanced Mode — full OpenRGB mode-parameter editing and raw per-LED
  // painting, beyond the simplified color/effect/mode-picker UI above.
  ipcMain.handle(
    IPC.UPDATE_MODE_PARAMS,
    async (_e, deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean) => {
      await manager.updateModeParams(deviceId, modeId, patch, persist);
      return manager.getState();
    }
  );

  ipcMain.handle(IPC.SET_RAW_LED_COLORS, async (_e, deviceId: number, colors: KLColor[]) => {
    await manager.setRawLedColors(deviceId, colors);
  });

  ipcMain.handle(
    IPC.SYNC_ALL,
    async (
      _e,
      effectId: EffectId,
      color: KLColor,
      secondaryColor: KLColor,
      speed: number,
      brightness: number,
      rainbow: boolean
    ) => {
      await manager.syncAll(effectId, color, secondaryColor, speed, brightness, rainbow);
    }
  );

  ipcMain.handle(IPC.GET_DEVICE_DB_STATUS, () => deviceDb.getStatus());

  ipcMain.handle(IPC.GET_APP_SETTINGS, () => appSettings.get());
  ipcMain.handle(IPC.GET_THEME_STATE, () => getThemeState());

  ipcMain.handle(IPC.SET_APP_SETTINGS, async (_e, partial: Partial<AppSettings>) => applySettingsUpdate(partial));

  // Music Reactive's audio capture happens in the renderer (Web Audio's
  // AnalyserNode needs a DOM/media context that the main process doesn't
  // have) — this just hands it a desktopCapturer source id it can pass to
  // getUserMedia for WASAPI loopback of the system's audio output. See
  // src/lib/musicReactive.ts.
  ipcMain.handle(IPC.GET_AUDIO_LOOPBACK_SOURCE, async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    return sources[0]?.id ?? null;
  });

  // Fire-and-forget (not invoke/handle) since this can arrive up to ~30x/sec
  // while Music Reactive is running — an ack round-trip would be wasted
  // overhead for a value that's already stale by the time it'd arrive.
  ipcMain.on(IPC.REPORT_AUDIO_LEVEL, (_e, level: number) => {
    reportAudioLevel(level);
  });

  // Music Reactive captures audio in the window, so only the window knows
  // when Windows refuses to hand any over.
  ipcMain.on(IPC.REPORT_EFFECT_PROBLEM, (_e, effectId: EffectId, reason: string | null) => {
    if (!EFFECTS.some((effect) => effect.id === effectId)) return;
    if (reason) manager.setEffectProblem(effectId, String(reason).slice(0, 300));
    else manager.clearEffectProblem(effectId);
  });

  ipcMain.on(IPC.REPORT_AUDIO_SPECTRUM, (_e, bands: number[], beat: boolean) => {
    reportAudioSpectrum(bands, beat);
  });

  // The manual "Discover" action: unlike Rescan (which just asks the
  // already-running OpenRGB server to look at hardware again), Discover
  // also checks whether a newer OpenRGB build is available — which is
  // where support for newly-released devices actually comes from — applies
  // it if so, then rescans. This is the on-demand version of the startup
  // check below.
  ipcMain.handle(IPC.DISCOVER_DEVICES, async () => {
    await deviceDb.checkAndAutoApply();
    broadcastDeviceDbStatus();
    await manager.rescan();
    return { state: manager.getState(), dbStatus: deviceDb.getStatus() };
  });

  registerGalleryAndBackupHandlers();
  registerVendorHandlers();
  registerDashboardHandlers();
  registerSensorHandlers();
}

/**
 * System sensors. See backend/sensors/ for what HARE can read without
 * shipping a kernel driver of its own.
 */
function registerSensorHandlers() {
  ipcMain.handle(IPC.GET_SENSORS, () => sensors.getSnapshot());

  // Watching is per-window and released when that window goes away, so a
  // closed dashboard can never leave the hub polling forever.
  ipcMain.handle(IPC.WATCH_SENSORS, (event, watching: boolean) => {
    const id = event.sender.id;
    const existing = sensorWatchers.get(id);
    if (watching) {
      if (existing) return { ok: true as const };
      const release = sensors.watch();
      sensorWatchers.set(id, release);
      event.sender.once("destroyed", () => {
        sensorWatchers.get(id)?.();
        sensorWatchers.delete(id);
      });
    } else if (existing) {
      existing();
      sensorWatchers.delete(id);
    }
    return { ok: true as const };
  });

  ipcMain.handle(IPC.REFRESH_SENSORS, async () => {
    // Refreshing has to work from a settings page that isn't watching, so it
    // takes a watcher of its own for the duration of the check.
    const release = sensors.watch();
    try {
      return await sensors.refresh();
    } finally {
      release();
    }
  });

  ipcMain.handle(IPC.GET_PAWNIO_STATUS, async () => ({
    ...(await detectPawnIo()),
    canInstall: canInstallPawnIo(),
  }));

  ipcMain.handle(IPC.INSTALL_PAWNIO, async () => {
    const result = await installPawnIo();
    // A successful install changes what OpenRGB can reach and what HARE can
    // read, so both are re-checked rather than left stale on screen.
    if (result.ok) {
      await manager.rescan();
      const release = sensors.watch();
      try {
        await sensors.refresh();
      } finally {
        release();
      }
    }
    return result;
  });
}

/**
 * The second-screen dashboard — a fullscreen touch panel HARE puts on a
 * monitor of the user's choosing. See backend/dashboardWindow.ts.
 */
function registerDashboardHandlers() {
  ipcMain.handle(IPC.GET_MONITORS, () => getDashboard().listDisplays());

  /**
   * Importing a widget someone else made.
   *
   * A saved look is data HARE reads; a widget is code HARE would run inside
   * its own window, with whatever the renderer can reach. That is a different
   * kind of risk and needs work HARE hasn't done yet — a manifest, a
   * signature, and a sandbox that a widget cannot reach out of. Until then
   * this picks the file and declines, plainly. Accepting it quietly and
   * hoping would be the wrong kind of convenience.
   */
  ipcMain.handle(IPC.GET_LOG_FOLDER, () => logger.folder);

  /**
   * Stops OpenRGB and starts it again.
   *
   * The state this exists for is OpenRGB still being *connected* but no
   * longer doing anything -- a wedged server, which otherwise means closing
   * HARE, finding OpenRGB.exe in Task Manager and starting over. What it
   * actually does depends on who started the server, and it says which,
   * because the useful next step is different in each case.
   */
  ipcMain.handle(
    IPC.RESTART_OPENRGB,
    async (): Promise<{ ok: true; message: string } | { ok: false; message: string }> => {
      const devicesNow = () => manager.getState().devices.length;
      const found = (verb: string) => {
        const count = devicesNow();
        return `${verb} ${count === 0 ? "no devices yet" : `${count} device${count === 1 ? "" : "s"}`}.`;
      };

      try {
        // 1. The straightforward case: HARE launched it, so HARE can stop it.
        const { stopped, owned } = await manager.restartOwnServer();
        if (owned) {
          return stopped
            ? { ok: true, message: `OpenRGB restarted. HARE ${found("found")}` }
            : {
                ok: false,
                message:
                  "OpenRGB was asked to stop but the port is still in use. Something else may be holding it — try again in a moment.",
              };
        }

        // 2. The elevated logon task started it. HARE runs unelevated on
        //    purpose and cannot stop an elevated process, so the task is
        //    restarted instead, which is the supported way to do it.
        if (await elevation.isEnabled()) {
          const restart = await elevation.restartServer();
          if (!restart.ok) {
            return {
              ok: false,
              message: `Couldn't restart the elevated OpenRGB: ${restart.message} You can restart your PC, or turn hardware access off and on again in Settings.`,
            };
          }
          await manager.reconnect();
          return { ok: true, message: `OpenRGB restarted with hardware access. HARE ${found("found")}` };
        }

        // 3. Somebody is running OpenRGB themselves. Their window, their
        //    process — killing it would make their own app vanish. So HARE
        //    reconnects and says exactly that.
        await manager.reconnect();
        return {
          ok: true,
          message: `This OpenRGB wasn't started by HARE, so it was left running and HARE reconnected instead. ${found("Now seeing")} To restart it, close OpenRGB yourself and HARE will start its own copy.`,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  /**
   * Hands a written bug report to whatever email program the user has.
   *
   * The renderer sends a subject and a body, never a URL. That is the whole
   * point of doing it here: `mailto:` is a scheme that launches a local
   * application, and the navigation guards deliberately refuse to pass any
   * such scheme from the renderer to the OS. Rather than loosening that rule
   * for one feature, the address is HARE's own and the scheme is added on
   * this side, so the renderer cannot reach anything it wasn't meant to.
   */
  ipcMain.handle(
    IPC.OPEN_BUG_REPORT,
    async (_e, subject: string, body: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        // Long bodies get truncated or refused by some mail clients and by
        // the shell itself; this is well inside every limit worth caring
        // about, and the log is attached separately anyway.
        const url =
          `mailto:${BUG_REPORT_EMAIL}` +
          `?subject=${encodeURIComponent(String(subject).slice(0, 200))}` +
          `&body=${encodeURIComponent(String(body).slice(0, 6000))}`;
        await shell.openExternal(url);
        return { ok: true };
      } catch {
        return {
          ok: false,
          message: `Couldn't open your email program. You can write to ${BUG_REPORT_EMAIL} directly.`,
        };
      }
    }
  );

  /**
   * The facts that make a bug report answerable.
   *
   * Gathered only when this is called, which only happens when someone has
   * ticked the box on the report form — HARE never collects any of this in
   * the background, and it never leaves the PC except in an email the person
   * writes, reads and sends themselves.
   */
  ipcMain.handle(IPC.GET_SYSTEM_REPORT, async (): Promise<SystemReport> => {
    const state = manager.getState();
    const pawnIo = await detectPawnIo();
    const db = deviceDb.getStatus();
    return {
      appVersion: APP_VERSION,
      buildStamp: BUILD_STAMP,
      os: `${os.type()} ${os.release()}`,
      arch: process.arch,
      electron: process.versions.electron,
      openRgbVersion: db.installedVersion,
      backendStatus: state.status,
      deviceCount: state.devices.length,
      // Names only. A device name is a product model, which is what makes a
      // report actionable; nothing else about the device is included.
      deviceNames: state.devices.map((d) => d.name),
      pawnIoInstalled: pawnIo.installed,
      pawnIoRunning: pawnIo.running,
      elevationEnabled: await elevation.isEnabled(),
      sensorSources: sensors.getSnapshot().sources.filter((s) => s.available).map((s) => s.name),
      loggingEnabled: appSettings.get().diagnosticLogging,
      conflicts: (await detectConflicts()).map((c) => c.name),
    };
  });

  /**
   * Opens the OpenRGB HARE bundles, in its own window.
   *
   * When lighting doesn't change there is exactly one question worth
   * answering first: can the engine underneath drive this hardware at all? If
   * OpenRGB's own window can't change these LEDs, no amount of work in HARE
   * will — it's a hardware or driver-access problem. If it can, the fault is
   * HARE's. One click splits the problem in half, and nothing else HARE can
   * show comes close to that.
   */
  ipcMain.handle(IPC.OPEN_OPENRGB, async () => {
    const exe = resolveBundledOpenRgbPath();
    if (!exe) return { ok: false as const, message: "No bundled OpenRGB found in this build." };
    try {
      // Its own window, alongside the headless server HARE already talks to.
      const child = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      console.log(`[HARE] Opened the bundled OpenRGB window: ${exe}`);
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[HARE] Couldn't open OpenRGB:", message);
      return { ok: false as const, message };
    }
  });

  ipcMain.handle(IPC.OPEN_LOG_FOLDER, async () => {
    // Created on demand: opening the folder must work even before logging has
    // ever been switched on, or the button is a dead end.
    await logger.sweep();
    const result = await shell.openPath(logger.folder);
    return result ? { ok: false as const, message: result } : { ok: true as const };
  });

  ipcMain.handle(IPC.IMPORT_WIDGET, async (): Promise<FileDialogResult> => {
    if (!mainWindow) return { ok: false, canceled: false, reason: "No window to attach the dialog to." };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import a widget",
      filters: [{ name: "HARE Widget", extensions: ["harewidget", "zip"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    return {
      ok: false,
      canceled: false,
      reason:
        "HARE can't add widgets from other people yet. Nothing was installed.",
    };
  });

  // Each of these writes settings exactly once. The chosen monitor is saved
  // *before* the window opens, and the `enabled` flag is left to the window's
  // own open/close callback — otherwise two writes of the same file would be
  // in flight at once and the later-finishing one would win, which is not
  // necessarily the newer one.
  ipcMain.handle(IPC.OPEN_DASHBOARD, async (_e, displayId: number | null) => {
    await applySettingsUpdate({ dashboard: { ...appSettings.get().dashboard, displayId } });
    getDashboard().open(displayId);
    return { ok: true as const };
  });

  ipcMain.handle(IPC.CLOSE_DASHBOARD, async () => {
    const dash = getDashboard();
    if (dash.isOpen) {
      // The "closed" event records the setting — see onChange in getDashboard.
      dash.close();
    } else if (appSettings.get().dashboard.enabled) {
      // Nothing was open, so nothing will fire; correct the setting directly.
      await applySettingsUpdate({ dashboard: { ...appSettings.get().dashboard, enabled: false } });
    }
    return { ok: true as const };
  });
}

/**
 * The Gallery (save/apply/export/import a lighting "look") and Settings →
 * Backup & Restore (export/import everything at once). Split out from
 * registerIpcHandlers purely for readability — same registration timing and
 * conventions as everything else there.
 */
function registerGalleryAndBackupHandlers() {
  ipcMain.handle(IPC.GET_GALLERY, () => gallery.getAll());

  ipcMain.handle(IPC.SAVE_LOOK, async (_e, input: SavedLookInput) => {
    const look = await gallery.save(input);
    broadcastGallery();
    return look;
  });

  ipcMain.handle(IPC.DELETE_LOOK, async (_e, id: string) => {
    await gallery.delete(id);
    broadcastGallery();
    return gallery.getAll();
  });

  // Applying a look to a device reuses exactly the same manager calls the
  // Solid Color / Effects panels use on DeviceDetail — a look is nothing
  // more than a saved EffectAssignment (see types.ts), so there's no
  // separate "look application" code path to keep in sync with those.
  ipcMain.handle(IPC.APPLY_LOOK, async (_e, lookId: string, deviceId: number) => {
    const look = gallery.get(lookId);
    if (!look) throw new Error("That look isn't in the gallery anymore.");
    // A painting is checked first: it carries more than the flat colour and
    // effect id saved alongside it, which would otherwise quietly win.
    if (look.ledColors?.length) {
      const target = manager.getState().devices.find((d) => d.id === deviceId);
      const size = target?.colors.length ?? look.ledColors.length;
      const painting = look.ledColors;
      await manager.setRawLedColors(
        deviceId,
        Array.from({ length: size }, (_, i) => painting[i % painting.length])
      );
    } else if (look.effectId === "static" && !look.layers?.length) {
      await manager.setDeviceColor(deviceId, look.color);
    } else {
      manager.applyEffect({
        deviceId,
        zoneId: null,
        effectId: look.effectId,
        color: look.color,
        rainbow: look.rainbow,
        secondaryColor: look.secondaryColor,
        speed: look.speed,
        brightness: look.brightness,
        layers: look.layers,
        loopSeconds: look.loopSeconds,
      });
    }
  });

  ipcMain.handle(IPC.EXPORT_LOOK, async (_e, lookId: string): Promise<FileDialogResult> => {
    const look = gallery.get(lookId);
    if (!look) return { ok: false, canceled: false, reason: "That look isn't in the gallery anymore." };
    if (!mainWindow) return { ok: false, canceled: false, reason: "No window to attach the dialog to." };
    const safeName = look.name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "look";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export look",
      defaultPath: `${safeName}.hare-look.json`,
      filters: [{ name: "HARE Look", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await fs.writeFile(result.filePath, JSON.stringify(look, null, 2), "utf-8");
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, canceled: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.IMPORT_LOOK, async (): Promise<FileDialogResult> => {
    if (!mainWindow) return { ok: false, canceled: false, reason: "No window to attach the dialog to." };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import look",
      filters: [{ name: "HARE Look", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isSavedLook(parsed)) {
        return { ok: false, canceled: false, reason: "That file isn't a HARE look — it's missing fields a real one has." };
      }
      await gallery.merge([parsed]);
      broadcastGallery();
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, canceled: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.EXPORT_BACKUP, async (): Promise<FileDialogResult> => {
    if (!mainWindow) return { ok: false, canceled: false, reason: "No window to attach the dialog to." };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export HARE settings",
      defaultPath: `hare-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "HARE Backup", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const backup: HareBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appSettings: appSettings.get(),
      gallery: gallery.getAll(),
    };
    try {
      await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), "utf-8");
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, canceled: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.IMPORT_BACKUP, async (): Promise<ImportBackupResult> => {
    if (!mainWindow) return { ok: false, canceled: false, reason: "No window to attach the dialog to." };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import HARE settings",
      filters: [{ name: "HARE Backup", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const raw = await fs.readFile(result.filePaths[0], "utf-8");
      const parsed = JSON.parse(raw) as Partial<HareBackup>;
      if (!parsed || typeof parsed !== "object" || !parsed.appSettings) {
        return { ok: false, canceled: false, reason: "That file isn't a HARE backup — it's missing the settings section a real one has." };
      }
      const next = await applySettingsUpdate(parsed.appSettings);
      const incomingLooks = Array.isArray(parsed.gallery) ? parsed.gallery.filter(isSavedLook) : [];
      await gallery.merge(incomingLooks);
      broadcastGallery();
      return { ok: true, appSettings: next, gallery: gallery.getAll() };
    } catch (err) {
      return { ok: false, canceled: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Third-party vendor RGB software (Razer Chroma, Corsair iCUE, ASUS Aura,
 * MSI Mystic Light, Logitech G HUB) — separate from OpenRGB, HARE's primary
 * backend. See vendors/vendorManager.ts for what "controllable" actually
 * means per vendor right now.
 */
function registerVendorHandlers() {
  ipcMain.handle(IPC.GET_VENDOR_STATUS, () => vendorManager.getStatus());

  ipcMain.handle(IPC.RECHECK_VENDORS, async () => {
    const status = await vendorManager.recheck();
    manager.refreshVendorDevices();
    broadcastVendorStatus();
    broadcastState();
    return status;
  });

  ipcMain.handle(IPC.SYNC_VENDOR_COLOR, async (_e, vendorId: VendorId, color: KLColor) =>
    vendorManager.syncColor(vendorId, color)
  );

  ipcMain.handle(IPC.GET_CONFLICTS, () => detectConflicts());
  ipcMain.handle(IPC.GET_MODULE_STATUS, () => modules.getStatus());
  ipcMain.handle(IPC.INSTALL_MODULE, async (_e, id: ModuleId) => {
    const result = await modules.install(id);
    // A newly installed module may make a vendor controllable that wasn't
    // before, so re-check rather than leaving stale status on screen.
    if (result.ok) {
      await vendorManager.recheck();
      manager.refreshVendorDevices();
    }
    return result;
  });
  ipcMain.handle(IPC.UNINSTALL_MODULE, async (_e, id: ModuleId) => {
    const result = await modules.uninstall(id);
    if (result.ok) {
      await vendorManager.recheck();
      manager.refreshVendorDevices();
    }
    return result;
  });

  ipcMain.handle(IPC.GET_ELEVATION_STATUS, async () => ({
    enabled: await elevation.isEnabled(),
    supported: process.platform === "win32",
  }));

  ipcMain.handle(IPC.SET_ELEVATION_ENABLED, async (_e, enabled: boolean) => {
    if (!enabled) return elevation.disable();
    const exe = resolveBundledOpenRgbPath();
    if (!exe) {
      return { ok: false as const, message: "The bundled OpenRGB copy is missing, so there's nothing to grant access to." };
    }
    const result = await elevation.enable(exe, 6742);
    if (result.ok) {
      // Run it straight away so the user doesn't have to sign out and back
      // in to see their motherboard and RAM appear.
      await elevation.startNow();
      await manager.rescan();
    }
    return result;
  });

  ipcMain.handle(IPC.GET_DISPLAY_DEVICES, () => detectLcdDisplays());

  ipcMain.handle(IPC.GET_DISPLAY_STATE, (_e, vendorId: number, productId: number) =>
    withScreen(vendorId, productId, (driver) => driver.readInfo())
  );

  ipcMain.handle(IPC.SET_DISPLAY_IMAGE, (_e, vendorId: number, productId: number, rgba: Uint8Array) =>
    withScreen(vendorId, productId, (driver) => driver.setStaticImage(new Uint8Array(rgba)))
  );

  ipcMain.handle(IPC.SET_DISPLAY_GIF, (_e, vendorId: number, productId: number, bytes: Uint8Array) =>
    withScreen(vendorId, productId, (driver) => driver.setGif(new Uint8Array(bytes)))
  );

  ipcMain.handle(IPC.SET_DISPLAY_BRIGHTNESS, (_e, vendorId: number, productId: number, percent: number) =>
    withScreen(vendorId, productId, (driver) => driver.setBrightness(percent))
  );

  ipcMain.handle(
    IPC.SET_DISPLAY_ORIENTATION,
    (_e, vendorId: number, productId: number, degrees: 0 | 90 | 180 | 270) =>
      withScreen(vendorId, productId, (driver) => driver.setOrientation(degrees))
  );

  ipcMain.handle(IPC.SET_DISPLAY_LIQUID, (_e, vendorId: number, productId: number) =>
    withScreen(vendorId, productId, (driver) => driver.setLiquidMode())
  );
}

/**
 * Opens a screen, runs one operation against it, and always closes it again.
 *
 * Deliberately open-per-operation rather than holding the device: these
 * screens are also claimed by NZXT's own software, and keeping an exclusive
 * USB claim open for HARE's whole lifetime would stop CAM (or liquidctl, or
 * anything else) from ever touching the cooler while HARE runs. Screen
 * updates are occasional and user-initiated, so the reconnect cost doesn't
 * matter and being a good neighbour does.
 */
async function withScreen<T>(
  vendorId: number,
  productId: number,
  run: (driver: KrakenLcdDriver) => T | Promise<T>
): Promise<T | { ok: false; message: string }> {
  const screens = await detectLcdDisplays();
  const screen = screens.find((s) => s.vendorId === vendorId && s.productId === productId);
  if (!screen) return { ok: false, message: "That screen isn't connected any more." };
  if (!screen.controllable) {
    return { ok: false, message: `HARE can see ${screen.name} but can't drive its screen yet.` };
  }

  const driver = new KrakenLcdDriver(screen);
  const opened = await driver.open();
  if (!opened.ok) return opened;
  try {
    return await run(driver);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    await driver.close();
  }
}

/**
 * Writes everything worth knowing about this PC's setup to the log.
 *
 * Run at startup *and* whenever logging is switched on — because the first
 * version only ran at startup, which meant someone who turned logging on and
 * then reproduced their problem got a nearly empty file. A diagnostic that
 * only records what happened before you asked for it is not a diagnostic.
 */
async function logDiagnosticInventory(): Promise<void> {
  try {
    const found = manager.getState();
    console.log(`[HARE] ---- Setup ----`);
    // The build stamp is the point: every build called itself 0.1.0, so a log
    // couldn't say which code wrote it — and one arrived showing a bug that
    // had already been fixed, with no way to tell whether the fix was in.
    console.log(
      `[HARE] HARE ${app.getVersion()} build ${BUILD_STAMP} on ${process.platform} ${process.arch}, ` +
        `Electron ${process.versions.electron}`
    );
    console.log(`[HARE] Backend status: ${found.status}${found.message ? ` (${found.message})` : ""}`);
    console.log(`[HARE] Bundled OpenRGB: ${resolveBundledOpenRgbPath() ?? "not present"}`);

    const elevated = await elevation.isEnabled();
    console.log(
      `[HARE] Elevated OpenRGB logon task: ${elevated ? "installed" : "NOT installed"} — ` +
        "this is what gives OpenRGB the SMBus access motherboard and RAM lighting needs."
    );
    if (elevated) {
      // A task registered by an older HARE points at wherever that build was
      // installed. HARE moved from AppData to Program Files, so a stale task
      // reports as installed, runs, and launches nothing — leaving no OpenRGB
      // server at all while everything claims to be fine.
      const registered = await elevation.registeredCommand();
      const current = resolveBundledOpenRgbPath();
      console.log(`[HARE]   The task runs: ${registered ?? "(couldn't read it)"}`);
      if (registered && current && !registered.toLowerCase().includes(current.toLowerCase())) {
        console.warn(
          `[HARE]   THIS IS STALE. It points somewhere other than this install (${current}). ` +
            "Turn the permission off and on again in Settings - Hardware to re-register it."
        );
      }
    }

    const pawn = await detectPawnIo();
    console.log(`[HARE] PawnIO driver: ${pawn.installed ? (pawn.running ? "installed and running" : "installed, not running") : "NOT installed"} (${pawn.detail})`);

    console.log(`[HARE] ${found.devices.length} device(s) detected.`);
    for (const device of found.devices) {
      console.log(
        `[HARE]   ${device.vendor} ${device.name} — ${device.colors.length} LEDs, ` +
          `${device.zones.length} zone(s) [${device.zones.map((z) => `${z.name}:${z.ledCount}`).join(", ")}], ` +
          `modes: ${device.modes.map((m) => (m.supportsDirectColor ? `${m.name}*` : m.name)).join(", ") || "none"} ` +
          `(active: ${device.modes.find((m) => m.id === device.activeModeId)?.name ?? device.activeModeId})`
      );
    }
    console.log("[HARE]   (* = a mode that accepts per-LED colour from software)");

    const running = await detectConflicts();
    console.log(
      running.length > 0
        ? `[HARE] Other RGB software running: ${running.map((c) => `${c.name} (${c.affects})`).join("; ")}.`
        : "[HARE] No conflicting RGB software detected."
    );
    console.log(`[HARE] ---------------`);
  } catch (err) {
    console.warn("[HARE] Couldn't write the setup summary:", err);
  }
}

/** Whether something is already serving the OpenRGB protocol on the usual port. */
async function isOpenRgbAlreadyRunning(): Promise<boolean> {
  const probe = new OpenRgbBackend({ port: 6742, openRgbExePath: null });
  try {
    return await probe.isServerAlreadyRunning();
  } catch {
    // If the probe itself fails, assume something is there rather than
    // risking a second instance.
    return true;
  }
}

/**
 * Only one HARE at a time.
 *
 * Without this, clicking the desktop shortcut while HARE is sitting in the
 * tray starts a *second* copy — two taskbar entries, two trays, two effect
 * runners fighting over the same hardware. Windows users reasonably expect
 * the shortcut to bring back the window they already have, which is what the
 * second-instance handler below does.
 *
 * This has to run before anything else: the losing instance must quit before
 * it creates windows, registers IPC handlers, or connects to OpenRGB.
 */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone launched HARE again — show them the copy that's already
    // running, restored from whatever state it was in.
    revealMainWindow();
  });
}

app.whenReady().then(async () => {
  // The second copy is on its way out; it must not do any of this.
  if (!gotTheLock) return;

  // Windows groups taskbar buttons, jump lists and notifications by this id.
  // Set explicitly so it matches the installer's app id rather than being
  // derived from the executable name, which is what makes the pinned icon
  // and the running window the same thing to Windows.
  app.setAppUserModelId("com.ravitzcomputers.hare");

  // Installed before any window exists, so the very first document load is
  // already covered by the policy.
  applyContentSecurityPolicy();

  // Load persisted settings from disk BEFORE anything IPC-reachable exists
  // (no ipcMain handlers registered yet, no window/renderer created yet).
  // This ordering is deliberate, not incidental: AppSettingsStore starts
  // with in-memory DEFAULTS and only has the real saved values once load()
  // resolves (see appSettings.ts). The renderer's very first render calls
  // GET_APP_SETTINGS/GET_THEME_STATE — if a window already existed and that
  // call could reach ipcMain before this finished, it would get DEFAULTS
  // instead of what's on disk, and nothing would ever correct it afterward
  // (there's no "settings finished loading, here's the real value"
  // broadcast) — every toggle and the theme choice would appear reset to
  // default until the user touched something, even though the file on disk
  // was fine the whole time. Awaiting this first, before registering
  // handlers or creating the window at all, makes that race impossible
  // rather than just unlikely.
  const settings = await appSettings.load();
  // Enabled before anything else runs, so a problem during startup — the
  // hardest kind to catch — is in the log rather than lost.
  await logger.setEnabled(settings.diagnosticLogging);
  applyLaunchOnStartup(settings.launchOnStartup);
  // Same reasoning for theme: set this before the renderer can possibly ask.
  nativeTheme.themeSource = settings.themePreference;
  // Same race, same fix, for the gallery's GET_GALLERY.
  await gallery.load();

  sensors.onSnapshot((snapshot) => {
    const hottest = hottestTemperature(snapshot);
    reportHottestTemperature(hottest ? hottest.value : null);
    broadcastSensors();
  });

  registerIpcHandlers();
  manager.onStateChanged(() => {
    broadcastState();
    syncAmbientSampler();
    syncThermalSensors();
  });
  deviceDb.onStatusChanged(() => broadcastDeviceDbStatus());
  // Fires whenever the *effective* light/dark result changes -- either
  // Windows' own setting changing live while preference is "system", or us
  // assigning nativeTheme.themeSource above. Single source of truth for
  // telling the renderer to re-theme, instead of duplicating this logic at
  // every call site that can affect it.
  nativeTheme.on("updated", () => broadcastThemeState());
  createWindow();
  createTray();

  // Reopens the second-screen dashboard on the monitor it was last on. If
  // that monitor is gone, DashboardWindow falls back to another one rather
  // than failing — see resolveDisplay there.
  if (settings.dashboard.enabled) {
    getDashboard().open(settings.dashboard.displayId);
  }

  // Best-effort, non-blocking: detect any running vendor software (Razer,
  // Corsair, ASUS, MSI, Logitech) and connect to Chroma if found. Unlike
  // settings/gallery this isn't "the user's saved state" — an honest
  // "nothing detected yet" is a fine first paint, corrected a moment later
  // by the VENDOR_STATUS_CHANGED broadcast once this resolves.
  vendorManager
    .recheck()
    .then(() => {
      manager.refreshVendorDevices();
      broadcastVendorStatus();
      broadcastState();
    })
    .catch((err) => console.warn("[HARE] Initial vendor detection failed:", err));

  // Best-effort: see if a newer OpenRGB build (i.e. broader device support)
  // is available before we connect, and apply it silently if so, so a
  // freshly-released device has the best chance of being recognized on
  // first launch. Never blocks startup for long and never throws — a
  // failed check just means HARE proceeds with whatever's already bundled.
  try {
    await deviceDb.checkAndAutoApply();
  } catch (err) {
    console.warn("[HARE] Device database check failed, continuing with the current OpenRGB build:", err);
  }

  // Loaded and attached before the backend starts, so the very first device
  // list already triggers a restore rather than lighting up default-off and
  // correcting itself a moment later.
  await devicePrefs.load();
  manager.setDevicePrefsStore(devicePrefs);

  await manager.start();
  broadcastState();

  await logDiagnosticInventory();

  // Makes the one permission the user granted actually persistent in effect.
  //
  // The scheduled task runs at logon, which covers the normal case. It does
  // not cover HARE being started later in a session, updated, or restarted
  // from the tray — in those cases the task exists, the permission is still
  // granted, but nothing has launched the elevated OpenRGB yet, and the user
  // would see their motherboard and RAM quietly missing from the device list
  // with nothing to click. Starting it here means "granted once" behaves the
  // way it reads: it just works, every launch, with no further prompts.
  try {
    // Only when nothing is already listening: the task normally started
    // OpenRGB at logon, and running it again would leave two copies fighting
    // over the same buses — the exact conflict HARE warns other apps about.
    if ((await elevation.isEnabled()) && !(await isOpenRgbAlreadyRunning())) {
      const result = await elevation.startNow();
      if (result.ok) {
        await manager.rescan();
        broadcastState();
      }
    }
  } catch (err) {
    console.warn("[HARE] Couldn't start the elevated OpenRGB task:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else revealMainWindow();
  });
});

app.on("before-quit", () => {
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
  ambientSync.stop();
  stopGlobalInputHook();
  // Releases every sensor watcher, which is what shuts down the bridge's
  // child process rather than leaving it behind.
  thermalWatch?.();
  thermalWatch = null;
  for (const release of sensorWatchers.values()) release();
  sensorWatchers.clear();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
