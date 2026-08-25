import type { DeviceBackend } from "./deviceBackend.js";
import { OpenRgbBackend } from "./openrgbBackend.js";
import { NoDeviceBackend } from "./noDeviceBackend.js";
import { EffectRunner } from "./effectsEngine.js";
import { globalInputHookProblem, startGlobalInputHook, stopGlobalInputHook } from "./inputHook.js";
import { DevicePrefsStore } from "./devicePrefsStore.js";
import { deviceFingerprint } from "./deviceIdentity.js";
import { CompositeBackend } from "./compositeBackend.js";
import type { VendorDeviceSource } from "./vendors/vendorBackend.js";
import type { BackendState, EffectAssignment, EffectId, KLColor, KLDevice, ModeParamsPatch } from "./types.js";

/**
 * What an ARGB header with no length set is started at.
 *
 * Matches the number the device page offers, so the automatic choice and the
 * manual one agree. See restoreZoneSizes for why an untouched header can't be
 * left at zero.
 */
const DEFAULT_HEADER_LEDS = 8;

/** The device-agnostic half of an assignment: everything except which device it was aimed at. */
function assignmentWithoutDeviceId(assignment: EffectAssignment): Omit<EffectAssignment, "deviceId"> {
  return {
    zoneId: assignment.zoneId,
    effectId: assignment.effectId,
    color: assignment.color,
    secondaryColor: assignment.secondaryColor,
    speed: assignment.speed,
    brightness: assignment.brightness,
    layers: assignment.layers,
    loopSeconds: assignment.loopSeconds,
  };
}

export interface BackendManagerOptions {
  openRgbExePath?: string | null;
  openRgbPort?: number;
  /**
   * Test-only escape hatch: skip the real OpenRGB connection attempt and use
   * this backend directly instead. Used by the automated test suite
   * (test/smoke-live-effects.mjs, via FixtureBackend) to exercise the
   * effect system without needing OpenRGB or real hardware. The real
   * app never sets this.
   */
  testBackend?: DeviceBackend;
  /**
   * Vendor software, presented as devices. When supplied, every backend is
   * wrapped so vendor devices appear in the same list as OpenRGB's and are
   * driven by the same effect runner.
   */
  vendorDevices?: VendorDeviceSource;
}

/**
 * Top-level orchestrator: owns the active DeviceBackend and runs the
 * software EffectRunner against whichever one is live. This is the single
 * object main.ts talks to.
 *
 * HARE has exactly one real device source: whatever OpenRGB reports. There
 * used to be a "demo mode" that silently substituted five fake devices
 * whenever no real hardware was found or a live connection dropped —
 * removed on purpose. It actively hid the truth: someone with real,
 * unsupported, or not-yet-connected hardware would see a fully populated
 * device list with no way to tell it wasn't real. Now, whenever there's
 * nothing real to show, BackendManager falls back to NoDeviceBackend — zero
 * devices, plus the real reason why, and the UI renders an honest "no
 * devices detected" state instead of ever faking one.
 */
export class BackendManager {
  private backend: DeviceBackend;
  private effectRunner: EffectRunner;
  private assignments = new Map<string, EffectAssignment>();
  private listeners = new Set<(state: BackendState) => void>();
  private unsubDevices: (() => void) | null = null;
  private unsubStatus: (() => void) | null = null;
  /**
   * Remembers how each device was last set, so lighting comes back after a
   * reboot. Optional so the test harness can run without touching disk.
   */
  private devicePrefs: DevicePrefsStore | null = null;

  /** Attaches the persistence store. Separate from the constructor because loading it is async and main.ts owns that. */
  setDevicePrefsStore(store: DevicePrefsStore): void {
    this.devicePrefs = store;
  }

  /** Stable key for a device across restarts — see devicePrefsStore.ts on why the OpenRGB id can't be used. */
  private fingerprint(deviceId: number): string | null {
    const devices = this.backend.getDevices();
    const device = devices.find((d) => d.id === deviceId);
    return device ? deviceFingerprint(device, devices) : null;
  }

  private rememberDevice(deviceId: number, pref: import("./types.js").DevicePreference): void {
    const key = this.fingerprint(deviceId);
    if (key && this.devicePrefs) void this.devicePrefs.set(key, pref);
  }

