/**
 * Shared types between the Electron main process (backend/device layer) and
 * the React renderer (UI). Keeping these in one file means the IPC contract
 * can't silently drift between the two sides.
 */

export interface KLColor {
  r: number;
  g: number;
  b: number;
}

export interface KLZone {
  id: number;
  name: string;
  ledStart: number;
  ledCount: number;
  /**
   * Some zones are 2D matrices (e.g. keyboards); OpenRGB reports this,
   * including which grid cells have no physical key at all (a non-
   * rectangular layout, e.g. a keyboard missing its numpad column).
   * `keys[row][col]` is that cell's LED index within this zone (add
   * zone.ledStart for the absolute index into KLDevice.colors), or
   * undefined where there's no key.
   */
  matrix?: { rows: number; cols: number; keys: (number | undefined)[][] } | null;
  /** Raw OpenRGB zone type: 0 = single LED, 1 = linear strip, 2 = matrix. Advanced Mode's diagnostic view shows this verbatim. */
  type: number;
  /** The range the board will accept, when this zone can be resized. */
  ledsMin: number;
  ledsMax: number;
  /**
   * An ARGB header, whose length HARE has to be *told*.
   *
   * A motherboard cannot count the LEDs on a strip plugged into a header, so
   * these zones report zero and stay there until someone says how long the
   * strip is. A zero-LED zone accepts every colour and changes nothing —
   * indistinguishable from broken software, and was: on a real ASUS board
   * HARE wrote to the two onboard LEDs, confirmed the write, and left the
   * header dark because as far as OpenRGB was concerned it had nothing in it.
   */
  resizable: boolean;
}

export interface KLLed {
  id: number;
  name: string;
}

export interface KLMode {
  id: number;
  name: string;
  /** Whether this native device mode accepts arbitrary per-LED colors. */
  supportsDirectColor: boolean;
  minSpeed?: number;
  maxSpeed?: number;
  speed?: number;
  // --- Advanced Mode: the rest of what OpenRGB actually reports per mode,
  // never exposed before this. Nothing here is guessed — every field below
  // is read straight off the wire (see openrgb-sdk's device.js) and
  // gated in the UI by flagList, the device's own declaration of what it
  // actually supports for this mode.
  /** Raw OpenRGB capability flags, e.g. "speed", "directionLR", "brightness", "perLedColor", "modeSpecificColor", "randomColor", "manualSave", "automaticSave", "direction". Drives which Advanced Mode controls are shown for this mode — never assume a capability the device didn't report. */
  flagList: string[];
  /** Raw direction value (0=left,1=right,2=up,3=down,4=horizontal,5=vertical) — only meaningful when flagList includes "direction". See MODE_DIRECTION_LABELS. */
  direction: number;
  /** Raw color-mode value (0=none,1=per-LED,2=mode-specific,3=random). See MODE_COLOR_MODE_LABELS. */
  colorMode: number;
  /** This mode's own color slots — only meaningful when colorMode is mode-specific (2) and colorMax > 0. */
  colors: KLColor[];
  colorMin: number;
  colorMax: number;
  brightnessMin?: number;
  brightnessMax?: number;
  brightness?: number;
}

/** Human-readable labels for KLMode.direction — see openrgb-sdk's exported `direction` map, which this mirrors. */
export const MODE_DIRECTION_LABELS: Record<number, string> = {
  0: "Left",
  1: "Right",
  2: "Up",
  3: "Down",
  4: "Horizontal",
  5: "Vertical",
};

/** Human-readable labels for KLMode.colorMode. */
export const MODE_COLOR_MODE_LABELS: Record<number, string> = {
  0: "None",
  1: "Per-LED",
  2: "Mode-specific",
  3: "Random",
};

/** A partial update to a native mode's advanced parameters — every field optional, missing ones keep their current device value (mirrors openrgb-sdk's ModeInput). */
export interface ModeParamsPatch {
  speed?: number;
  brightness?: number;
  direction?: number;
  colorMode?: number;
  colors?: KLColor[];
}

// Mirrors OpenRGB's own DeviceType enum 1:1 (see openrgbBackend.ts's
// DEVICE_TYPE_MAP) so every type here is something OpenRGB can actually
// report — no aspirational categories that can never come from real
// hardware. "monitor" is the one exception: OpenRGB itself has no monitor
// device type today, but it's kept here, unused, as a landing spot for a
// future vendor SDK (e.g. Aura Sync monitor backlighting) per ROADMAP.md.
export type KLDeviceType =
  | "motherboard"
  | "keyboard"
  | "mouse"
  | "mousemat"
  | "gpu"
  | "cooler"
  | "ram"
  | "led-strip"
  | "gamepad"
  | "headset"
  | "speaker"
  | "storage"
  | "virtual"
  | "monitor"
  | "unknown";

