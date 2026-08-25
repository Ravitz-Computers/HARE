import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import type { DeviceBackend } from "./deviceBackend.js";
import type { KLColor, KLDevice, KLDeviceType, KLMode, KLZone, BackendStatus, ModeParamsPatch } from "./types.js";

// Typed against the real openrgb-sdk v0.6 API (github.com/Mola19/openrgb-sdk).
// The package ships its own .d.ts, but since it's loaded via a dynamic
// import (see connect() below — it's the cleanest way to keep this file
// ESM while the SDK internally uses Node's `net` socket API), we redeclare
// just the surface we use here for clarity and so this file has no hard
// dependency on the package's own type-resolution setup.
type OrgbColor = { red: number; green: number; blue: number };
type OrgbMatrix = { size: number; height: number; width: number; keys: (number | undefined)[][] };
type OrgbZone = {
  id: number;
  name: string;
  type: number;
  ledsMin: number;
  ledsMax: number;
  ledsCount: number;
  resizable: boolean;
  matrix?: OrgbMatrix;
};
type OrgbLed = { name: string; value: number };
type OrgbMode = {
  id: number;
  name: string;
  value: number;
  flags: number;
  speedMin: number;
  speedMax: number;
  speed: number;
  colorMode: number;
  colors: OrgbColor[];
  flagList: string[];
  direction: number;
  colorMin: number;
  colorMax: number;
  brightnessMin?: number;
  brightnessMax?: number;
  brightness?: number;
};
/** The subset of openrgb-sdk's ModeInput HARE actually writes — see client.d.ts. `id` selects which mode; everything else is optional and left as-is by the SDK when omitted. */
type OrgbModeInput = {
  id: number;
  speed?: number;
  brightness?: number;
  direction?: number;
  colorMode?: number;
  colors?: OrgbColor[];
};
type OrgbDevice = {
  deviceId: number;
  type: number;
  name: string;
  vendor?: string;
  activeMode: number;
  modes: OrgbMode[];
  zones: OrgbZone[];
  leds: OrgbLed[];
  colors: OrgbColor[];
};

interface OpenRgbClient {
  connect(timeoutMs?: number): Promise<void>;
  disconnect(): void;
  getControllerCount(): Promise<number>;
  getControllerData(deviceId: number): Promise<OrgbDevice>;
  updateLeds(deviceId: number, colors: OrgbColor[]): void;
  updateZoneLeds(deviceId: number, zoneId: number, colors: OrgbColor[]): void;
  updateMode(deviceId: number, mode: number | string | OrgbModeInput): Promise<void>;
  /** Same as updateMode, but also writes the mode to the device's own onboard memory (if its firmware supports persisting at all — see flagList's manualSave/automaticSave). */
  saveMode(deviceId: number, mode: number | string | OrgbModeInput): Promise<void>;
  setCustomMode(deviceId: number): void;
  /** Tells the controller how many LEDs a resizable zone has — an ARGB header's strip length. */
  resizeZone(deviceId: number, zoneId: number, ledCount: number): void;
  requestRescan(): void;
  // Client extends Node's EventEmitter and re-emits its underlying TCP
  // socket's "error" event (e.g. ECONNRESET) as its own "error" event —
  // see the connect() retry loop below for why listening here is mandatory,
  // not optional.
  on(event: "error", listener: (err: Error) => void): unknown;
}

// Matches openrgb-sdk's `utils.deviceType` map, which in turn mirrors
// OpenRGB's own DeviceType enum. Kept as a plain lookup so a future
// OpenRGB protocol addition is a one-line change.
const DEVICE_TYPE_MAP: Record<number, KLDeviceType> = {
  0: "motherboard",
  1: "ram",
  2: "gpu",
  3: "cooler",
  4: "led-strip",
  5: "keyboard",
  6: "mouse",
  7: "mousemat",
  8: "headset",
  9: "headset", // headsetStand — no dedicated KL type yet, grouped with headset
  10: "gamepad",
  11: "led-strip", // light — generic addressable strips/panels, same bucket as ledstrip
  12: "speaker",
  13: "virtual", // OpenRGB's own synthetic/aggregate controllers (rare)
  14: "storage",
  15: "unknown",
};

function toKLColor(c: OrgbColor): KLColor {
  return { r: c.red, g: c.green, b: c.blue };
}

function toOrgbColor(c: KLColor): OrgbColor {
  return { red: c.r, green: c.g, blue: c.b };
}