  /**
   * Reapplies saved lighting to devices appearing for the first time this
   * session.
   *
   * Deliberately only on first sight: a rescan, a reconnect, or a device
   * momentarily dropping off USB must never overwrite whatever the user just
   * chose. DevicePrefsStore.shouldRestore enforces that once-per-session
   * rule, and choosing anything marks the device settled immediately.
   */
  private restoreSavedLighting(): void {
    const store = this.devicePrefs;
    if (!store) return;
    const devices = this.backend.getDevices();
    for (const device of devices) {
      const key = deviceFingerprint(device, devices);
      if (!store.shouldRestore(key)) continue;
      const pref = store.get(key);
      if (!pref) continue;
      try {
        if (pref.kind === "color") {
          void this.backend.setDeviceColor(device.id, pref.color);
          device.activeEffectId = "static";
        } else if (pref.kind === "mode") {
          void this.backend.setNativeMode(device.id, pref.modeId);
        } else if (pref.kind === "raw") {
          // A device can come back with a different number of LEDs — a strip
          // re-plugged, a header resized. Writing the old array would either
          // overrun or leave a tail undefined, so it's fitted to what the
          // device has now: extra LEDs repeat the painting rather than
          // staying dark.
          const fitted = Array.from(
            { length: device.colors.length },
            (_, i) => pref.colors[i % pref.colors.length]
          );
          void this.backend.setRawLedColors(device.id, fitted);
          device.activeEffectId = null;
        } else {
          this.applyEffect({ ...pref.assignment, deviceId: device.id });
        }
      } catch (err) {
        // A saved preference that no longer fits the hardware (a mode that
        // went away, a zone that shrank) must never stop HARE starting.
        console.warn("[HARE] Couldn't restore saved lighting for", device.name, err);
      }
    }
  }

  constructor(private opts: BackendManagerOptions = {}) {
    this.backend = new NoDeviceBackend();
    this.effectRunner = new EffectRunner((assignment, colors) => {
      void this.backend.setLedColors(assignment.deviceId, assignment.zoneId, colors);
    });
  }

  async start(): Promise<void> {
    if (this.opts.testBackend) {
      await this.opts.testBackend.connect();
      this.setBackend(this.opts.testBackend);
      return;
    }
    const live = new OpenRgbBackend({
      openRgbExePath: this.opts.openRgbExePath ?? null,
      port: this.opts.openRgbPort,
    });
    try {
      await live.connect();
      // Stay on the live OpenRGB connection no matter how many devices it
      // found. Zero is a real, honest state — nothing plugged in yet, or
      // HARE isn't running elevated so SMBus-only motherboard/RAM
      // controllers are invisible (see electron-builder.yml's
      // requestedExecutionLevel) — and the UI already renders a clear "no
      // devices detected" empty state for it, driven by devices.length.
      this.setBackend(live);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn("[HARE] Couldn't reach an OpenRGB server:", err);
      const empty = new NoDeviceBackend("disconnected", reason);
      await empty.connect();
      this.setBackend(empty);
    }
  }

  private setBackend(rawBackend: DeviceBackend) {
    // Vendor software is merged in here rather than at every call site, so
    // nothing above this line — effects, gallery, persistence, the second
    // screen — has to know a device came from Chroma rather than OpenRGB.
    const backend = this.opts.vendorDevices
      ? new CompositeBackend(rawBackend, this.opts.vendorDevices)
      : rawBackend;
    this.unsubDevices?.();
    this.unsubStatus?.();
    this.backend = backend;
    this.unsubDevices = backend.onDevicesChanged(() => {
      // Sizes first: a colour written to a zone that is still zero-length
      // goes nowhere, so the strip has to exist before it can be lit.
      this.restoreZoneSizes();
      // Devices may have only just appeared, so this is the earliest point
      // saved lighting can be put back. shouldRestore() makes it a no-op for
      // anything already handled this session.
      this.restoreSavedLighting();
      this.emitState();
    });
    this.unsubStatus = backend.onStatusChanged((status, message) => {
      this.emitState();
      // A previously-live OpenRGB connection can error out well after
      // startup (OpenRGB closing/crashing, a socket reset -- see
      // openrgbBackend.ts's handleClientError, added after a real crash
      // report). Without this, the UI would be stuck reporting a
      // "connected" status while the connection is actually silently dead.
      // Falls back to the same honest "no devices" placeholder start() uses
      // on a failed initial connect, with the real reason carried through,
      // instead of requiring a restart.
      if (backend.kind === "openrgb" && status === "error") {
        void this.fallbackToNoDevices(message);
      }
    });

    // The backend has usually already populated its device list by the time
    // it is handed over, so its own change event fired before the listener
    // above existed. Restoring here covers that first list; the listener
    // covers every later rescan and hot-plug.
    this.restoreSavedLighting();
    this.emitState();
  }