export interface KLDevice {
  id: number;
  name: string;
  vendor: string;
  type: KLDeviceType;
  zones: KLZone[];
  leds: KLLed[];
  modes: KLMode[];
  activeModeId: number;
  colors: KLColor[];
  /** HARE-side effect currently driving this device, if any. */
  activeEffectId: EffectId | null;
  /**
   * True when this device accepted a colour and then didn't change.
   *
   * The OpenRGB protocol never acknowledges a write, so "sent" and "worked"
   * are different things — most often for a motherboard enumerated over SMBus
   * while OpenRGB is running without the permission it needs. Saying so is
   * the difference between a user thinking HARE is broken and knowing what to
   * click.
   */
  unresponsive?: boolean;
  /**
   * The full look currently running on this device — colors, speed, layers
   * and all — not just which effect it is.
   *
   * `colors` above only stays accurate for a solid color: while an effect is
   * running, frames go straight to the hardware and are never written back
   * here. Anything that wants to draw what a device actually looks like right
   * now (the second-screen dashboard) needs the parameters, so it can render
   * the same frames locally with the same math.
   */
  activeAssignment?: Omit<EffectAssignment, "deviceId"> | null;
}

export type EffectId =
  | "static"
  | "breathing"
  | "rainbow-wave"
  | "spectrum-cycle"
  | "reactive"
  | "color-wave"
  | "color-shift"
  | "color-pulse"
  | "gradient"
  | "marquee"
  | "comet"
  | "theater-chase"
  | "strobe"
  | "fire"
  | "twinkle"
  | "rain"
  | "ambient-sync"
  | "music-reactive"
  | "thermal";

export interface EffectDefinition {
  id: EffectId;
  name: string;
  description: string;
  /** Parameters the UI should expose for this effect. */
  params: {
    usesColor: boolean;
    usesSecondaryColor: boolean;
    usesSpeed: boolean;
    usesBrightness: boolean;
  };
  comingSoon?: boolean;
}

// HARE has exactly one device source: whatever OpenRGB actually reports.
// There used to be a "demo" mode that silently substituted fake devices
// when nothing real was found -- removed on purpose (see BackendManager):
// zero real devices is a real, honest state, not something to paper over.
// "connected" covers both "found N real devices" and "reached OpenRGB but
// it currently sees 0 controllers" -- the UI tells those apart by looking
// at `devices.length`, same as it already did.
export type BackendStatus =
  | "starting"
  | "scanning"
  | "connected"
  | "disconnected"
  | "error";

export interface BackendState {
  status: BackendStatus;
  message?: string;
  devices: KLDevice[];
  /**
   * Why an effect that needs something from outside HARE isn't getting it,
   * keyed by effect id.
   *
   * Reactive needs a global keyboard hook; Ambient and Music Reactive need
   * screen and audio capture. Each of those can be refused by Windows or by
   * security software, and each used to fail into a silent nothing: the
   * effect stayed selected, the lights stopped moving, and the only record
   * was a line in a console nobody was looking at.
   */
  effectProblems?: Partial<Record<EffectId, string>>;
}

/**
 * Whether PawnIO — the signed kernel driver OpenRGB now uses for SMBus — is
 * present. See backend/pawnIo.ts for why HARE cares.
 */
export interface PawnIoStatus {
  installed: boolean;
  /** True when the driver is not just present but currently running. */
  running: boolean;
  /** One line for the UI, in the user's terms. */
  detail: string;
  /** Whether this build carries a verified installer, or the user must install it themselves. */
  canInstall?: boolean;
}

/** "system" follows Windows' own light/dark setting; "light"/"dark" pin it regardless of what Windows is set to. */
export type ThemePreference = "system" | "light" | "dark";

/**
 * The persistent user-facing settings under Settings. Screen Sync and Music
 * Reactive used to live here as global on/off toggles backed by an exclusive
 * "override mode" in BackendManager; they're ordinary per-device effects now
 * (see effectsEngine.ts's "Live signals" section), so nothing about them is
 * persisted here any more. Settings files written by older builds still load
 * fine — AppSettingsStore merges onto DEFAULTS, so the two dropped keys are
 * simply ignored.
 */
export interface AppSettings {
  launchOnStartup: boolean;
  /**
   * When HARE is started by Windows at logon, open straight to the tray
   * rather than putting a window in front of someone who is trying to log in.
   *
   * Only applies to that case. Launching HARE yourself always shows it — an
   * app that opens to nothing when you double-click it is broken, whatever
   * the setting says.
   */
  startMinimized: boolean;
  themePreference: ThemePreference;
  dashboard: DashboardSettings;
  /**
   * Whether the welcome screen has been through once. Persisted rather than
   * held in memory, or HARE would introduce itself on every single launch —
   * including every time it starts with Windows.
   */
  hasCompletedOnboarding: boolean;
  /**
   * Whether HARE has already asked for the one Windows permission it needs.
   *
   * Asked once, on first run, and never again: the answer is remembered
   * whichever way it went, and Settings → Hardware is where someone changes
   * their mind. Nagging on every launch is what makes people distrust an app
   * that asks for administrator rights.
   */
  hasAskedForHardwareAccess: boolean;
  /**
   * Write a diagnostic log to disk. Off by default, deleted after three days,
   * and never sent anywhere — see backend/logger.ts.
   */
  diagnosticLogging: boolean;
  /**
   * Cooler and case screens showing a live temperature, keyed by
   * "vendorId:productId" so the setting follows the screen rather than the
   * order USB happened to enumerate it in.
   */
  screenGauges: Record<string, ScreenGaugeSettings>;
}

/** One screen's live readout. */
export interface ScreenGaugeSettings {
  enabled: boolean;
  /**
   * Which sensor to show, or null for whatever is hottest right now — the
   * sensible default, and the one that keeps working when the sensor someone
   * chose stops reporting.
   */
  sensorId: string | null;
}

