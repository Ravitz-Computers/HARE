import type { BlendMode, EffectAssignment, EffectLayer, KLColor, LayeredLook } from "./types.js";

/**
 * Pure color math for HARE's built-in software effects. These run
 * against any device in "Direct" mode (i.e. one that accepts raw per-LED
 * colors), regardless of which backend (OpenRGB, a vendor SDK, demo data)
 * is actually pushing the colors to hardware. Keeping this backend-agnostic
 * means a future vendor-SDK backend gets every effect for free.
 */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function hsvToRgb(h: number, s: number, v: number): KLColor {
  // h: 0-360, s/v: 0-1
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  // No initializers here on purpose: every branch below is exhaustive (the
  // final `else` covers whatever's left), so each variable is always
  // assigned before use — an initial `= 0` was flagged as a genuinely
  // useless assignment once ESLint 10's `no-useless-assignment` rule
  // (new in eslint:recommended) started checking this file.
  let r: number, g: number, b: number;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function applyBrightness(color: KLColor, brightnessPct: number): KLColor {
  const t = clamp01(brightnessPct / 100);
  return {
    r: mix(0, color.r, t),
    g: mix(0, color.g, t),
    b: mix(0, color.b, t),
  };
}

function lerpColor(a: KLColor, b: KLColor, t: number): KLColor {
  const k = clamp01(t);
  return { r: mix(a.r, b.r, k), g: mix(a.g, b.g, k), b: mix(a.b, b.b, k) };
}

/** Inverse of hsvToRgb. h: 0-360, s/v: 0-1. Used to derive a color's hue so effects like Fire can restyle it while keeping the color the user actually picked. */
export function rgbToHsv(color: KLColor): { h: number; s: number; v: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * Deterministic pseudo-random value in [0, 1) from an integer seed.
 *
 * Effects like Fire, Twinkle and Rain need randomness, but Math.random()
 * would make them unreproducible: the on-screen preview would never match
 * what the hardware is doing, the same look would replay differently every
 * time, and the effects couldn't be unit-tested at all. Hashing a seed
 * instead keeps every effect a pure function of (led index, time) — so the
 * preview swatch, the per-device preview and the real device all compute
 * byte-identical frames, and test/effects-frames.mjs can assert on them.
 */
function hash01(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth (rather than stepped) deterministic noise over a continuous time axis, for Fire's flicker. */
function smoothNoise(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const eased = f * f * (3 - 2 * f);
  return hash01(seed + i) * (1 - eased) + hash01(seed + i + 1) * eased;
}

/** The second color for two-color effects. Falls back to the primary's opposite hue so these effects still look right if a caller never set one (e.g. an older saved look from the Gallery). */
function secondaryOf(assignment: EffectAssignment): KLColor {
  if (assignment.secondaryColor) return assignment.secondaryColor;
  const { h, s, v } = rgbToHsv(assignment.color);
  return hsvToRgb((h + 180) % 360, s === 0 ? 0.85 : s, v === 0 ? 1 : v);
}

// ---------------------------------------------------------------------------
// Live signals.
//
// Three effects react to something happening outside HARE right now rather
// than purely to elapsed time: Reactive (your keystrokes), Ambient Sync
// (what's on your screen) and Music Reactive (your audio output). Each has
// exactly one real-world source, so each is a single module-level value fed
// by a reporter function, not per-assignment state — the same way a
// hardware-native reactive keyboard effect works off one global signal.
//
// Keeping them here (rather than as a parallel "override mode" that seizes
// every device) is what lets them be ordinary effects: assignable per
// device, previewable, mixable with everything else, and driven by the one
// EffectRunner instead of a second competing write path.
// ---------------------------------------------------------------------------

/** Updated by electron/backend/inputHook.ts on every real keystroke/click. */
let lastInputActivityAt = 0;
/** Latest row of screen colours, left to right, from electron/backend/ambientSync.ts. */
let ambientBands: KLColor[] = [{ r: 0, g: 0, b: 0 }];
/** Latest audio output level, 0-1, from src/lib/musicReactive.ts via IPC. */
let audioLevel = 0;
/** Latest per-band levels, bass first, 0-1. Empty until something reports them. */
let audioBands: number[] = [];
/** When the last beat landed, so an effect can decay from it rather than flicker. */
let lastBeatAt = 0;
/** Hottest temperature HARE can currently see, in °C, from the sensor hub. Null until something reports one. */
let hottestCelsius: number | null = null;
/** Free-running hue for Music Reactive, advanced per reported sample so the color drifts while it pulses. */
let audioHue = 0;

/**
 * Feeds Screen Sync with a row of colours sampled across the display, left to
 * right. Called from the main process's screen sampler; ignored unless some
 * device is actually running the effect.
 */
export function reportAmbientBands(bands: KLColor[]): void {
  ambientBands = bands.length > 0 ? bands : [{ r: 0, g: 0, b: 0 }];
}

/** Older single-colour entry point, kept so a caller with one colour still works. */
export function reportAmbientColor(color: KLColor): void {
  ambientBands = [color];
}

/** Feeds Music Reactive. `level` is 0-1; anything out of range or non-finite is clamped rather than trusted, since this crosses an IPC boundary ~30x/sec. */
export function reportAudioLevel(level: number): void {
  const safe = typeof level === "number" && Number.isFinite(level) ? level : 0;
  audioLevel = clamp01(safe);
  audioHue = (audioHue + 2) % 360;
}

/**
 * Feeds Music Reactive with the detail a single loudness number can't carry:
 * per-band levels (bass first) and whether this sample landed on a beat.
 *
 * Crosses an IPC boundary ~30 times a second, so everything is clamped rather
 * than trusted.
 */
export function reportAudioSpectrum(bands: number[], beat: boolean): void {
  audioBands = Array.isArray(bands) ? bands.map((value) => clamp01(Number(value) || 0)) : [];
  if (audioBands.length > 0) audioLevel = clamp01(Math.max(...audioBands));
  if (beat) lastBeatAt = Date.now();
  audioHue = (audioHue + 2) % 360;
}

/** The one colour that best represents the whole row. */
function averageBands(bands: KLColor[]): KLColor {
  if (bands.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const band of bands) {
    r += band.r;
    g += band.g;
    b += band.b;
  }
  return { r: Math.round(r / bands.length), g: Math.round(g / bands.length), b: Math.round(b / bands.length) };
}

export function reportInputActivity(): void {
  lastInputActivityAt = Date.now();
}

/**
 * Feeds the Thermal effect. `celsius` is the hottest temperature any sensor
 * source can currently see; null means nothing is reporting one, which is a
 * real state on a PC with no readable sensors and must be distinguishable
 * from "0 degrees".
 */
export function reportHottestTemperature(celsius: number | null): void {
  hottestCelsius =
    typeof celsius === "number" && Number.isFinite(celsius) ? celsius : null;
}

/**
 * Maps a temperature onto 0-1 across the range that matters on a gaming PC.
 *
 * Below the floor everything is idle and there is nothing to show; above the
 * ceiling something is wrong and the display should already be at its most
 * alarming. Exported because it is the whole behaviour of the Thermal effect
 * and is worth testing directly.
 */
export function thermalLevel(celsius: number | null, floor = 35, ceiling = 85): number {
  if (celsius === null) return 0;
  if (ceiling <= floor) return 0;
  return clamp01((celsius - floor) / (ceiling - floor));
}

/**
 * Computes the color for every LED index (0..ledCount-1) at a given point
 * in time for a given effect assignment. `elapsedMs` should be a
 * continuously increasing clock (e.g. Date.now() - startTime).
 */
/**
 * How long one full pass through the spectrum takes when "Rainbow" is the
 * chosen colour. Slow on purpose: this is a colour, not an animation, and it
 * should read as "the colour is drifting" rather than compete with whatever
 * the effect itself is doing.
 */
const RAINBOW_CYCLE_MS = 9000;

/** The colour an assignment should actually be drawn with right now. */
export function resolvedColor(assignment: EffectAssignment, elapsedMs: number): KLColor {
  if (!assignment.rainbow) return assignment.color;
  // Saturation and value are taken at full so the cycle is the vivid spectrum
  // people expect from "rainbow", not a wash of whatever colour it replaced.
  return hsvToRgb(((elapsedMs / RAINBOW_CYCLE_MS) * 360) % 360, 1, 1);
}

export function computeEffectFrame(
  assignment: EffectAssignment,
  ledCount: number,
  elapsedMs: number
): KLColor[] {
  const speed = Math.max(1, Math.min(100, assignment.speed)) / 100; // 0.01 - 1
  const t = elapsedMs / 1000;

  // "Rainbow" is a colour choice, not an effect: every case below reads the
  // assignment's colour, so swapping in a drifting hue here makes Breathing,
  // Comet, Twinkle and the rest all gain a rainbow variant at once. Done by
  // substitution rather than by branching per effect, so nothing can be
  // forgotten when a new effect is added. Effects that ignore the colour
  // entirely (Rainbow Wave, Color Cycle, Screen Sync) are unaffected.
  const wantsRainbow = assignment.rainbow === true;
  if (wantsRainbow) {
    assignment = { ...assignment, color: resolvedColor(assignment, elapsedMs), rainbow: false };
  }

  switch (assignment.effectId) {
    case "static": {
      const color = applyBrightness(assignment.color, assignment.brightness);
      return new Array(ledCount).fill(color);
    }

    case "breathing": {
      // Speed controls cycle length: ~4.5s at speed 1, ~0.6s at speed 100.
      const period = 4.5 - speed * 3.9;
      const phase = (Math.sin((2 * Math.PI * t) / period) + 1) / 2; // 0..1
      const eased = phase * phase * (3 - 2 * phase); // smoothstep
      const color = applyBrightness(assignment.color, assignment.brightness * eased);
      return new Array(ledCount).fill(color);
    }

    case "rainbow-wave": {
      const cyclesPerSecond = 0.05 + speed * 0.6;
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        const hue = (((i / Math.max(1, ledCount)) * 360 + t * cyclesPerSecond * 360) % 360 + 360) % 360;
        colors.push(applyBrightness(hsvToRgb(hue, 1, 1), assignment.brightness));
      }
      return colors;
    }

    case "spectrum-cycle": {
      const cyclesPerSecond = 0.03 + speed * 0.35;
      const hue = ((t * cyclesPerSecond * 360) % 360 + 360) % 360;
      const color = applyBrightness(hsvToRgb(hue, 1, 1), assignment.brightness);
      return new Array(ledCount).fill(color);
    }

    case "reactive": {
      // Flashes on real keystrokes/clicks (see electron/backend/inputHook.ts),
      // decaying smoothly back to a gentle idle glow so it's never just off
      // between inputs. lastInputActivityAt stays 0 until the very first
      // real input event arrives (or forever, in the plain-browser dev
      // preview, where there's no OS-level hook) — in that case this is
      // just the idle glow.
      const msSinceActivity = lastInputActivityAt === 0 ? Infinity : Date.now() - lastInputActivityAt;
      const decayMs = 350;
      const flash = clamp01(1 - msSinceActivity / decayMs);
      const idlePhase = (Math.sin(2 * Math.PI * t * 0.4) + 1) / 2;
      const idleBrightness = 15 + idlePhase * 10;
      const brightness = Math.max(idleBrightness, assignment.brightness * flash);
      const color = applyBrightness(assignment.color, brightness);
      return new Array(ledCount).fill(color);
    }

    case "ambient-sync": {
      // Real bias lighting: the LEDs are laid across the screen, so the left
      // of a strip shows the left of the picture. A device with one LED gets
      // the average of the whole row, which is the old behaviour and still
      // the right answer for a single light.
      //
      // Deliberately not smoothed across frames: ambientSync.ts already
      // samples at a modest rate, and smoothing would make this effect
      // stateful — and so unpreviewable and untestable — for little gain.
      if (ledCount <= 1) {
        return new Array(Math.max(0, ledCount)).fill(
          applyBrightness(averageBands(ambientBands), assignment.brightness)
        );
      }
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        const position = (i / (ledCount - 1)) * (ambientBands.length - 1);
        const low = Math.floor(position);
        const high = Math.min(ambientBands.length - 1, low + 1);
        // Blended between neighbouring bands so a long strip reads as a
        // gradient rather than as sixteen visible steps.
        const blended = lerpColor(ambientBands[low], ambientBands[high], position - low);
        colors.push(applyBrightness(blended, assignment.brightness));
      }
      return colors;
    }

    case "music-reactive": {
      // Pulses with the audio.
      //
      // The hue used to always drift on its own, which meant picking a colour
      // here did nothing visible — a reasonable person would call that
      // broken. Now the choice is honoured: a picked colour pulses in that
      // colour, and choosing Rainbow is what asks for the drifting hue.
      const { h, s } = rgbToHsv(assignment.color);
      const hue = wantsRainbow ? audioHue : h;
      const saturation = Math.max(0.6, s);

      // A beat flashes to full and decays quickly, which is what makes
      // lighting look like it is listening rather than just wobbling.
      const sinceBeat = lastBeatAt === 0 ? Infinity : Date.now() - lastBeatAt;
      const beatBoost = clamp01(1 - sinceBeat / 220) * 0.35;

      // With bands, the strip becomes a spectrum: bass at one end, treble at
      // the other. Without them — nothing reporting yet, or a single-LED
      // device — it falls back to pulsing with the overall level, which is
      // exactly what it did before.
      if (audioBands.length > 1 && ledCount > 1) {
        const colors: KLColor[] = [];
        for (let i = 0; i < ledCount; i++) {
          const band = audioBands[Math.min(audioBands.length - 1, Math.floor((i / ledCount) * audioBands.length))];
          const brightness = assignment.brightness * clamp01(0.12 + band * 0.88 + beatBoost);
          // Higher bands sit further round the wheel, so treble reads as a
          // different colour from bass rather than just a different height.
          const spread = wantsRainbow ? 0 : ((i / ledCount) * 40 - 20);
          colors.push(applyBrightness(hsvToRgb((hue + spread + 360) % 360, saturation, 1), brightness));
        }
        return colors;
      }

      const brightness = assignment.brightness * clamp01(0.2 + audioLevel * 0.8 + beatBoost);
      const color = applyBrightness(hsvToRgb(hue, saturation, 1), brightness);
      return new Array(ledCount).fill(color);
    }

    case "thermal": {
      // Cool blue through amber to red, driven by the hottest thing HARE can
      // see. The user's speed setting drives a slow breath so the lighting
      // still looks alive while temperatures are steady, and the pulse gets
      // faster the hotter it is — which is the part you notice from across
      // the room without reading a number.
      const level = thermalLevel(hottestCelsius);
      // 210 degrees of hue is a cold blue; 0 is red. Going down rather than
      // up passes through cyan/green/amber, which is the ordering people
      // already read as "getting hotter".
      const hue = 210 * (1 - level);
      const breathsPerSecond = 0.15 + speed * 0.3 + level * 0.5;
      const breath = 0.75 + 0.25 * ((Math.sin(2 * Math.PI * t * breathsPerSecond) + 1) / 2);
      const color = applyBrightness(hsvToRgb(hue, 1, 1), assignment.brightness * breath);
      return new Array(ledCount).fill(color);
    }

    case "color-wave": {
      const c1 = assignment.color;
      const c2 = secondaryOf(assignment);
      const cyclesPerSecond = 0.05 + speed * 0.5;
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        const phase = (i / Math.max(1, ledCount)) * 2 - t * cyclesPerSecond;
        const w = (Math.sin(2 * Math.PI * phase) + 1) / 2;
        colors.push(applyBrightness(lerpColor(c1, c2, w), assignment.brightness));
      }
      return colors;
    }

    case "color-shift": {
      const period = 6 - speed * 5.2;
      const w = (Math.sin((2 * Math.PI * t) / period) + 1) / 2;
      const eased = w * w * (3 - 2 * w);
      const color = applyBrightness(lerpColor(assignment.color, secondaryOf(assignment), eased), assignment.brightness);
      return new Array(ledCount).fill(color);
    }

    case "color-pulse": {
      // One color swells and fades, then the other — so there's a clear beat
      // between them rather than Color Shift's continuous blend.
      const period = 3.6 - speed * 3.1;
      const cycle = (t % (period * 2)) / period; // 0..2
      const which = cycle < 1 ? assignment.color : secondaryOf(assignment);
      const envelope = Math.sin(Math.PI * (cycle % 1));
      const color = applyBrightness(which, assignment.brightness * envelope);
      return new Array(ledCount).fill(color);
    }

    case "gradient": {
      const c1 = assignment.color;
      const c2 = secondaryOf(assignment);
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        colors.push(applyBrightness(lerpColor(c1, c2, i / Math.max(1, ledCount - 1)), assignment.brightness));
      }
      return colors;
    }

    case "marquee": {
      const cyclesPerSecond = 0.1 + speed * 0.9;
      const head = (((t * cyclesPerSecond) % 1) + 1) % 1;
      const bandWidth = 0.28;
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        const pos = i / Math.max(1, ledCount);
        let d = Math.abs(pos - head);
        d = Math.min(d, 1 - d); // wrap around the loop
        const inBand = clamp01(1 - d / (bandWidth / 2));
        const v = inBand * inBand;
        colors.push(applyBrightness(assignment.color, assignment.brightness * v));
      }
      return colors;
    }

    case "comet": {
      const lapsPerSecond = 0.1 + speed * 0.8;
      const headIndex = (((t * lapsPerSecond) % 1) + 1) % 1 * ledCount;
      const tail = Math.max(2, ledCount * 0.35);
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        // Distance *behind* the head, wrapping around the strip.
        const d = ((headIndex - i) % ledCount + ledCount) % ledCount;
        const v = clamp01(1 - d / tail) ** 2;
        colors.push(applyBrightness(assignment.color, assignment.brightness * v));
      }
      return colors;
    }

    case "theater-chase": {
      const stepsPerSecond = 1.5 + speed * 14;
      const step = Math.floor(t * stepsPerSecond) % 3;
      const on = applyBrightness(assignment.color, assignment.brightness);
      const off = applyBrightness(assignment.color, assignment.brightness * 0.05);
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) colors.push(i % 3 === step ? on : off);
      return colors;
    }

    case "strobe": {
      const period = 1.2 - speed * 1.1;
      const on = t % period < period * 0.3;
      const color = applyBrightness(assignment.color, on ? assignment.brightness : 0);
      return new Array(ledCount).fill(color);
    }

    case "fire": {
      // Keeps the user's hue but restyles saturation/value per LED, so
      // "green fire" or "blue fire" work as naturally as the orange default.
      const { h } = rgbToHsv(assignment.color);
      const flickerRate = 1.5 + speed * 9;
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        const n = smoothNoise(i * 977, t * flickerRate);
        const n2 = smoothNoise(i * 131 + 5000, t * flickerRate * 0.5);
        const heat = clamp01(n * 0.65 + n2 * 0.35);
        const ember = hsvToRgb(h, 1, 0.22);
        const flame = hsvToRgb((h + 25) % 360, 0.45, 1);
        colors.push(applyBrightness(lerpColor(ember, flame, heat * heat), assignment.brightness));
      }
      return colors;
    }

    case "twinkle": {
      const rate = 0.25 + speed * 1.3;
      const colors: KLColor[] = [];
      for (let i = 0; i < ledCount; i++) {
        // Each LED gets its own period and offset, so they sparkle
        // independently rather than blinking in unison.
        const offset = hash01(i * 13 + 1);
        const period = 1 + hash01(i * 29 + 2) * 3;
        const phase = (((t * rate) / period + offset) % 1 + 1) % 1;
        const spark = Math.sin(Math.PI * phase) ** 12;
        colors.push(applyBrightness(assignment.color, assignment.brightness * (0.08 + 0.92 * spark)));
      }
      return colors;
    }

    case "rain": {
      const dropCount = Math.max(2, Math.min(12, Math.round(ledCount / 8)));
      const tail = Math.max(2, ledCount * 0.18);
      const colors: KLColor[] = new Array(ledCount).fill({ r: 0, g: 0, b: 0 });
      for (let i = 0; i < ledCount; i++) {
        let best = 0;
        for (let d = 0; d < dropCount; d++) {
          const dropSpeed = (0.15 + speed * 0.55) * (0.6 + hash01(d * 71 + 3) * 0.8);
          const head = (((t * dropSpeed + hash01(d * 197 + 4)) % 1) + 1) % 1 * ledCount;
          const behind = ((head - i) % ledCount + ledCount) % ledCount;
          best = Math.max(best, clamp01(1 - behind / tail) ** 2);
        }
        colors[i] = applyBrightness(assignment.color, assignment.brightness * best);
      }
      return colors;
    }

    default: {
      // An unrecognized effect id (e.g. a Gallery look exported by a newer
      // build of HARE, then imported here) falls back to the user's solid
      // color rather than going black — an unknown effect should never look
      // like the device died.
      const color = applyBrightness(assignment.color, assignment.brightness);
      return new Array(ledCount).fill(color);
    }
  }
}