  private async fallbackToNoDevices(reason?: string): Promise<void> {
    this.effectRunner.clearAll();
    this.assignments.clear();
    this.syncReactiveHook();
    const empty = new NoDeviceBackend("error", reason);
    await empty.connect();
    this.setBackend(empty);
  }

  /**
   * Stops OpenRGB and starts it again.
   *
   * The button for when OpenRGB is wedged -- connected, but no longer doing
   * anything -- which is the state that otherwise means closing HARE,
   * hunting down OpenRGB.exe in Task Manager, and starting over.
   *
   * There are three genuinely different situations and this reports which
   * one it was in, because the useful answer is different in each:
   *
   *   - **HARE started it.** Stop it, wait for the port, start it again.
   *   - **The elevated logon task started it.** HARE runs unelevated and
   *     cannot stop an elevated process, so the caller restarts the task
   *     instead -- see `restartOpenRgb` in main.ts.
   *   - **Someone is running OpenRGB themselves.** Their window, their
   *     process. HARE reconnects and says so rather than killing it.
   */
  async restartOwnServer(): Promise<{ stopped: boolean; owned: boolean }> {
    const live = this.liveBackend();
    const owned = live?.ownsServer ?? false;
    if (!live || !owned) return { stopped: false, owned };
    const stopped = await live.stopOwnServer();
    if (stopped) await this.start();
    return { stopped, owned };
  }

  /** Reconnects to whatever OpenRGB is serving now, without stopping anything. */
  async reconnect(): Promise<void> {
    await this.start();
  }

  /** The real OpenRGB backend, past the vendor wrapper, or null when there isn't one. */
  private liveBackend(): OpenRgbBackend | null {
    const raw = this.backend instanceof CompositeBackend ? this.backend.primary : this.backend;
    return raw instanceof OpenRgbBackend ? raw : null;
  }

  async rescan(): Promise<void> {
    // Not even connected to OpenRGB right now (the "no devices" placeholder)
    // — a plain rescan() on it is a no-op by design, so retry the real
    // connection instead, same as a fresh start().
    if (this.backend.kind === "none") {
      await this.start();
      return;
    }
    await this.backend.rescan();
  }

  /** Why an effect that needs something outside HARE isn't getting it, by effect id. */
  private effectProblems: Partial<Record<EffectId, string>> = {};

  getState(): BackendState {
    return {
      status: this.backend.getStatus(),
      message: this.backend.getStatusMessage(),
      devices: this.backend.getDevices(),
      effectProblems: Object.keys(this.effectProblems).length ? { ...this.effectProblems } : undefined,
    };
  }

  async setDeviceColor(deviceId: number, color: KLColor): Promise<void> {
    this.clearEffect(deviceId, null);
    await this.backend.setDeviceColor(deviceId, color);
    this.rememberDevice(deviceId, { kind: "color", color });
  }

  /**
   * Sets a resizable zone's LED count, and remembers it.
   *
   * Remembering matters: OpenRGB does not persist this, so without it the
   * user would have to re-tell HARE how long their strip is after every
   * restart — which is exactly the kind of small, repeated indignity that
   * makes software feel broken.
   */
  async resizeZone(deviceId: number, zoneId: number, ledCount: number): Promise<void> {
    const device = this.backend.getDevices().find((d) => d.id === deviceId);
    const zone = device?.zones.find((z) => z.id === zoneId);
    if (!device || !zone) return;
    await this.backend.resizeZone?.(deviceId, zoneId, ledCount);

    const key = this.fingerprint(deviceId);
    if (key && this.devicePrefs) {
      // Keyed by zone name, which survives a firmware update reordering ids.
      void this.devicePrefs.setZoneSize(key, zone.name, ledCount);
    }
    this.emitState();
  }

