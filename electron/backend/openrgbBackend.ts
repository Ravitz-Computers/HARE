import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { DeviceBackend } from "./deviceBackend.js";
import {
  fetchControllerData,
  parseControllerData,
  sendUpdateMode,
  type ModeToSend,
  type RawOrgbMode,
} from "./openrgbRawDevice.js";
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

/**
 * The colours to send with a mode.
 *
 * A mode declares how many colours of its own it takes: `colorMin` is the
 * fewest it will accept, and a mode that wants one and is given none has
 * nothing to draw. On a Lian Li hub that is the difference between the modes
 * that worked after mode-setting was fixed and the modes that appeared to do
 * nothing — Spectrum Cycle and Rainbow Wave generate their own colours and
 * came out fine, while Static, Breathing and Neon were set successfully and
 * ran with an empty palette.
 *
 * A controller that already has colours for the mode reports them and they go
 * straight back. When it reports none and the mode needs some, the device's
 * current colour is used, so choosing a firmware effect keeps the colour that
 * was already on the fans rather than replacing it with a decision nobody
 * made. White is the last resort: visible, and obviously a default.
 */
function modeColorsFor(
  mode: { colorMin: number; colorMax: number; colors: OrgbColor[] },
  chosen: OrgbColor[] | undefined,
  current: KLColor | undefined
): OrgbColor[] {
  const colors = [...(chosen ?? mode.colors)];
  const needed = Math.max(0, mode.colorMin);
  if (colors.length >= needed) return colors;

  const fill = colors[colors.length - 1] ?? (current ? toOrgbColor(current) : { red: 255, green: 255, blue: 255 });
  while (colors.length < needed) colors.push(fill);
  // Never send more than the mode will take: the count is what the controller
  // reads the rest of the block against, so an over-long palette is a
  // malformed message rather than a generous one.
  return mode.colorMax > 0 ? colors.slice(0, mode.colorMax) : colors;
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
  /**
   * Asked before HARE starts an OpenRGB of its own, and only then.
   *
   * Returning a reason refuses the launch. Starting OpenRGB is what triggers
   * a full hardware scan, including the SMBus sweep that must not run while
   * another RGB application owns the bus — see vendors/smbusConflicts.ts.
   * Connecting to a server that is *already* up is not gated, because that
   * scan has already happened and nothing new is probed by joining it.
   *
   * A function rather than a flag so this file keeps no dependency on the
   * vendor-detection code, and so tests can construct a backend with no gate
   * at all.
   */
  beforeSpawn?: () => Promise<string | null>;
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
  /** Set when beforeSpawn refused to let HARE start OpenRGB, so connect() can report that rather than a socket error. */
  private spawnRefusal: string | null = null;
  /**
   * The protocol version to ask openrgb-sdk to speak, or null to negotiate.
   *
   * Dropped a step at a time when the newest one produces data the SDK can't
   * parse. Each older version simply has fewer fields in the reply, so there
   * is less for a stale parser to get wrong — and HARE reads none of the
   * fields that disappear (zone flags, device flags, alternate LED names,
   * segments). See PROTOCOL_FALLBACKS.
   */
  private forcedProtocolVersion: number | null = null;
  /** Devices whose data came back in a shape the SDK couldn't read, by index and reason. */
  private unreadableDevices: { id: number; reason: string }[] = [];
  /** Devices already known to need HARE's own parser, so they never take the failing path twice. */
  private directReadDevices = new Set<number>();
  /**
   * The last direct read's mode records, exactly as the controller sent them.
   *
   * Kept because setting a mode means sending the whole mode block back, and
   * two of its fields — the vendor's own effect number and the flags saying
   * which fields are meaningful — exist nowhere else in HARE. Without them
   * the only thing that can be sent is a fabricated block, and a fabricated
   * block is what turned a fan hub's lights off on every mode.
   */
  private directModes = new Map<number, RawOrgbMode[]>();

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
  /**
   * Whether the OpenRGB currently serving is the one HARE started.
   *
   * The difference matters for restarting: HARE can stop a server it
   * launched, and must not stop one it didn't -- somebody running OpenRGB
   * themselves, with their own window open, would have it vanish under them.
   */
  get ownsServer(): boolean {
    return this.spawnedProcess !== null;
  }

  /** Stops the server HARE started, and waits for the port to actually free up. */
  async stopOwnServer(timeoutMs = 5000): Promise<boolean> {
    this.client?.disconnect();
    this.client = null;
    if (this.spawnedProcess) {
      this.spawnedProcess.kill();
      this.spawnedProcess = null;
    }
    // Killing the process and the socket closing are not the same moment, and
    // relaunching into a port that is still held produces a second server
    // that binds nothing and reports no devices -- which looks exactly like
    // the fault the restart was meant to clear.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.isServerAlreadyRunning())) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

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

  /**
 * Notes, once, whether OpenRGB's settings folder existed before HARE ever
 * started it.
 *
 * OpenRGB writes %APPDATA%\OpenRGB the first time it runs, and HARE runs it
 * without a config path of its own — deliberately, so that HARE and a
 * standalone OpenRGB share one set of profiles rather than fighting over the
 * hardware with two.
 *
 * The consequence is that on a PC where the user never had OpenRGB, HARE is
 * the only reason that folder exists; on a PC where they did, it is theirs.
 * Uninstalling has to be able to tell those apart, and only the moment before
 * the first launch can. The answer is written where the uninstaller can read
 * it — the same shape as the PawnIO marker, for the same reason.
 */
private noteOpenRgbConfigOwnership(): void {
  if (process.platform !== "win32") return;
  const appData = process.env.APPDATA;
  if (!appData) return;
  const configDir = path.join(appData, "OpenRGB");
  // Only ever asked once. After the first launch the folder always exists,
  // and asking again would record the wrong answer.
  const alreadyAnswered = spawnSync("reg.exe", [
    "query",
    "HKCU\\Software\\HARE",
    "/v",
    "OpenRgbConfigCreatedByHare",
  ]);
  if (alreadyAnswered.status === 0) return;

  spawnSync("reg.exe", [
    "add",
    "HKCU\\Software\\HARE",
    "/v",
    "OpenRgbConfigCreatedByHare",
    "/t",
    "REG_DWORD",
    "/d",
    existsSync(configDir) ? "0" : "1",
    "/f",
  ]);
}

/** Best-effort: launch a bundled OpenRGB binary headlessly so HARE is self-contained. Safe to call even if no binary is present. */
  private async maybeLaunchOpenRgb(): Promise<void> {
    // Already served — leave it alone. Critically, this also leaves
    // `spawnedProcess` null, so shutdown() won't kill a server HARE didn't
    // start (which would take the user's own OpenRGB down with it).
    if (await this.isServerAlreadyRunning()) return;

    const exe = this.opts.openRgbExePath;
    if (!exe || !existsSync(exe)) return;

    // The one moment a scan can be refused before it happens. Everything
    // below this line starts OpenRGB, and starting OpenRGB sweeps the SMBus.
    const refusal = this.opts.beforeSpawn ? await this.opts.beforeSpawn() : null;
    if (refusal) {
      console.warn(`[HARE] Not starting OpenRGB: ${refusal}`);
      this.spawnRefusal = refusal;
      return;
    }

    this.noteOpenRgbConfigOwnership();
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

  /**
   * Protocol versions to try, newest first.
   *
   * `null` means "negotiate", which is what should work and what every
   * healthy setup uses. The rest are deliberate step-downs for the case the
   * negotiated reply is something openrgb-sdk can't parse.
   *
   * This is safe because every step removes fields rather than changing
   * them, and HARE reads none of the ones that go: v5 adds zone flags,
   * device flags and alternate LED names; v4 adds zone segments. Devices,
   * zones, modes, LEDs and colours — everything HARE actually uses — are the
   * same at v3. So a fallback costs nothing a user would notice, and the
   * alternative is the whole device list.
   */
  private static readonly PROTOCOL_FALLBACKS: (number | null)[] = [null, 4, 3];

  async connect(): Promise<void> {
    this.setStatus("starting", "Looking for RGB hardware…");
    await this.maybeLaunchOpenRgb();

    // Try the negotiated protocol first, then older ones, and keep whichever
    // reads the MOST devices.
    //
    // Not just "the first one that connects": on a real machine the newest
    // protocol read two of three devices and dropped a Lian Li fan controller
    // whose reply openrgb-sdk walked off the end of. Two working devices is
    // not success when the third is the one the user was asking about.
    //
    // Older versions are strictly smaller replies -- v5 adds zone flags,
    // device flags and alternate LED names, v4 adds zone segments -- and HARE
    // reads none of those, so a step down costs nothing except the chance
    // that the awkward device parses. Reconnecting is also cheap and safe:
    // joining a running server does not re-scan any hardware (see
    // maybeLaunchOpenRgb), so this cannot touch the SMBus.
    let lastParseFailure: unknown;
    let best: { version: number | null; count: number } | null = null;

    for (const version of OpenRgbBackend.PROTOCOL_FALLBACKS) {
      this.forcedProtocolVersion = version;
      let connected = false;
      try {
        await this.connectOnce();
        connected = true;
      } catch (err) {
        if (!(err instanceof Error) || !this.isParseFailure(err)) throw err;
        lastParseFailure = err;
        console.warn(
          `[HARE] Protocol ${version ?? "negotiated"}: couldn't read any device (${err.message})`
        );
      }

      if (connected) {
        const readable = this.devices.length;
        const missed = this.unreadableDevices.length;
        console.log(
          `[HARE] Protocol ${version ?? "negotiated"}: read ${readable} device(s)` +
            (missed > 0 ? `, couldn't read ${missed}` : "")
        );
        // Everything parsed. Nothing older can do better than that.
        if (missed === 0) return;
        if (!best || readable > best.count) best = { version, count: readable };
      }

      this.dropClient();
    }

    // Nothing read every device. Settle on whichever read the most rather
    // than leaving the user with the last one tried, which may be the worst.
    if (best) {
      this.forcedProtocolVersion = best.version;
      console.log(
        `[HARE] Settling on protocol ${best.version ?? "negotiated"}, which read the most devices (${best.count}).`
      );
      await this.connectOnce();
      return;
    }

    throw lastParseFailure instanceof Error
      ? lastParseFailure
      : new Error("Couldn't read the device list at any protocol version.");
  }

  /** Closes and forgets the current client, so the next attempt starts clean. */
  private dropClient(): void {
    try {
      this.client?.disconnect();
    } catch {
      // Already broken; this is only cleanup before the next attempt.
    }
    this.client = null;
  }

  /**
   * Whether a failure came from parsing the reply rather than reaching the
   * server. Only a parse failure is worth retrying at an older protocol.
   */
  private isParseFailure(err: Error): boolean {
    return err.message.includes("couldn't read the device list");
  }

  private async connectOnce(): Promise<void> {

    const timeoutMs = this.opts.connectTimeoutMs ?? 3000;
    // openrgb-sdk is CommonJS, and it defines its named exports via
    // Object.defineProperty rather than plain `exports.Client = ...`, which
    // Node's cjs-module-lexer doesn't statically detect. That means a
    // dynamic `import("openrgb-sdk")` does NOT get a usable named `Client`
    // export (it's undefined) — the real constructor only shows up on
    // `.default.Client`. Handle both shapes defensively in case a future
    // package version changes how it exports.
    type ClientCtor = new (
      name: string,
      port: number,
      host: string,
      settings?: { forceProtocolVersion?: number }
    ) => OpenRgbClient;
    const openRgbModule = (await import("openrgb-sdk")) as unknown as {
      Client?: ClientCtor;
      default?: { Client: ClientCtor };
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
      const client = new Client(
        this.opts.clientName ?? "HARE",
        this.port,
        this.host,
        this.forcedProtocolVersion === null ? {} : { forceProtocolVersion: this.forcedProtocolVersion }
      );
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
        continue;
      }

      // Connected. Everything past this point is a *different* failure with a
      // different cause, and must not be retried as though the socket were at
      // fault or reported as one.
      //
      // This distinction cost a real user their whole device list. A parsing
      // bug in openrgb-sdk threw while reading the controller data, the throw
      // landed in the catch above, and HARE retried four times and reported
      // "Couldn't reach an OpenRGB server ... (Invalid array length)" — on a
      // machine where OpenRGB was running perfectly and its own window showed
      // every device. The message sent them looking for a connection problem
      // that did not exist. See scripts/patch-openrgb-sdk.mjs.
      this.client = client;
      this.customModeSet.clear();
      this.setStatus("scanning", "Scanning for devices…");
      try {
        await this.refreshDevices();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Connected to OpenRGB, but couldn't read the device list it sent back (${detail}). ` +
            "OpenRGB itself is running — its own window will still show your devices.",
          { cause: err }
        );
      }
      this.setStatus("connected", `Connected — ${this.devices.length} device(s) found`);
      return;
    }
    // If HARE declined to start OpenRGB, say that instead of "couldn't reach
    // a server". Both are true; only one tells the person what to do, and a
    // connection error here would send them looking for a problem that isn't
    // theirs.
    if (this.spawnRefusal) {
      throw new Error(this.spawnRefusal);
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

  /**
   * Reads every device, and refuses to let one bad reply cost all of them.
   *
   * This used to be a plain loop. One device whose data openrgb-sdk couldn't
   * parse threw, the throw came out of refreshDevices, and the user got zero
   * devices on a PC full of working hardware — twice, on two different
   * parsing bugs. Whatever the next one turns out to be, a keyboard should
   * not disappear because a fan controller sent a field the parser didn't
   * expect.
   *
   * So each device is read on its own. What can be read is kept; what can't
   * is recorded by index and named in the log, which is also the only way
   * anyone finds out *which* device is the awkward one.
   */
  private async refreshDevices(): Promise<void> {
    if (!this.client) return;
    const count = await this.client.getControllerCount();
    const devices: KLDevice[] = [];
    const unreadable: { id: number; reason: string }[] = [];

    for (let i = 0; i < count; i++) {
      try {
        // readOneDevice falls back to HARE's own parser for a device
        // openrgb-sdk can't read, and remembers it so the next read of that
        // device goes straight there.
        const device = await this.readOneDevice(i);
        if (device) devices.push(device);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        unreadable.push({ id: i, reason });
        console.warn(
          `[HARE] Device ${i} of ${count} sent data HARE couldn't read (${reason}). ` +
            "Skipping it and carrying on with the rest."
        );
      }
    }

    // Nothing readable at all is a different situation: it means the parser
    // and the server disagree about the protocol rather than one odd device,
    // and connect() can still do something about that.
    if (devices.length === 0 && unreadable.length > 0) {
      throw new Error(unreadable[0].reason, { cause: unreadable[0] });
    }

    this.devices = devices;
    this.unreadableDevices = unreadable;
    if (unreadable.length > 0) {
      console.warn(
        `[HARE] ${unreadable.length} of ${count} device(s) couldn't be read. ` +
          `Showing the other ${devices.length}.`
      );
    }
    this.emitDevices();
  }

  /**
   * Reads one device with HARE's own parser, after openrgb-sdk failed on it.
   *
   * Deliberately narrow. It runs only for a device that has already thrown,
   * and only when the throw is the parser losing its place in the reply —
   * "offset out of range" and its relatives. A timeout, a dropped socket or a
   * server that went away are not parsing problems and get nothing from
   * trying a second parser on them.
   */
  /**
   * Reads one device, however it has to be read.
   *
   * The single place that knows a device might need HARE's own parser. Once a
   * device has needed it, it is remembered and goes straight there — the
   * alternative is throwing and recovering on every single read of that
   * device, which on a machine with one awkward controller produced a
   * hundred-line wall of recovered rejections in the log for one button press.
   */
  private async readOneDevice(deviceId: number): Promise<KLDevice | null> {
    if (!this.client) return null;

    if (this.directReadDevices.has(deviceId)) {
      return this.readDeviceDirectly(deviceId, "out of range");
    }
    try {
      return mapDevice(await this.client.getControllerData(deviceId));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const rescued = await this.readDeviceDirectly(deviceId, reason);
      if (rescued) {
        this.directReadDevices.add(deviceId);
        return rescued;
      }
      throw err;
    }
  }

  private async readDeviceDirectly(deviceId: number, reason: string): Promise<KLDevice | null> {
    if (!/out of range|Invalid array length|Attempt to access memory/i.test(reason)) return null;

    try {
      const version = this.forcedProtocolVersion ?? 5;
      const raw = await fetchControllerData(
        this.host,
        this.port,
        deviceId,
        version,
        this.opts.clientName ?? "HARE"
      );
      const parsed = parseControllerData(raw, deviceId, version);
      // Kept before mapping, because mapping is what loses the fields a mode
      // change has to send back. See `directModes`.
      this.directModes.set(deviceId, parsed.modes);
      const device = mapDevice(parsed);
      console.log(
        `[HARE] Device ${deviceId} (${device.name}) was unreadable by openrgb-sdk and ` +
          `was read by HARE directly instead — ${device.zones.length} zone(s), ${device.colors.length} LED(s).`
      );
      return device;
    } catch (err) {
      console.warn(
        `[HARE] Device ${deviceId} couldn't be read directly either: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return null;
    }
  }

  /** Devices OpenRGB reported that HARE couldn't parse, so the UI can say so instead of pretending they don't exist. */
  getUnreadableDevices(): { id: number; reason: string }[] {
    return this.unreadableDevices;
  }

  /**
   * Picks the mode on a device that lets software drive the LEDs.
   *
   * A firmware mode keeps animating while HARE writes to the same LEDs, so
   * the two composite and the result looks like interference — reported on
   * ASRock Polychrome boards, where every HARE effect came out "funky" on top
   * of whatever the board was already doing. "Off" is not the answer: it
   * stops the firmware *and* the output, so HARE's colours go nowhere either.
   *
   * The mode wanted is the one OpenRGB flags `perLedColor`, usually called
   * Direct or Custom. Off and any other mode that doesn't take per-LED colour
   * are excluded by name as well as by flag, because a device that mislabels
   * its flags would otherwise be driven into darkness.
   */
  private directColorMode(device: KLDevice): KLMode | undefined {
    const usable = device.modes.filter(
      (mode) => mode.supportsDirectColor && !/^\s*off\s*$/i.test(mode.name)
    );
    // "Direct" drives the LEDs live and holds nothing; "Custom" is a stored
    // static pattern on some controllers and is the second choice for that
    // reason. Anything else that takes per-LED colour is better than a
    // running firmware effect.
    return (
      usable.find((mode) => /^\s*direct\s*$/i.test(mode.name)) ??
      usable.find((mode) => /^\s*custom\s*$/i.test(mode.name)) ??
      usable[0]
    );
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
   *
   * The mode is set by its own index rather than through the protocol's
   * SetCustomMode request. SetCustomMode asks the *controller* which of its
   * modes is the custom one, and a controller that doesn't answer — ASRock
   * Polychrome among them — accepts the request and changes nothing. The
   * request appears to succeed, the firmware effect keeps running, and every
   * colour HARE writes lands on top of it.
   */
  private async ensureCustomMode(deviceId: number): Promise<void> {
    if (!this.client || this.customModeSet.has(deviceId)) return;
    this.customModeSet.add(deviceId);

    const device = this.devices.find((d) => d.id === deviceId);
    const direct = device ? this.directColorMode(device) : undefined;

    if (device && direct) {
      if (device.activeModeId === direct.id) return;
      // Written to the log rather than shown: it only matters when someone is
      // working out why a device won't change, and then it matters a lot.
      console.log(
        `[HARE] ${device.name}: switching from ` +
          `"${device.modes.find((m) => m.id === device.activeModeId)?.name ?? "unknown"}" ` +
          `to "${direct.name}" so HARE's colours aren't drawn on top of a firmware effect.`
      );
      try {
        // applyMode, not the library: on a device the library's parser can't
        // read, updateMode re-reads it first and throws, so the switch out of
        // a firmware effect would fail on exactly the devices that need it.
        if (!(await this.applyMode(deviceId, direct.id, {}, false))) return;
        device.activeModeId = direct.id;
        device.activeEffectId = null;
        this.emitDevices();
      } catch (err) {
        console.warn(`[HARE] ${device.name}: couldn't switch to "${direct.name}".`, err);
        this.client.setCustomMode(deviceId);
      }
      return;
    }

    // No mode claims to take per-LED colour. Ask the controller for its own
    // custom mode and hope, which is all that can be done here.
    this.client.setCustomMode(deviceId);
    if (device) {
      console.log(
        `[HARE] ${device.name}: WARNING — none of its modes ` +
          `(${device.modes.map((m) => m.name).join(", ") || "none reported"}) claim to accept ` +
          "per-LED colour, so it may ignore everything HARE sends or paint over it."
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
    // A device with no LEDs has nowhere to put a colour. Writing anyway
    // "succeeded" and did nothing, and the log dutifully recorded
    // "Writing rgb(255, 46, 122) to all 0 LEDs" — which is a sentence that
    // should never have needed to be written.
    if (device.colors.length === 0) {
      console.warn(
        `[HARE] ${device.name} reports no LEDs, so there is nowhere to put a colour. ` +
          "Set the length of its zones on the device's page first."
      );
      return;
    }

    await this.ensureCustomMode(deviceId);
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
      // Through readOneDevice, not the library directly: on a device the
      // library's parser can't read, a direct call throws, and the catch below
      // turned every colour change on a working fan hub into "HARE can't tell
      // whether the write took" — a warning about the device, caused by HARE.
      const fresh = await this.readOneDevice(deviceId);
      const actual = fresh?.colors?.[0];
      if (!actual) {
        console.warn(
          `[HARE] Device ${deviceId} reported no colours back, so HARE can't tell whether the write took.`
        );
        return;
      }
      console.log(
        `[HARE] Read back rgb(${actual.r}, ${actual.g}, ${actual.b}) ` +
          `after asking for rgb(${expected.r}, ${expected.g}, ${expected.b}). ` +
          `Active mode is now "${fresh?.modes?.find((m) => m.id === fresh.activeModeId)?.name ?? "unknown"}".`
      );

      // Exact equality is too strict: some controllers quantise colour, so a
      // near miss is still a device that is listening.
      const close =
        Math.abs(actual.r - expected.r) <= 8 &&
        Math.abs(actual.g - expected.g) <= 8 &&
        Math.abs(actual.b - expected.b) <= 8;

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
              `rgb(${actual.r}, ${actual.g}, ${actual.b}). ` +
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
    const reread = await this.refreshSingleDevice(deviceId);

    // If it couldn't be re-read, take the size on trust rather than leaving
    // the zone reading zero. Leaving it at zero is not neutral: the automatic
    // header sizing looks for zero-length zones, so the device gets resized
    // again on the next pass, and again, for ever — while every colour
    // written to it goes into a zone HARE believes is empty.
    if (!reread) {
      const stale = this.devices.find((d) => d.id === deviceId);
      const staleZone = stale?.zones.find((z) => z.id === zoneId);
      if (stale && staleZone && staleZone.ledCount !== size) {
        const delta = size - staleZone.ledCount;
        staleZone.ledCount = size;
        // Every zone after this one starts further along the strip.
        for (const other of stale.zones) {
          if (other.ledStart > staleZone.ledStart) other.ledStart += delta;
        }
        const total = stale.zones.reduce((sum, z) => sum + z.ledCount, 0);
        while (stale.colors.length < total) stale.colors.push({ r: 0, g: 0, b: 0 });
        stale.colors.length = total;
        console.log(
          `[HARE] Couldn't re-read ${stale.name} after resizing, so HARE is taking ` +
            `"${staleZone.name}" at ${size} LEDs on trust.`
        );
        this.emitDevices();
      }
    }
    // A zone that just gained LEDs needs the device put back into a
    // direct-colour mode before anything will show on it.
    this.customModeSet.delete(deviceId);
    await this.ensureCustomMode(deviceId);
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
    await this.ensureCustomMode(deviceId);
    const zoneColors = new Array(zone.ledCount).fill(toOrgbColor(color));
    this.client.updateZoneLeds(deviceId, zoneId, zoneColors);
    for (let i = zone.ledStart; i < zone.ledStart + zone.ledCount; i++) device.colors[i] = color;
    this.emitDevices();
  }

  async setLedColors(deviceId: number, zoneId: number | null, colors: KLColor[]): Promise<void> {
    if (!this.client) return;
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return;
    await this.ensureCustomMode(deviceId);

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
    if (!(await this.applyMode(deviceId, modeId, {}, false))) return;
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

    if (!(await this.applyMode(deviceId, modeId, patch, persist, modeInput))) return;

    await this.refreshSingleDevice(deviceId);
  }

  /**
   * Changes a device's mode, by whichever route works for that device.
   *
   * openrgb-sdk's own `updateMode` re-reads the entire device before sending,
   * so on a device its parser can't read, *every* mode change throws before
   * anything reaches the hardware. That is what made all eighteen of a fan
   * hub's built-in modes fail on a machine where the hub was otherwise
   * working — the device was fine, the read on the way in was not.
   *
   * For those devices HARE builds and sends the message itself, from the mode
   * it already parsed. Everything else keeps using the library.
   *
   * Returns false if there was nothing to send.
   */
  private async applyMode(
    deviceId: number,
    modeId: number,
    patch: ModeParamsPatch,
    persist: boolean,
    modeInput?: OrgbModeInput
  ): Promise<boolean> {
    if (!this.client) return false;

    if (!this.directReadDevices.has(deviceId)) {
      const input = modeInput ?? modeId;
      if (persist) await this.client.saveMode(deviceId, input);
      else await this.client.updateMode(deviceId, input);
      return true;
    }

    const device = this.devices.find((d) => d.id === deviceId);
    // The controller's own description of the mode, kept verbatim from the
    // last direct read. Not HARE's mapped copy: that one drops `value` and
    // `flags`, which are the two fields the hardware actually acts on.
    const raw = this.directModes.get(deviceId)?.find((m) => m.id === modeId);
    if (!device || !raw) {
      console.warn(
        `[HARE] Can't set mode ${modeId} on device ${deviceId}: HARE doesn't have the controller's ` +
          "own description of it, and sending a made-up one is how the lights get turned off."
      );
      return false;
    }

    // The controller's record, with only what the user changed on top of it.
    //
    // Everything not in the patch is echoed back exactly as it arrived. That
    // is the whole point: `value` is the vendor's private effect number and
    // `flags` says which fields mean anything, so both have to be the
    // controller's own. An earlier version defaulted them to zero and sent
    // brightness 0 with them — every mode on a Lian Li hub then read as
    // "vendor effect 0, brightness 0" and switched the fans off.
    const toSend: ModeToSend = {
      index: raw.id,
      name: raw.name,
      value: raw.value,
      flags: raw.flags,
      speedMin: raw.speedMin,
      speedMax: raw.speedMax,
      brightnessMin: raw.brightnessMin,
      brightnessMax: raw.brightnessMax,
      colorMin: raw.colorMin,
      colorMax: raw.colorMax,
      speed: patch.speed ?? raw.speed,
      brightness: patch.brightness ?? raw.brightness,
      direction: patch.direction ?? raw.direction,
      colorMode: patch.colorMode ?? raw.colorMode,
      colors: modeColorsFor(raw, patch.colors?.map(toOrgbColor), device.colors[0]),
    };

    await sendUpdateMode(
      this.host,
      this.port,
      deviceId,
      this.forcedProtocolVersion ?? 5,
      toSend,
      persist,
      this.opts.clientName ?? "HARE"
    );
    console.log(
      `[HARE] Set ${device.name} to "${raw.name}" directly, without the library ` +
        `(effect ${raw.value}, flags ${raw.flags}, brightness ${toSend.brightness ?? "unset"}).`
    );
    return true;
  }

  /** Advanced Mode: pushes a full per-device LED color array directly, same underlying path as the effects engine but driven by the user's own raw painter instead of a computed animation frame. */
  async setRawLedColors(deviceId: number, colors: KLColor[]): Promise<void> {
    await this.setLedColors(deviceId, null, colors);
  }

  /** Re-fetches one device's controller data and replaces it in the cached list — used after updateModeParams since the mode's own fields (speed/brightness/direction/colorMode/colors) just changed on the hardware side. */
  /**
   * Re-reads one device after something changed it.
   *
   * Never rejects. It used to, and every caller treated it as incidental —
   * `resizeZone` awaited it, the automatic header sizing called that eight
   * times without awaiting, and one unreadable controller turned a single
   * click into eight recovered promise rejections and a failed IPC handler.
   * Failing to re-read is a stale device list, not a failed operation.
   *
   * Returns whether the read succeeded, so a caller that changed something
   * can decide what to do about not being able to confirm it.
   */
  private async refreshSingleDevice(deviceId: number): Promise<boolean> {
    if (!this.client) return false;
    try {
      const mapped = await this.readOneDevice(deviceId);
      if (!mapped) return false;
      const idx = this.devices.findIndex((d) => d.id === deviceId);
      if (idx >= 0) this.devices[idx] = mapped;
      else this.devices.push(mapped);
      this.emitDevices();
      return true;
    } catch (err) {
      console.warn(
        `[HARE] Couldn't re-read device ${deviceId} after changing it: ${
          err instanceof Error ? err.message : String(err)
        }. Keeping what HARE already knew about it.`
      );
      return false;
    }
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