/**
 * Drives one or more EffectAssignments on a fixed tick, calling `push` with
 * the computed frame for each assignment. Frame rate is capped at ~30fps,
 * which is smooth to the eye and light on CPU/USB traffic.
 */
// ---------------------------------------------------------------------------
// Layer compositing.
// ---------------------------------------------------------------------------

function blendChannel(mode: BlendMode, dst: number, src: number): number {
  switch (mode) {
    case "add":
      return Math.min(255, dst + src);
    case "screen":
      return 255 - ((255 - dst) * (255 - src)) / 255;
    case "multiply":
      return (dst * src) / 255;
    case "lighten":
      return Math.max(dst, src);
    case "normal":
    default:
      return src;
  }
}

/**
 * How much of a layer is showing at this point in the loop, 0-1.
 *
 * Without a window (or without a loop) a layer is simply always fully on.
 * With one, it fades in over `fadePct`, holds, then fades out — so a
 * sequence transitions rather than cutting. Windows may wrap past the end of
 * the loop (fromPct > toPct), which is how a layer spans the seam.
 */
function windowGain(layer: EffectLayer, loopSeconds: number, elapsedMs: number): number {
  const w = layer.window;
  if (!w || loopSeconds <= 0) return 1;

  const posPct = (((elapsedMs / 1000) % loopSeconds) / loopSeconds) * 100;
  // Clamped, not wrapped with %: a window ending at exactly 100 means "runs
  // to the end of the loop", and taking it modulo 100 would silently turn it
  // into 0 — collapsing a full-loop window to zero width and switching the
  // layer off entirely.
  const from = Math.max(0, Math.min(100, w.fromPct));
  const to = Math.max(0, Math.min(100, w.toPct));

  // Distance travelled into the window, handling the wrap-around case.
  const span = from <= to ? to - from : 100 - from + to;
  if (span <= 0) return 0;
  const into = from <= to ? posPct - from : posPct >= from ? posPct - from : 100 - from + posPct;
  if (into < 0 || into > span) return 0;

  const fade = Math.max(0, Math.min(w.fadePct, span / 2));
  if (fade <= 0) return 1;
  if (into < fade) return into / fade;
  if (into > span - fade) return (span - into) / fade;
  return 1;
}