/** One monitor, as something the user can pick from a list. */
export interface KLDisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

export type DashboardWidgetId =
  | "clock"
  | "lighting"
  | "quick-controls"
  | "looks"
  | "ambient"
  | "sensors"
  | "system";

export const DASHBOARD_WIDGETS: {
  id: DashboardWidgetId;
  name: string;
  description: string;
}[] = [
  { id: "clock", name: "Clock", description: "Time and date, readable across the room." },
  { id: "lighting", name: "Lighting", description: "What each device is doing right now." },
  { id: "quick-controls", name: "Quick Controls", description: "One-tap effects, colors and lights-out." },
  { id: "looks", name: "Saved Looks", description: "Apply anything from your Gallery to everything at once." },
  { id: "ambient", name: "Ambient Glow", description: "A slow wash of your current colors." },
  // Named for what each shows. These read "System" and "Status", which is
  // two near-identical words for two different panels — the sensor one was
  // the "System" widget and the status one was "Status".
  { id: "sensors", name: "Sensors", description: "Temperatures, load and fan speeds." },
  { id: "system", name: "HARE Status", description: "Devices connected and what HARE is doing." },
];

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetId[] = [
  "clock",
  "lighting",
  "sensors",
  "quick-controls",
  "looks",
  "system",
];

/**
 * The second-screen dashboard: a touch-friendly panel HARE puts fullscreen on
 * a monitor you pick.
 *
 * `displayId` is null until one is chosen, which means "the first screen
 * that isn't your main one". Windows hands out display ids that change when
 * monitors are unplugged, so a saved id that no longer exists falls back to
 * that same rule rather than failing.
 */
export interface DashboardSettings {
  enabled: boolean;
  displayId: number | null;
  /** In order, with each widget's size. Order is position: the grid fills left to right, top to bottom. */
  widgets: DashboardWidgetPlacement[];
  /** 24-hour clock instead of AM/PM. */
  clock24h: boolean;
  /**
   * Stops the layout being changed from the second screen itself.
   *
   * The second screen is a touch panel, often somewhere anyone can reach —
   * a case window, a desk stand. Editing there is the point of it, right up
   * until someone leans on it. Locking is set from HARE's own window, so the
   * screen can never unlock itself.
   */
  locked: boolean;
  /** What's behind the widgets. */
  background: DashboardBackground;
  /**
   * Monitors the user has hidden from the second-screen picker.
   *
   * A PC can report displays nobody wants to put a dashboard on — a TV that's
   * usually off, a capture device, a virtual display from remote-desktop
   * software. Hiding them is remembered, and they can always be brought back.
   */
  hiddenDisplayIds: number[];
}

/**
 * Where a widget sits and how big it is.
 *
 * Deliberately a span on a fixed grid rather than free x/y pixels: a second
 * screen can be a 4K monitor or a 7-inch case panel, and absolute positions
 * that looked right on one would be unusable on the other. Spans re-flow.
 */
export interface DashboardWidgetPlacement {
  id: DashboardWidgetId;
  /** Columns wide, 1 to 4 — the full width of the grid. */
  w: WidgetSpanW;
  /** Rows tall, 1 to 3. */
  h: WidgetSpanH;
  /**
   * This widget's own accent, as `#rrggbb`, or null to use HARE's.
   *
   * It tints the card's edge and its heading rather than flooding the whole
   * card, so a wall of coloured panels stays readable — the point is telling
   * one apart from another at a glance across the room.
   */
  accent?: string | null;
}

export type WidgetSpanW = 1 | 2 | 3 | 4;
export type WidgetSpanH = 1 | 2 | 3;

/**
 * What sits behind the widgets on the second screen.
 *
 * `app` is HARE's own dark wash. `color` is a flat colour. `image` is a
 * picture, stored as a data URL because it has to reach a second window and
 * survive a restart, and a path would have to survive both a sandbox and a
 * file:// origin. `none` makes the window itself transparent — the desktop
 * shows through, and only the cards are drawn.
 */
export type DashboardBackground =
  | { kind: "app" }
  | { kind: "color"; color: string }
  | { kind: "image"; image: string; fit: "cover" | "contain"; dim: number }
  | { kind: "none" };

export const DEFAULT_DASHBOARD_BACKGROUND: DashboardBackground = { kind: "app" };

/** The grid the second screen is laid out on, and the preview mirrors. */
export const DASHBOARD_COLUMNS = 4;

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  enabled: false,
  displayId: null,
  hiddenDisplayIds: [],
  widgets: DEFAULT_DASHBOARD_WIDGETS.map((id) => ({
    id,
    // The clock and the lighting list earn more room by default; everything
    // else reads fine in one cell.
    w: (id === "clock" || id === "lighting" ? 2 : 1) as WidgetSpanW,
    h: (id === "lighting" ? 2 : 1) as WidgetSpanH,
    accent: null,
  })),
  clock24h: false,
  locked: false,
  background: { ...DEFAULT_DASHBOARD_BACKGROUND },
};

/**
 * What the renderer actually needs to paint the right theme: the user's
 * preference (for the Settings UI to show which option is selected) plus
 * the *effective* light/dark result of applying it — resolving "system"
 * against Windows' current setting is main.ts's job (via Electron's
 * nativeTheme), not the renderer's, so this is always already resolved.
 */