  /**
   * Gives every ARGB header a length, before anything tries to light it.
   *
   * Two jobs, in priority order:
   *
   * 1. **Put back what the user set.** OpenRGB doesn't remember header
   *    lengths, so without this someone would have to re-tell HARE how long
   *    their strip is after every restart.
   * 2. **Give an untouched header a sensible one.** A header reports zero
   *    LEDs because the board cannot count what's plugged into it, and a
   *    zero-length zone swallows every colour silently. Leaving it at zero
   *    means the app looks broken to anyone who doesn't know to go looking
   *    for a setting they've never heard of — which is precisely what
   *    happened. Eight is the common case (one ARGB fan, most bundled
   *    strips); it is a starting point the user can change, not a guess HARE
   *    insists on.
   *
   * Runs on every device list rather than once per session, unlike saved
   * colours: a zone that isn't the right size yet has nowhere to put a
   * colour, so this has to happen first and again if the device reappears.
   */
  private restoreZoneSizes(): void {
    if (!this.backend.resizeZone) return;
    const devices = this.backend.getDevices();
    for (const device of devices) {
      const sizes = this.devicePrefs?.getZoneSizes(deviceFingerprint(device, devices)) ?? null;
      for (const zone of device.zones) {
        if (!zone.resizable) continue;
        const saved = sizes?.[zone.name];

        if (typeof saved === "number") {
          if (saved === zone.ledCount) continue;
          console.log(
            `[HARE] Restoring ${device.name} zone "${zone.name}" to the ${saved} LEDs you set previously.`
          );
          void this.backend.resizeZone(device.id, zone.id, saved);
          continue;
        }

        // Never set, and empty: give it something rather than leaving a
        // header that silently eats every colour.
        if (zone.ledCount === 0) {
          const size = Math.max(zone.ledsMin ?? 0, Math.min(zone.ledsMax ?? DEFAULT_HEADER_LEDS, DEFAULT_HEADER_LEDS));
          if (size <= 0) continue;
          console.log(
            `[HARE] ${device.name} zone "${zone.name}" reports no LEDs — a board can't count what's on a ` +
              `header, so HARE is starting it at ${size}. Change it on the device's page if your strip is a ` +
              "different length."
          );
          void this.backend.resizeZone(device.id, zone.id, size);
        }
      }
    }
  }

  async setZoneColor(deviceId: number, zoneId: number, color: KLColor): Promise<void> {
    this.clearEffect(deviceId, zoneId);
    await this.backend.setZoneColor(deviceId, zoneId, color);
  }

  async setNativeMode(deviceId: number, modeId: number): Promise<void> {
    this.clearEffect(deviceId, null);
    await this.backend.setNativeMode(deviceId, modeId);
    this.rememberDevice(deviceId, { kind: "mode", modeId });
  }

  /** Advanced Mode: same "this device is no longer under HARE's effect system" handling as setNativeMode, then writes the mode's own parameters (direction/colorMode/brightness/colors) rather than just switching which mode is active. */
  async updateModeParams(deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean): Promise<void> {
    this.clearEffect(deviceId, null);
    await this.backend.updateModeParams(deviceId, modeId, patch, persist);
  }

  /**
   * Advanced Mode: the raw per-LED painter's write path — same "hand control
   * back from HARE's effect system" handling as a manual color pick, then
   * pushes the caller's exact color array with no further processing.
   *
   * The save comes last, and the order is the whole trick: clearEffect wipes
   * whatever preference the device had, so a save written before it is erased
   * by the very call meant to record it.
   */
  async setRawLedColors(deviceId: number, colors: KLColor[]): Promise<void> {
    this.clearEffect(deviceId, null);
    await this.backend.setRawLedColors(deviceId, colors);
    this.rememberDevice(deviceId, { kind: "raw", colors: colors.map((c) => ({ ...c })) });
  }

  applyEffect(assignment: EffectAssignment): void {
    const device = this.findDevice(assignment.deviceId);
    if (!device) return;

    // "Static" is just a flat color — push it once instead of running it
    // through the 30fps effect loop forever.
    if (assignment.effectId === "static") {
      this.clearEffect(assignment.deviceId, assignment.zoneId);
      if (assignment.zoneId === null) {
        void this.backend.setDeviceColor(assignment.deviceId, assignment.color);
      } else {
        void this.backend.setZoneColor(assignment.deviceId, assignment.zoneId, assignment.color);
      }
      device.activeEffectId = "static";
      device.activeAssignment = assignmentWithoutDeviceId(assignment);
      this.rememberEffect(assignment);
      this.emitState();
      return;
    }

    const ledCount =
      assignment.zoneId === null
        ? device.colors.length
        : device.zones.find((z) => z.id === assignment.zoneId)?.ledCount ?? device.colors.length;
    this.assignments.set(this.key(assignment.deviceId, assignment.zoneId), assignment);
    this.effectRunner.set(assignment, ledCount);
    device.activeEffectId = assignment.effectId;
    device.activeAssignment = assignmentWithoutDeviceId(assignment);
    this.syncReactiveHook();
    this.rememberEffect(assignment);
    this.emitState();
  }