/**
 * Composites a stack of layers into a single frame.
 *
 * Layers are painted bottom-first onto black, each one blended with whatever
 * is already there using its own blend mode, scaled by its opacity and (if
 * the look is a timed sequence) how far into its window the loop currently
 * is. Every layer is rendered by the same `computeEffectFrame` used for
 * unlayered effects, so a one-layer stack in Normal at full opacity is
 * pixel-identical to just running that effect on its own.
 */
export function computeLayeredFrame(
  look: LayeredLook,
  base: Pick<EffectAssignment, "deviceId" | "zoneId">,
  ledCount: number,
  elapsedMs: number
): KLColor[] {
  const out: KLColor[] = new Array(ledCount);
  for (let i = 0; i < ledCount; i++) out[i] = { r: 0, g: 0, b: 0 };

  const loopSeconds = look.loopSeconds ?? 0;
  for (const layer of look.layers) {
    if (!layer.enabled) continue;
    const gain = clamp01(layer.opacity / 100) * windowGain(layer, loopSeconds, elapsedMs);
    if (gain <= 0) continue;

    const frame = computeEffectFrame(
      {
        deviceId: base.deviceId,
        zoneId: base.zoneId,
        effectId: layer.effectId,
        color: layer.color,
        secondaryColor: layer.secondaryColor,
        speed: layer.speed,
        brightness: layer.brightness,
      },
      ledCount,
      elapsedMs
    );

    for (let i = 0; i < ledCount; i++) {
      const dst = out[i];
      const src = frame[i];
      out[i] = {
        r: mix(dst.r, blendChannel(layer.blendMode, dst.r, src.r), gain),
        g: mix(dst.g, blendChannel(layer.blendMode, dst.g, src.g), gain),
        b: mix(dst.b, blendChannel(layer.blendMode, dst.b, src.b), gain),
      };
    }
  }

  // mix() rounds, but blendChannel's division can leave values a hair outside
  // 0-255 before rounding; clamp so nothing ever reaches the wire out of range.
  for (let i = 0; i < ledCount; i++) {
    out[i] = {
      r: Math.max(0, Math.min(255, out[i].r)),
      g: Math.max(0, Math.min(255, out[i].g)),
      b: Math.max(0, Math.min(255, out[i].b)),
    };
  }
  return out;
}