export interface ThemeState {
  preference: ThemePreference;
  effective: "light" | "dark";
}

/**
 * How a layer combines with everything already stacked beneath it.
 *
 * These are the standard image-compositing operators, applied per color
 * channel — the same ones an image editor uses, which is what makes a stack
 * of lighting layers behave the way people already expect.
 */
export type BlendMode = "normal" | "add" | "screen" | "multiply" | "lighten";

export const BLEND_MODES: { id: BlendMode; name: string; description: string }[] = [
  { id: "normal", name: "Normal", description: "Covers the layers below it." },
  { id: "add", name: "Add", description: "Adds light. Bright and punchy." },
  { id: "screen", name: "Screen", description: "Blends light in softly, never darkens." },
  { id: "multiply", name: "Multiply", description: "Darkens. Good for masking the layers below." },
  { id: "lighten", name: "Lighten", description: "Keeps whichever layer is brighter." },
];

/**
 * One effect in a stack. `opacity` and `blendMode` decide how it mixes with
 * the layers under it; `window` optionally limits it to part of a repeating
 * sequence (see LayeredLook.loopSeconds), which is what turns a static stack
 * into a timed loop.
 */
export interface EffectLayer {
  /** Stable id so the UI can reorder/edit layers without them jumping around. */
  id: string;
  effectId: EffectId;
  color: KLColor;
  secondaryColor?: KLColor;
  speed: number; // 1-100
  brightness: number; // 1-100
  /** 0-100. How strongly this layer shows through whatever is beneath it. */
  opacity: number;
  blendMode: BlendMode;
  /** A disabled layer stays in the stack (so it's easy to toggle while experimenting) but contributes nothing. */
  enabled: boolean;
  /**
   * Optional slice of the loop this layer plays during, as percentages of
   * `LayeredLook.loopSeconds`. Ignored entirely when the look has no loop.
   * `fromPct` may be greater than `toPct`, which simply means the window
   * wraps past the end of the loop. `fadePct` crossfades the layer in and
   * out at the window edges so sequences don't visibly snap.
   */
  window?: { fromPct: number; toPct: number; fadePct: number };
}

/**
 * A stack of effect layers composited into one frame — HARE's answer to
 * "build a look out of several effects at once", plus an optional repeating
 * timeline when layers are given windows.
 *
 * Layers are ordered bottom-first: `layers[0]` is painted first and
 * everything after it blends on top, matching how layer panels are drawn in
 * image editors (where the topmost row is the last one composited).
 */
export interface LayeredLook {
  layers: EffectLayer[];
  /** Length of one pass through the sequence, in seconds. 0 or undefined = no sequencing; every enabled layer is always on. */
  loopSeconds?: number;
}

/**
 * How a device was last set, saved so lighting survives a restart.
 *
 * Four shapes because there are four genuinely different things HARE can do
 * to a device, and restoring the wrong one would be worse than restoring
 * nothing: a flat colour, one of HARE's own effects (including a layer
 * stack), a mode stored in the device's own firmware, or an exact per-LED
 * arrangement someone painted by hand.
 *
 * The painted one is stored as the colours themselves, because there is
 * nothing smaller to derive it from: it is whatever was clicked, LED by LED,
 * and losing it means losing work that can only be redone by hand. It was
 * also the one thing HARE could do that didn't survive a restart.
 */
export type DevicePreference =
  | { kind: "color"; color: KLColor }
  | { kind: "mode"; modeId: number }
  | { kind: "effect"; assignment: Omit<EffectAssignment, "deviceId"> }
  | { kind: "raw"; colors: KLColor[] };

/**
 * How many LEDs the user has told HARE are on each resizable zone, keyed by
 * zone *name* rather than id.
 *
 * Stored separately from DevicePreference because it is a different kind of
 * fact: a strip length is a property of the physical build, not of what it
 * is currently showing, and a device can have both. It has to be re-applied
 * on every connect — OpenRGB does not remember it for us — which is why it
 * is persisted at all.
 */
export type ZoneSizes = Record<string, number>;

export interface EffectAssignment {
  deviceId: number;
  zoneId: number | null; // null = whole device
  effectId: EffectId;
  color: KLColor;
  /**
   * Treat the colour as "every colour, slowly cycling" rather than a fixed
   * one.
   *
   * This is a property of the *colour choice*, not a separate effect, which
   * is what makes it work everywhere at once: Breathing becomes a rainbow
   * breath, Comet becomes a rainbow comet, and so on, with no new effects to
   * write and nothing to keep in sync. Effects that don't use a colour at all
   * (Rainbow Wave, Color Cycle) ignore it.
   */
  rainbow?: boolean;
  secondaryColor?: KLColor;
  speed: number; // 1-100
  brightness: number; // 1-100
  /**
   * When present and non-empty, this assignment is a layered look and the
   * single-effect fields above are ignored for rendering (they're still
   * carried so anything reading `effectId` — the device's activeEffectId
   * badge, the Gallery, older saved looks — keeps working unchanged).
   */
  layers?: EffectLayer[];
  /** Only meaningful alongside `layers`. See LayeredLook.loopSeconds. */
  loopSeconds?: number;
}