function mapZones(zones: OrgbZone[]): KLZone[] {
  let cursor = 0;
  return zones.map((z) => {
    const zone: KLZone = {
      id: z.id,
      name: z.name || `Zone ${z.id + 1}`,
      ledStart: cursor,
      ledCount: z.ledsCount,
      matrix: z.matrix ? { rows: z.matrix.height, cols: z.matrix.width, keys: z.matrix.keys } : null,
      type: z.type,
      ledsMin: z.ledsMin,
      ledsMax: z.ledsMax,
      resizable: z.resizable,
    };
    cursor += z.ledsCount;
    return zone;
  });
}

function mapModes(modes: OrgbMode[]): KLMode[] {
  return modes.map((m) => ({
    id: m.id,
    name: m.name,
    supportsDirectColor: m.flagList.includes("perLedColor"),
    minSpeed: m.speedMin,
    maxSpeed: m.speedMax,
    speed: m.speed,
    flagList: m.flagList,
    direction: m.direction,
    colorMode: m.colorMode,
    colors: m.colors.map(toKLColor),
    colorMin: m.colorMin,
    colorMax: m.colorMax,
    brightnessMin: m.brightnessMin,
    brightnessMax: m.brightnessMax,
    brightness: m.brightness,
  }));
}

function mapDevice(raw: OrgbDevice): KLDevice {
  return {
    id: raw.deviceId,
    name: raw.name,
    vendor: raw.vendor || "Unknown",
    type: DEVICE_TYPE_MAP[raw.type] ?? "unknown",
    zones: mapZones(raw.zones),
    leds: raw.leds.map((l, i) => ({ id: i, name: l.name || `LED ${i + 1}` })),
    modes: mapModes(raw.modes),
    activeModeId: raw.activeMode,
    colors: raw.colors.map(toKLColor),
    activeEffectId: null,
  };
}

export interface OpenRgbBackendOptions {
  host?: string;
  port?: number;
  clientName?: string;
  /** Absolute path to a bundled/installed OpenRGB executable, if we should try to auto-launch it headless. */
  openRgbExePath?: string | null;
  connectTimeoutMs?: number;
  /** How many times to retry the initial socket connect before giving up (with backoff). Defaults to 4. */
  connectRetries?: number;
}

/**
 * Talks to a real OpenRGB SDK server (either one the user already has
 * running, or one HARE launches itself in headless `--server` mode
 * so the end user never sees the OpenRGB UI or branding at all).
 */
export class OpenRgbBackend implements DeviceBackend {
  readonly kind = "openrgb" as const;

  private client: OpenRgbClient | null = null;
  private status: BackendStatus = "disconnected";
  private statusMessage: string | undefined;
  private devices: KLDevice[] = [];
  private deviceListeners = new Set<(devices: KLDevice[]) => void>();
  private statusListeners = new Set<(status: BackendStatus, message?: string) => void>();
  private spawnedProcess: ChildProcess | null = null;
  /** Devices we've already flipped into "Direct"/custom mode this session, so we don't resend it on every effect frame. */
  private customModeSet = new Set<number>();

  constructor(private opts: OpenRgbBackendOptions = {}) {}

  private get host() {
    return this.opts.host ?? "127.0.0.1";
  }
  private get port() {
    return this.opts.port ?? 6742;
  }