/**
 * The single entry point for turning an assignment into a frame: composites
 * a layer stack if there is one, otherwise renders the plain single effect.
 * Everything that draws lighting — the EffectRunner, the on-screen previews —
 * goes through here, so layered and unlayered looks can never diverge.
 */
export function computeAssignmentFrame(
  assignment: EffectAssignment,
  ledCount: number,
  elapsedMs: number
): KLColor[] {
  if (assignment.layers && assignment.layers.length > 0) {
    return computeLayeredFrame(
      { layers: assignment.layers, loopSeconds: assignment.loopSeconds },
      assignment,
      ledCount,
      elapsedMs
    );
  }
  return computeEffectFrame(assignment, ledCount, elapsedMs);
}

/** Cheap frame equality — the whole point is to be much cheaper than the hardware write it saves. */
function framesEqual(a: KLColor[] | undefined, b: KLColor[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].r !== b[i].r || a[i].g !== b[i].g || a[i].b !== b[i].b) return false;
  }
  return true;
}

export class EffectRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimes = new Map<string, number>();
  private assignments = new Map<string, EffectAssignment>();
  private ledCounts = new Map<string, number>();
  /** Last frame actually written per assignment, so identical frames are skipped rather than re-sent. */
  private lastPushed = new Map<string, KLColor[]>();

  constructor(
    private push: (assignment: EffectAssignment, colors: KLColor[]) => void,
    private fps = 30
  ) {}

  private key(a: Pick<EffectAssignment, "deviceId" | "zoneId">): string {
    return `${a.deviceId}:${a.zoneId ?? "all"}`;
  }

  set(assignment: EffectAssignment, ledCount: number) {
    const k = this.key(assignment);
    this.assignments.set(k, assignment);
    this.ledCounts.set(k, ledCount);
    // Drop the cache so the new look is written immediately rather than
    // being skipped because its opening frame happens to match the old one.
    this.lastPushed.delete(k);
    if (!this.startTimes.has(k)) this.startTimes.set(k, Date.now());
    this.ensureRunning();
  }

  clear(deviceId: number, zoneId: number | null) {
    const k = this.key({ deviceId, zoneId });
    this.assignments.delete(k);
    this.ledCounts.delete(k);
    this.startTimes.delete(k);
    this.lastPushed.delete(k);
    if (this.assignments.size === 0) this.stop();
  }

  clearAll() {
    this.assignments.clear();
    this.ledCounts.clear();
    this.startTimes.clear();
    this.lastPushed.clear();
    this.stop();
  }

  private ensureRunning() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), Math.round(1000 / this.fps));
  }

  private stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    for (const [k, assignment] of this.assignments) {
      const start = this.startTimes.get(k) ?? Date.now();
      const ledCount = this.ledCounts.get(k) ?? 1;
      const colors = computeAssignmentFrame(assignment, ledCount, Date.now() - start);

      // Only write when something actually changed.
      //
      // Several effects sit still for long stretches by design: Screen Sync
      // while the desktop is static, Music Reactive during silence, Reactive
      // between keystrokes, and any effect at its slowest speed. Pushing an
      // identical frame 30 times a second in those cases is pure waste — it
      // is USB traffic, an SMBus transaction per device, and CPU on both
      // sides, all to set the colours to exactly what they already are.
      //
      // The comparison is far cheaper than the write it avoids, so this costs
      // nothing when frames genuinely do change every tick.
      if (framesEqual(this.lastPushed.get(k), colors)) continue;
      this.lastPushed.set(k, colors);
      this.push(assignment, colors);
    }
  }
}