/**
 * A user-saved lighting look — captures however a device was actually lit
 * (a solid color, or a running effect + its params) at the moment it was
 * saved, deliberately in the same shape as EffectAssignment minus the
 * device/zone ids, so it's device-agnostic: any look can be applied to any
 * device later, not just the one it was captured from. `sourceDeviceName`/
 * `sourceDeviceType` are kept purely as display context ("captured from
 * your K95 RGB PLATINUM") — never required for applying it elsewhere.
 */
export interface SavedLook {
  id: string;
  name: string;
  createdAt: string;
  sourceDeviceName: string;
  sourceDeviceType: KLDeviceType;
  effectId: EffectId;
  color: KLColor;
  /** See EffectAssignment.rainbow. */
  rainbow?: boolean;
  secondaryColor?: KLColor;
  speed: number;
  brightness: number;
  /** Present when the look is a layer stack rather than a single effect — see EffectAssignment.layers. */
  layers?: EffectLayer[];
  loopSeconds?: number;
  /**
   * An exact per-LED painting, when the look was captured from the LED
   * Painter rather than from an effect.
   *
   * Optional, so every look saved before this existed is still valid and the
   * guard below doesn't have to change. Applied to a device with a different
   * number of LEDs, the painting repeats to fill it — a keyboard painting on
   * a three-LED header has to become something rather than nothing.
   */
  ledColors?: KLColor[];
}

/** What SAVE_LOOK needs from the renderer — everything else (id, createdAt) is assigned by the main process. */
export type SavedLookInput = Omit<SavedLook, "id" | "createdAt">;

/**
 * Runtime shape guard for a SavedLook read from disk or an imported file —
 * never trust external JSON blindly. Lives here (plain types.ts, no
 * Node/Electron imports) rather than in galleryStore.ts specifically so
 * both the main process (galleryStore.ts) and the plain-browser dev
 * fallback (browserBackend.ts, which can't import anything that pulls in
 * the "electron" package) can use the exact same check.
 */
export function isSavedLook(value: unknown): value is SavedLook {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.sourceDeviceName === "string" &&
    typeof v.sourceDeviceType === "string" &&
    typeof v.effectId === "string" &&
    typeof v.speed === "number" &&
    typeof v.brightness === "number" &&
    isKLColor(v.color)
  );
}

function isKLColor(value: unknown): value is KLColor {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number";
}

/** The result of an export/import action that goes through a native file dialog — surfaces cancellation and real failures distinctly, since "the user clicked Cancel" isn't an error. */
export type FileDialogResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; reason: string };

/**
 * Everything HARE persists for one user, bundled into a single portable
 * file for Settings → Backup & Restore. Versioned from the start so a
 * future format change has somewhere to branch from without breaking older
 * backup files.
 */
export interface HareBackup {
  version: 1;
  exportedAt: string;
  appSettings: AppSettings;
  gallery: SavedLook[];
}

/**
 * Third-party vendor RGB software (Corsair iCUE, Razer Chroma, etc.) —
 * distinct from OpenRGB, which is HARE's primary backend. Every vendor
 * here has real, currently-accurate `detected`/`controllable` values —
 * HARE never claims a vendor is controllable until that control path is
 * actually implemented and wired up, per the "don't promise what may never
 * come" rule. See electron/backend/vendors/ for the implementation.
 */
/**
 * Third-party RGB *software* HARE can drive directly through that vendor's
 * own SDK.
 *
 * This is a narrow list on purpose, and it is not the list of hardware HARE
 * supports — almost all RGB hardware (including every NZXT, Lian Li and MSI
 * device OpenRGB knows about) is controlled directly over USB/SMBus through
 * OpenRGB, with no vendor software installed or running at all. A vendor
 * only earns an entry here when HARE has a real, implemented control path
 * for its software, for the cases OpenRGB can't reach on its own.
 *
 * Vendors whose software HARE could merely *detect* but not control used to
 * be listed too; they were removed, because a row that only ever says
 * "detected" tells the user nothing they can act on.
 */
export type VendorId =
  | "razer-chroma"
  | "logitech-ghub"
  | "corsair-icue"
  | "asus-aura"
  | "msi-mystic-light"
  | "steelseries-gamesense";

export interface VendorStatus {
  id: VendorId;
  /** Display name of the vendor's own software, e.g. "Razer Synapse / Chroma". */
  name: string;
  /** Whether the vendor's software was found running right now (a process-name check — see vendorDetection.ts). */
  detected: boolean;
  /** Whether HARE has an actual, implemented control path for this vendor at all (independent of whether it's connected right now). */
  controllable: boolean;
  /** Whether HARE currently has a live control session open with this vendor's software. Always false when !controllable. */
  connected: boolean;
  /** Always-accurate, human-readable explanation of the state above — this is what the Settings panel shows verbatim. */
  message: string;
  /** For a vendor HARE can't drive: the specific reason, shown under the message. */
  notControllableReason?: string;
  /**
   * True when HARE has a control path for this vendor that has never been run
   * against the real software — see VendorDefinition.verified.
   *
   * Surfaced as its own field rather than buried in `message`, because the
   * badge beside it read a confident green "Live control" for every vendor,
   * verified or not, and someone glancing at that list had no way to tell an
   * integration that is known to work from one that is a best guess.
   */
  unverified: boolean;
  lastCheckedAt: string | null;
}