  /**
   * Is something already serving the OpenRGB SDK port?
   *
   * Checked before launching anything, because there are now two legitimate
   * ways a server is already up: the elevated logon task HARE can install
   * (see elevationHelper.ts), or the user simply having OpenRGB open
   * themselves. Spawning a second copy in either case just produces a
   * process that fails to bind the port and lingers.
   */
  /**
   * Whether something is already serving OpenRGB's protocol on this port.
   *
   * Public because main.ts asks the same question before starting the
   * elevated task: whoever started the server — the logon task, or the user
   * running OpenRGB themselves — a second copy would fight the first over
   * the same buses.
   */
  async isServerAlreadyRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(700, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.connect(this.port, this.host);
    });
  }

  /** Best-effort: launch a bundled OpenRGB binary headlessly so HARE is self-contained. Safe to call even if no binary is present. */
  private async maybeLaunchOpenRgb(): Promise<void> {
    // Already served — leave it alone. Critically, this also leaves
    // `spawnedProcess` null, so shutdown() won't kill a server HARE didn't
    // start (which would take the user's own OpenRGB down with it).
    if (await this.isServerAlreadyRunning()) return;

    const exe = this.opts.openRgbExePath;
    if (!exe || !existsSync(exe)) return;
    try {
      this.spawnedProcess = spawn(exe, ["--server", "--server-port", String(this.port)], {
        detached: false,
        stdio: "ignore",
      });
      this.spawnedProcess.on("error", () => {
        // Non-fatal: connect() below will simply fail and the caller (BackendManager) falls back to its honest "no devices" state.
      });
      // Give the server a moment to bind before we try to connect. OpenRGB's
      // first cold start does a full hardware scan (SMBus/I2C for RAM and
      // motherboards especially) before its SDK server accepts connections,
      // which can genuinely take several seconds on a real PC with several
      // devices — much longer than this ever needs to be in the fake-server
      // tests. The retry loop in connect() below covers the rest.
      await new Promise((r) => setTimeout(r, 3000));
    } catch {
      // Ignore — connect() will surface the real failure.
    }
  }

  async connect(): Promise<void> {
    this.setStatus("starting", "Looking for RGB hardware…");
    await this.maybeLaunchOpenRgb();

    const timeoutMs = this.opts.connectTimeoutMs ?? 3000;
    // openrgb-sdk is CommonJS, and it defines its named exports via
    // Object.defineProperty rather than plain `exports.Client = ...`, which
    // Node's cjs-module-lexer doesn't statically detect. That means a
    // dynamic `import("openrgb-sdk")` does NOT get a usable named `Client`
    // export (it's undefined) — the real constructor only shows up on
    // `.default.Client`. Handle both shapes defensively in case a future
    // package version changes how it exports.
    const openRgbModule = (await import("openrgb-sdk")) as unknown as {
      Client?: new (name: string, port: number, host: string) => OpenRgbClient;
      default?: { Client: new (name: string, port: number, host: string) => OpenRgbClient };
    };
    const Client = openRgbModule.Client ?? openRgbModule.default?.Client;
    if (!Client) {
      throw new Error("openrgb-sdk: could not resolve the Client constructor from the package export");
    }

    // Retry the actual socket connect a few times with backoff — even after
    // the startup wait above, a freshly (re)launched OpenRGB server can take
    // a little longer than expected to start accepting connections,
    // especially on first run. Without this, a real PC with real hardware
    // could spuriously show "no devices detected" just from being slightly
    // slow to boot, which is a much worse experience than waiting a few
    // more seconds.
    const attempts = this.opts.connectRetries ?? 4;
    const delaysMs = [500, 1000, 2000, 3000];
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const client = new Client(this.opts.clientName ?? "HARE", this.port, this.host);
      // MANDATORY, not defensive: openrgb-sdk's Client re-emits its socket's
      // "error" event (ECONNRESET if OpenRGB closes/crashes mid-session, a
      // network hiccup, etc.) as its own "error" event, and Node's
      // EventEmitter specifically throws an "error" event as an uncaught
      // exception when nothing is listening for it -- taking down the
      // entire Electron main process with a raw crash dialog. Confirmed via
      // a real crash report from a real Windows PC (read ECONNRESET at
      // TCP.onStreamRead) — this happened well after a successful connect,
      // so it was silently killing the app on an otherwise-working setup,
      // not merely failing to reach OpenRGB in the first place. Attached on
      // every attempt (not just the one that succeeds) since a failed
      // attempt's socket can still fire "error" asynchronously after being
      // disconnected below.
      client.on("error", (err) => this.handleClientError(client, err));
      try {
        await client.connect(timeoutMs);
        this.client = client;
        this.customModeSet.clear();
        this.setStatus("scanning", "Scanning for devices…");
        await this.refreshDevices();
        this.setStatus("connected", `Connected — ${this.devices.length} device(s) found`);
        return;
      } catch (err) {
        lastError = err;
        try {
          client.disconnect();
        } catch {
          // Ignore — the connect attempt already failed, this is just cleanup.
        }
        if (attempt < attempts - 1) {
          await new Promise((r) => setTimeout(r, delaysMs[attempt] ?? 2000));
        }
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Couldn't reach an OpenRGB server on ${this.host}:${this.port} after ${attempts} attempts (${reason})`);
  }

  /**
   * Handles a socket-level error re-emitted by the Client after it's already
   * connected (see the mandatory `client.on("error", ...)` above). This is
   * the only thing standing between a dropped connection and an uncaught
   * exception crashing the whole app — see that comment for the real
   * incident this fixes.
   */
  private handleClientError(client: OpenRgbClient, err: Error): void {
    // A discarded client from a failed retry attempt can still fire "error"
    // asynchronously after being disconnected -- only react if this is
    // actually the client we're currently using.
    if (client !== this.client) return;
    console.warn("[HARE] Lost the OpenRGB connection:", err);
    this.client = null;
    this.setStatus("error", `Lost the connection to OpenRGB: ${err.message || String(err)}`);
  }

  async disconnect(): Promise<void> {
    this.client?.disconnect();
    this.client = null;
    if (this.spawnedProcess) {
      this.spawnedProcess.kill();
      this.spawnedProcess = null;
    }
    this.setStatus("disconnected");
  }

  async rescan(): Promise<void> {
    if (!this.client) throw new Error("Not connected to OpenRGB");
    this.setStatus("scanning", "Rescanning for devices…");
    this.client.requestRescan();
    // OpenRGB needs a moment to actually rescan hardware before controller
    // data reflects the new list.
    await new Promise((r) => setTimeout(r, 1200));
    await this.refreshDevices();
    this.setStatus("connected", `Connected — ${this.devices.length} device(s) found`);
  }

  private async refreshDevices(): Promise<void> {
    if (!this.client) return;
    const count = await this.client.getControllerCount();
    const devices: KLDevice[] = [];
    for (let i = 0; i < count; i++) {
      const raw = await this.client.getControllerData(i);
      devices.push(mapDevice(raw));
    }
    this.devices = devices;
    this.emitDevices();
  }

  /**
   * Puts a device into the mode that accepts colours from software.
   *
   * Most controllers ignore per-LED writes unless they've been switched into
   * a direct/custom mode first — an ASUS board sitting in one of its own
   * firmware modes will accept everything HARE sends and keep doing whatever
   * it was doing. Done once per device per session, and re-armed whenever a
   * write is found not to have taken (see confirmWrite) or the device leaves
   * that mode.
   */
  private ensureCustomMode(deviceId: number) {
    if (!this.client || this.customModeSet.has(deviceId)) return;
    this.client.setCustomMode(deviceId);
    this.customModeSet.add(deviceId);

    const device = this.devices.find((d) => d.id === deviceId);
    if (device) {
      const direct = device.modes.find((mode) => mode.supportsDirectColor);
      // Written to the log rather than shown: it only matters when someone is
      // working out why a device won't change, and then it matters a lot.
      console.log(
        `[HARE] ${device.name}: switching to a direct-colour mode. ` +
          (direct
            ? `Its modes include "${direct.name}".`
            : `WARNING — none of its modes (${device.modes.map((m) => m.name).join(", ") || "none reported"}) ` +
              "claim to accept per-LED colour, so it may ignore everything HARE sends.")
      );
    }
  }

  getStatus(): BackendStatus {
    return this.status;
  }

  getStatusMessage(): string | undefined {
    return this.statusMessage;
  }

  getDevices(): KLDevice[] {
    return this.devices;
  }

  async setDeviceColor(deviceId: number, color: KLColor): Promise<void> {
    if (!this.client) return;
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) {
      console.warn(`[HARE] Asked to colour device ${deviceId}, which isn't in the list.`);
      return;
    }
    this.ensureCustomMode(deviceId);
    const full = new Array(device.colors.length).fill(toOrgbColor(color));
    // Deliberate colour changes are logged; effect frames are not, or a log
    // would be thirty lines a second of nothing anyone can read.
    console.log(
      `[HARE] Writing rgb(${color.r}, ${color.g}, ${color.b}) to all ${full.length} LEDs of ${device.name}.`
    );
    this.client.updateLeds(deviceId, full);
    device.colors = device.colors.map(() => color);
    this.emitDevices();
    void this.confirmWrite(deviceId, color);
  }

  /**
   * Checks whether a colour actually took, and remembers when it didn't.
   *
   * The OpenRGB protocol has no acknowledgement: `updateLeds` is a one-way
   * message, so a write to a device that cannot really be driven — a
   * motherboard enumerated over SMBus while OpenRGB is running unelevated is
   * the common case — succeeds silently and changes nothing. HARE was then
   * showing the new colour in its UI and reporting success, while the
   * hardware sat there unchanged. That is the worst kind of bug: the app and
   * the room disagree, and the app sounds confident.
   *
   * So after a user-initiated colour change, the device's own state is read
   * back and compared. This runs only for deliberate changes, never for
   * effect frames — a read-back at 30fps would cost more than the write.
   */
  private async confirmWrite(deviceId: number, expected: KLColor): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      const fresh = (await client.getControllerData(deviceId)) as OrgbDevice | undefined;
      const actual = fresh?.colors?.[0];
      if (!actual) {
        console.warn(
          `[HARE] Device ${deviceId} reported no colours back, so HARE can't tell whether the write took.`
        );
        return;
      }
      console.log(
        `[HARE] Read back rgb(${actual.red}, ${actual.green}, ${actual.blue}) ` +
          `after asking for rgb(${expected.r}, ${expected.g}, ${expected.b}). ` +
          `Active mode is now "${fresh?.modes?.[fresh.activeMode ?? 0]?.name ?? "unknown"}".`
      );

      // Exact equality is too strict: some controllers quantise colour, so a
      // near miss is still a device that is listening.
      const close =
        Math.abs(actual.red - expected.r) <= 8 &&
        Math.abs(actual.green - expected.g) <= 8 &&
        Math.abs(actual.blue - expected.b) <= 8;

      const device = this.devices.find((d) => d.id === deviceId);
      if (close) {
        if (this.unresponsiveDevices.delete(deviceId) && device) {
          device.unresponsive = false;
          this.emitDevices();
        }
      } else {
        // Try once more from a clean slate before believing it: the most
        // common reason a write doesn't take is the device having dropped out
        // of direct mode (its own software reasserting itself, a firmware
        // reset, OpenRGB reconnecting), and re-arming costs one message.
        const firstFailure = !this.unresponsiveDevices.has(deviceId);
        this.customModeSet.delete(deviceId);

        if (firstFailure) {
          this.unresponsiveDevices.add(deviceId);
          if (device) device.unresponsive = true;
          console.warn(
            `[HARE] ${device?.name ?? `Device ${deviceId}`} accepted a colour but didn't change. ` +
              `Asked for rgb(${expected.r}, ${expected.g}, ${expected.b}), it reports ` +
              `rgb(${actual.red}, ${actual.green}, ${actual.blue}). ` +
              "Re-applying direct mode; if this repeats, another RGB app is probably driving it."
          );
          this.emitDevices();
        }
      }
    } catch {
      // A failed read-back proves nothing either way, so it changes nothing.
    }
  }

  /** Devices that accept writes but don't visibly change. See confirmWrite. */
  private unresponsiveDevices = new Set<number>();

  /** Whether a device took the last colour it was given. */
  isDeviceResponsive(deviceId: number): boolean {
    return !this.unresponsiveDevices.has(deviceId);
  }

  /**
   * Tells the board how many LEDs are on a resizable zone (an ARGB header).
   *
   * This is the step that was missing entirely. A header reports zero LEDs
   * because the board cannot count what's plugged into it; until it is told,
   * every colour written to that zone goes nowhere. OpenRGB's own window has
   * this control, which is exactly why OpenRGB could light a strip that HARE
   * could not.
   *
   * The device is re-read afterwards rather than patched locally: the board
   * decides what it actually accepted, and it may clamp the request.
   */
  async resizeZone(deviceId: number, zoneId: number, ledCount: number): Promise<void> {
    if (!this.client) return;
    const device = this.devices.find((d) => d.id === deviceId);
    const zone = device?.zones.find((z) => z.id === zoneId);
    if (!device || !zone) return;

    const min = zone.ledsMin ?? 0;
    const max = zone.ledsMax ?? ledCount;
    const size = Math.max(min, Math.min(max, Math.round(ledCount)));
    console.log(
      `[HARE] Setting zone "${zone.name}" of ${device.name} to ${size} LEDs (allowed ${min}-${max}).`
    );
    this.client.resizeZone(deviceId, zoneId, size);

    // Resizing changes the whole device's LED layout, so the fresh data has
    // to come from the server — every later write depends on the new counts.
    await this.refreshSingleDevice(deviceId);
    // A zone that just gained LEDs needs the device put back into a
    // direct-colour mode before anything will show on it.
    this.customModeSet.delete(deviceId);
    this.ensureCustomMode(deviceId);
  }

  async setZoneColor(deviceId: number, zoneId: number, color: KLColor): Promise<void> {
    if (!this.client) return;
    const device = this.devices.find((d) => d.id === deviceId);
    const zone = device?.zones.find((z) => z.id === zoneId);
    if (!device || !zone) return;
    console.log(
      `[HARE] Writing rgb(${color.r}, ${color.g}, ${color.b}) to zone "${zone.name}" ` +
        `(${zone.ledCount} LEDs from ${zone.ledStart}) of ${device.name}.`
    );
    this.ensureCustomMode(deviceId);
    const zoneColors = new Array(zone.ledCount).fill(toOrgbColor(color));
    this.client.updateZoneLeds(deviceId, zoneId, zoneColors);
    for (let i = zone.ledStart; i < zone.ledStart + zone.ledCount; i++) device.colors[i] = color;
    this.emitDevices();
  }

  async setLedColors(deviceId: number, zoneId: number | null, colors: KLColor[]): Promise<void> {
    if (!this.client) return;
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return;
    this.ensureCustomMode(deviceId);

    if (zoneId === null) {
      this.client.updateLeds(deviceId, colors.map(toOrgbColor));
      device.colors = colors;
    } else {
      const zone = device.zones.find((z) => z.id === zoneId);
      if (!zone) return;
      this.client.updateZoneLeds(deviceId, zoneId, colors.map(toOrgbColor));
      for (let i = 0; i < colors.length && i < zone.ledCount; i++) {
        device.colors[zone.ledStart + i] = colors[i];
      }
    }
    // Emitted at effect-runner frame rate (~30fps) so the UI animates live.
    this.emitDevices();
  }

  async setNativeMode(deviceId: number, modeId: number): Promise<void> {
    if (!this.client) return;
    await this.client.updateMode(deviceId, modeId);
    this.customModeSet.delete(deviceId); // leaving Direct mode — re-arm ensureCustomMode next time we want it back
    const device = this.devices.find((d) => d.id === deviceId);
    if (device) {
      device.activeModeId = modeId;
      device.activeEffectId = null;
    }
    this.emitDevices();
  }

  /**
   * Advanced Mode: writes a partial parameter update to one of a device's
   * own native modes — direction, colorMode, per-mode brightness, and the
   * mode's own color slots, on top of the simple id-only mode switch
   * setNativeMode does. `persist` picks updateMode (live only) vs. saveMode
   * (also written to the device's onboard memory).
   *
   * openrgb-sdk's updateMode/saveMode both re-fetch the device's current
   * controller data internally before sending (see client.js's sendMode),
   * so this always merges the patch against the device's real current
   * state rather than a possibly-stale local copy. After the write, this
   * refetches just that one device so KLDevice.modes reflects what's
   * actually on the hardware now, not what HARE assumed it set.
   */
  async updateModeParams(deviceId: number, modeId: number, patch: ModeParamsPatch, persist: boolean): Promise<void> {
    if (!this.client) return;
    const modeInput: OrgbModeInput = { id: modeId };
    if (patch.speed !== undefined) modeInput.speed = patch.speed;
    if (patch.brightness !== undefined) modeInput.brightness = patch.brightness;
    if (patch.direction !== undefined) modeInput.direction = patch.direction;
    if (patch.colorMode !== undefined) modeInput.colorMode = patch.colorMode;
    if (patch.colors !== undefined) modeInput.colors = patch.colors.map(toOrgbColor);

    if (persist) await this.client.saveMode(deviceId, modeInput);
    else await this.client.updateMode(deviceId, modeInput);

    await this.refreshSingleDevice(deviceId);
  }

  /** Advanced Mode: pushes a full per-device LED color array directly, same underlying path as the effects engine but driven by the user's own raw painter instead of a computed animation frame. */
  async setRawLedColors(deviceId: number, colors: KLColor[]): Promise<void> {
    await this.setLedColors(deviceId, null, colors);
  }

  /** Re-fetches one device's controller data and replaces it in the cached list — used after updateModeParams since the mode's own fields (speed/brightness/direction/colorMode/colors) just changed on the hardware side. */
  private async refreshSingleDevice(deviceId: number): Promise<void> {
    if (!this.client) return;
    const raw = await this.client.getControllerData(deviceId);
    const mapped = mapDevice(raw);
    const idx = this.devices.findIndex((d) => d.id === deviceId);
    if (idx >= 0) this.devices[idx] = mapped;
    else this.devices.push(mapped);
    this.emitDevices();
  }

  onDevicesChanged(cb: (devices: KLDevice[]) => void): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  onStatusChanged(cb: (status: BackendStatus, message?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(status: BackendStatus, message?: string) {
    this.status = status;
    this.statusMessage = message;
    this.statusListeners.forEach((cb) => cb(status, message));
  }

  private emitDevices() {
    this.deviceListeners.forEach((cb) => cb(this.devices));
  }
}