  /** Stores an assignment minus its device id, so the same look can be restored to whichever id the device gets next boot. */
  private rememberEffect(assignment: EffectAssignment): void {
    this.rememberDevice(assignment.deviceId, {
      kind: "effect",
      assignment: assignmentWithoutDeviceId(assignment),
    });
  }

  clearEffect(deviceId: number, zoneId: number | null): void {
    // Forget the saved look too, so "off" survives a restart rather than the
    // device lighting back up on next boot. Callers that immediately set
    // something else (a colour, a firmware mode) write their own preference
    // straight after this, so nothing is lost.
    const key = this.fingerprint(deviceId);
    if (key && this.devicePrefs) void this.devicePrefs.clear(key);

    if (this.assignments.delete(this.key(deviceId, zoneId))) {
      this.effectRunner.clear(deviceId, zoneId);
      const device = this.findDevice(deviceId);
      if (device && zoneId === null) {
        device.activeEffectId = null;
        device.activeAssignment = null;
      }
      this.syncReactiveHook();
      this.emitState();
    }
  }

  /** Whether any device is currently running an effect that needs a given live signal — see effectsEngine.ts's "Live signals" section. */
  isEffectActive(effectId: EffectId): boolean {
    return [...this.assignments.values()].some((a) => a.effectId === effectId);
  }

  /**
   * Starts/stops the OS-level global input hook (see inputHook.ts) to match
   * whether any device currently has the "Reactive" effect assigned — the
   * hook is real background cost (and something antivirus software watches
   * for), so it should only ever run while genuinely needed.
   *
   * Screen Sync's screen sampler and Music Reactive's audio capture are
   * gated the same way, but from outside this class, since they live in the
   * main process (ambientSync.ts) and the renderer (musicReactive.ts)
   * respectively — both read `isEffectActive` off the state they already
   * subscribe to.
   */
  private syncReactiveHook(): void {
    if (!this.isEffectActive("reactive")) {
      stopGlobalInputHook();
      this.clearEffectProblem("reactive");
      return;
    }
    void startGlobalInputHook().then(() => {
      // The hook already recorded why it couldn't start; until now nothing
      // ever read it, so Reactive simply sat there doing nothing with no
      // explanation anywhere in the interface.
      const problem = globalInputHookProblem();
      if (problem) this.setEffectProblem("reactive", problem);
      else this.clearEffectProblem("reactive");
    });
  }

  /** Records why an effect that needs something from outside HARE isn't getting it. */
  setEffectProblem(effectId: EffectId, reason: string): void {
    if (this.effectProblems[effectId] === reason) return;
    this.effectProblems[effectId] = reason;
    this.emitState();
  }

  clearEffectProblem(effectId: EffectId): void {
    if (!(effectId in this.effectProblems)) return;
    delete this.effectProblems[effectId];
    this.emitState();
  }

  /** Applies one effect, color, speed, and brightness across every connected device at once — the "Sync All" button. */
  async syncAll(
    effectId: EffectId,
    color: KLColor,
    secondaryColor: KLColor,
    speed: number,
    brightness: number,
    rainbow = false
  ): Promise<void> {
    for (const device of this.backend.getDevices()) {
      this.applyEffect({
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

  /**
   * Re-reads what vendor software is connected and folds the result into the
   * device list. Called after a vendor recheck: someone starting iCUE while
   * HARE is open should see their gear appear, not have to restart.
   */
  refreshVendorDevices(): void {
    if (!this.opts.vendorDevices) return;
    if (this.backend instanceof CompositeBackend) this.backend.refreshVendors();
    this.restoreSavedLighting();
    this.emitState();
  }

  onStateChanged(cb: (state: BackendState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private findDevice(deviceId: number): KLDevice | undefined {
    return this.backend.getDevices().find((d) => d.id === deviceId);
  }

  private key(deviceId: number, zoneId: number | null): string {
    return `${deviceId}:${zoneId ?? "all"}`;
  }

  private emitState() {
    const state = this.getState();
    this.listeners.forEach((cb) => cb(state));
  }
}