/**
 * An AIO pump/case LCD screen HARE has found over raw USB HID (see
 * electron/backend/displays/krakenLcd.ts). This is a fundamentally
 * different device class from everything else in HARE: OpenRGB only
 * handles LED lighting, never these — so detection is HARE's own, direct
 * USB VID/PID match, independent of the OpenRGB backend entirely.
 *
 * HARE drives these: a still image or a GIF is uploaded over a separate USB
 * bulk endpoint (plain HID carries only the command channel), and brightness,
 * orientation and "put it back to stock" go over HID. `capabilities` says
 * which of those a given screen actually supports — a detected panel whose
 * transport HARE doesn't speak reports all of them false rather than
 * pretending.
 */
/** What a given screen can actually be told to do. Reported per model rather than assumed, so the UI only ever offers controls the device really has. */
export interface KLDisplayCapabilities {
  /** Still images can be uploaded. */
  staticImage: boolean;
  /** Animated GIFs can be uploaded — the screen decodes them itself. */
  gif: boolean;
  /** Video is listed for completeness: no supported screen accepts a video stream, so this is always false. Play a GIF instead. */
  video: boolean;
  brightness: boolean;
  orientation: boolean;
  /** Can be returned to its stock liquid-temperature display. */
  liquidMode: boolean;
}

/**
 * Full-hardware-access state.
 *
 * Motherboard and RAM lighting runs over SMBus, which needs administrator
 * rights. HARE itself runs unelevated; this reports whether the one opt-in
 * elevated helper is in place. See electron/backend/elevationHelper.ts.
 */
export interface ElevationStatus {
  /** The logon task exists, so OpenRGB starts with SMBus access. */
  enabled: boolean;
  /** False off Windows, where none of this applies. */
  supported: boolean;
}

/** A screen's live settings, read back from the device itself. */
export interface LcdScreenState {
  brightness: number;
  /** 0, 90, 180 or 270 degrees. */
  orientation: number;
}

export interface KLDisplayDevice {
  vendorId: number;
  productId: number;
  /** Model name straight from the matching VID/PID table entry, e.g. "NZXT Kraken Z (Z53, Z63 or Z73)". */
  name: string;
  resolutionWidth: number;
  resolutionHeight: number;
  capabilities: KLDisplayCapabilities;
  /**
   * False when HARE recognises the screen but has no write path for it — the
   * Thermalright panels, whose image transports (SCSI passthrough and two
   * vendor bulk protocols) aren't implemented. The UI says so rather than
   * offering buttons that would do nothing.
   */
  controllable: boolean;
}

export type ImportBackupResult =
  | { ok: true; appSettings: AppSettings; gallery: SavedLook[] }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; reason: string };

/**
 * Status of HARE's OpenRGB "device database" — i.e. which OpenRGB build is
 * currently bundled, and whether a newer one (with broader device support)
 * is available. See electron/backend/deviceDatabase.ts.
 */
export interface DeviceDbStatus {
  /** Whether an OpenRGB build is present at all (false only if build.bat/build.ps1 hasn't run yet). */
  installed: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  checking: boolean;
  updating: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Auto-download/apply is Windows-only, matching the rest of HARE's v0.1 scope. */
  supportsAutoUpdate: boolean;
}

/** IPC channel names, kept in one place so main/preload/renderer agree. */
/**
 * Another RGB application that's running and contending for the same bus.
 *
 * Motherboard, RAM and GPU lighting runs over SMBus/I2C, which tolerates one
 * program at a time — a second one can stop devices being detected at all,
 * not merely make them flicker. This is the most likely explanation for
 * "HARE sees nothing but my board definitely has RGB", and it's invisible
 * unless something goes looking.
 */
export interface DetectedConflict {
  id: string;
  name: string;
  /** What that app takes over, in the user's terms. */
  affects: string;
}

/**
 * An optional vendor module's state.
 *
 * `overlapsOpenRgb` is the field the UI must not bury: for most people the
 * devices a module reaches are already driven directly by OpenRGB, and
 * running both against the same controller makes lighting worse, not better.
 * See electron/backend/modules/moduleRegistry.ts.
 */
export interface ModuleStatus {
  id: string;
  name: string;
  summary: string;
  /** The honest reason to install it anyway, given the overlap. */
  worthItWhen: string;
  overlapsOpenRgb: boolean;
  /** Vendor software that must also be installed and running, if any. */
  requiresVendorApp: string | null;
  installed: boolean;
  /** False when no verified download shipped with this build — it then can't be installed at all. */
  available: boolean;
  /** Ships with HARE; nothing to install or remove. */
  builtIn: boolean;
  downloadBytes: number | null;
  installedBytes: number | null;
}

export const IPC = {
  GET_STATE: "hare:get-state",
  STATE_CHANGED: "hare:state-changed",
  RESCAN: "hare:rescan",
  SET_DEVICE_COLOR: "hare:set-device-color",
  SET_ZONE_COLOR: "hare:set-zone-color",
  SET_NATIVE_MODE: "hare:set-native-mode",
  APPLY_EFFECT: "hare:apply-effect",
  CLEAR_EFFECT: "hare:clear-effect",
  SYNC_ALL: "hare:sync-all",
  GET_EFFECTS: "hare:get-effects",
  GET_DEVICE_DB_STATUS: "hare:get-device-db-status",
  DEVICE_DB_CHANGED: "hare:device-db-changed",
  DISCOVER_DEVICES: "hare:discover-devices",
  GET_APP_SETTINGS: "hare:get-app-settings",
  SET_APP_SETTINGS: "hare:set-app-settings",
  APP_SETTINGS_CHANGED: "hare:app-settings-changed",
  /** Effective light/dark theme (preference + Windows' current setting, already resolved) — see ThemeState. Changes on both a preference change and Windows switching theme live while preference is "system". */
  GET_THEME_STATE: "hare:get-theme-state",
  THEME_CHANGED: "hare:theme-changed",
  /** Renderer asks main for a desktopCapturer source id it can hand to getUserMedia for system-audio loopback (Music Reactive — see src/lib/musicReactive.ts). */
  GET_AUDIO_LOOPBACK_SOURCE: "hare:get-audio-loopback-source",
  /** Renderer -> main, fire-and-forget, up to ~30x/sec: the current audio level (0-1) from Music Reactive's analyser. */
  REPORT_AUDIO_LEVEL: "hare:report-audio-level",
  /** Same path, with the detail a single level can't carry: per-band levels and whether this sample is a beat. */
  REPORT_AUDIO_SPECTRUM: "hare:report-audio-spectrum",
  /** The renderer telling the main process that an effect it drives can't get what it needs. */
  REPORT_EFFECT_PROBLEM: "hare:report-effect-problem",

  // Gallery — user-saved lighting looks (see SavedLook), sharable as files.
  GET_GALLERY: "hare:get-gallery",
  GALLERY_CHANGED: "hare:gallery-changed",
  SAVE_LOOK: "hare:save-look",
  DELETE_LOOK: "hare:delete-look",
  APPLY_LOOK: "hare:apply-look",
  /** Exports one look to a file the user picks via a native save dialog — this is "share with a friend": hand them the file, they Import Look it. */
  EXPORT_LOOK: "hare:export-look",
  /** Imports a look file (either one HARE exported, or one a friend shared) via a native open dialog. */
  IMPORT_LOOK: "hare:import-look",

  // Settings → Backup & Restore — the whole user profile (settings + gallery) as one portable file.
  EXPORT_BACKUP: "hare:export-backup",
  IMPORT_BACKUP: "hare:import-backup",

  // Vendor software (Corsair/Razer/ASUS/MSI/Logitech) — separate from OpenRGB. See vendors/.
  GET_VENDOR_STATUS: "hare:get-vendor-status",
  VENDOR_STATUS_CHANGED: "hare:vendor-status-changed",
  RECHECK_VENDORS: "hare:recheck-vendors",
  SYNC_VENDOR_COLOR: "hare:sync-vendor-color",

  // Advanced Mode — full OpenRGB mode-parameter editing and raw per-LED
  // painting, beyond the simplified color/effect/mode-picker UI above.
  /** Updates a native mode's speed/brightness/direction/colorMode/colors. `persist` (3rd arg) chooses live (updateMode) vs. saved-to-device (saveMode). */
  UPDATE_MODE_PARAMS: "hare:update-mode-params",
  /** Pushes a full per-device LED color array directly, bypassing HARE's effect system — the raw painter's write path. */
  SET_RAW_LED_COLORS: "hare:set-raw-led-colors",

  /** Other RGB apps currently fighting HARE for the same hardware bus. */
  GET_CONFLICTS: "hare:get-conflicts",

  /** Optional vendor modules: what exists, what's installed, what it costs. */
  GET_MODULE_STATUS: "hare:get-module-status",
  INSTALL_MODULE: "hare:install-module",
  UNINSTALL_MODULE: "hare:uninstall-module",

  /** Whether the elevated OpenRGB logon task is installed, and whether it could be. */
  GET_ELEVATION_STATUS: "hare:get-elevation-status",
  /** Installs or removes that task. Raises exactly one UAC prompt. */
  SET_ELEVATION_ENABLED: "hare:set-elevation-enabled",

  // AIO/case LCD screens.
  GET_DISPLAY_DEVICES: "hare:get-display-devices",
  /** Reads a screen's live brightness/orientation — also the cheapest confirmation it's really responding. */
  GET_DISPLAY_STATE: "hare:get-display-state",
  /** Uploads a still image as raw RGBA, already resized to the screen's native resolution by the renderer. */
  SET_DISPLAY_IMAGE: "hare:set-display-image",
  /** Uploads an animated GIF's raw file bytes. */
  SET_DISPLAY_GIF: "hare:set-display-gif",
  SET_DISPLAY_BRIGHTNESS: "hare:set-display-brightness",
  SET_DISPLAY_ORIENTATION: "hare:set-display-orientation",
  /** Returns the screen to its stock liquid-temperature display. */
  SET_DISPLAY_LIQUID: "hare:set-display-liquid",

  // The second-screen dashboard.
  /** Every monitor Windows currently reports, so the user can pick one. */
  GET_MONITORS: "hare:get-monitors",
  /** Opens the dashboard fullscreen on a monitor, or moves it if already open. */
  OPEN_DASHBOARD: "hare:open-dashboard",
  CLOSE_DASHBOARD: "hare:close-dashboard",

  // System sensors — temperatures, load, fans. See backend/sensors/.
  /** The latest snapshot, plus which sources are live and what each one needs. */
  GET_SENSORS: "hare:get-sensors",
  SENSORS_CHANGED: "hare:sensors-changed",
  /** Starts or stops polling. Nothing is read while nothing is watching. */
  WATCH_SENSORS: "hare:watch-sensors",
  /** Re-checks every source — for after the user installs one of the things a source needs. */
  REFRESH_SENSORS: "hare:refresh-sensors",
  /** Whether the driver that unlocks motherboard/RAM lighting and CPU temperature is installed. */
  GET_PAWNIO_STATUS: "hare:get-pawnio-status",
  /** Downloads the pinned, verified PawnIO installer and runs it elevated and visibly. */
  INSTALL_PAWNIO: "hare:install-pawnio",

  /** Picks a widget file someone else made. Nothing is loaded yet — see the roadmap's sandbox work. */
  IMPORT_WIDGET: "hare:import-widget",

  /** Opens the folder diagnostic logs are written to. */
  OPEN_LOG_FOLDER: "hare:open-log-folder",
  /** Where that folder is, so the UI can show the path rather than leaving someone hunting. */
  GET_LOG_FOLDER: "hare:get-log-folder",
  /** Opens the bundled OpenRGB's own window — the fastest way to tell a HARE problem from a hardware one. */
  OPEN_OPENRGB: "hare:open-openrgb",
  /** Stops the OpenRGB server and starts it again, for when it stops responding. */
  RESTART_OPENRGB: "hare:restart-openrgb",
  /** Tells the board how many LEDs are on an ARGB header, so it has something to light. */
  RESIZE_ZONE: "hare:resize-zone",
  /** The few facts about this PC that make a bug report answerable, gathered only when someone asks to include them. */
  GET_SYSTEM_REPORT: "hare:get-system-report",
  /** Opens the user's email program with a bug report ready to send. */
  OPEN_BUG_REPORT: "hare:open-bug-report",
} as const;

/**
 * What HARE knows about this PC, for a bug report.
 *
 * Deliberately short, and deliberately assembled only when someone has asked
 * for it. Every field here is something that changes the answer to "why isn't
 * my lighting working": which Windows, which build of HARE, whether the
 * driver is there, what OpenRGB found. Nothing identifies the person or the
 * machine — no username, no serial numbers, no network anything.
 */
export interface SystemReport {
  appVersion: string;
  buildStamp: string;
  os: string;
  arch: string;
  electron: string;
  openRgbVersion: string | null;
  backendStatus: string;
  deviceCount: number;
  deviceNames: string[];
  pawnIoInstalled: boolean;
  pawnIoRunning: boolean;
  elevationEnabled: boolean;
  sensorSources: string[];
  loggingEnabled: boolean;
  conflicts: string[];
}

export const EFFECTS: EffectDefinition[] = [
  {
    id: "rainbow-wave",
    name: "Rainbow Wave",
    description: "A rainbow that flows across your gear.",
    params: { usesColor: false, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "spectrum-cycle",
    name: "Color Cycle",
    description: "Slowly cycles through every color in sync.",
    params: { usesColor: false, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "comet",
    name: "Comet",
    description: "A bright head races along, trailing a fading tail.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "marquee",
    name: "Marquee",
    description: "A band of light runs around your device on a loop.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "theater-chase",
    name: "Chase",
    description: "Dashes of light march forward, one step at a time.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "twinkle",
    name: "Twinkle",
    description: "Random LEDs sparkle over a soft glow.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "rain",
    name: "Rain",
    description: "Droplets of light fall across your device.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "fire",
    name: "Fire",
    description: "A flickering flame in whichever color you pick.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "color-wave",
    name: "Color Wave",
    description: "Two colors ripple across your device in a wave.",
    params: { usesColor: true, usesSecondaryColor: true, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "color-shift",
    name: "Color Shift",
    description: "Fades smoothly back and forth between two colors.",
    params: { usesColor: true, usesSecondaryColor: true, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "color-pulse",
    name: "Color Pulse",
    description: "Pulses one color, then the other, with a dip between.",
    params: { usesColor: true, usesSecondaryColor: true, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "gradient",
    name: "Gradient",
    description: "A still blend from one color to another across your device.",
    params: { usesColor: true, usesSecondaryColor: true, usesSpeed: false, usesBrightness: true },
  },
  {
    id: "breathing",
    name: "Breathing",
    description: "Fades smoothly in and out, like a slow heartbeat.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "strobe",
    name: "Strobe",
    description: "Sharp flashes on and off.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "ambient-sync",
    name: "Screen Sync",
    description: "Matches the average color of whatever's on your screen.",
    params: { usesColor: false, usesSecondaryColor: false, usesSpeed: false, usesBrightness: true },
  },
  {
    id: "music-reactive",
    name: "Music Reactive",
    description: "Pulses with your PC's audio.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: false, usesBrightness: true },
  },
  {
    id: "thermal",
    name: "Thermal",
    description: "Blue when your PC is cool, red when it's working hard.",
    params: { usesColor: false, usesSecondaryColor: false, usesSpeed: true, usesBrightness: true },
  },
  {
    id: "reactive",
    name: "Reactive",
    description: "Flashes with your real keystrokes and clicks, glowing gently when you're idle.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: false, usesBrightness: true },
  },
  {
    id: "static",
    name: "Static",
    description: "One solid color, all the time. Simple and clean.",
    params: { usesColor: true, usesSecondaryColor: false, usesSpeed: false, usesBrightness: true },
  },
];
