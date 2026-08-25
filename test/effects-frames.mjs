// Verification for every built-in software effect's frame math
// (electron/backend/effectsEngine.ts), run against the real compiled output
// in dist-electron/. No hardware, no OpenRGB, no Windows needed — these are
// pure functions of (assignment, ledCount, elapsedMs) by design, which is
// exactly what makes them testable and what makes the on-screen preview
// provably identical to what gets pushed to a real device.
//
// What this guards against, concretely:
//  - A new effect returning the wrong number of LEDs (would desync the
//    color array the backend writes to hardware).
//  - NaN / out-of-range / non-integer channel values (OpenRGB packs these
//    into bytes; NaN silently becomes 0 and a >255 value wraps).
//  - Non-determinism creeping in (a stray Math.random()), which would make
//    previews lie about what the hardware is doing.
//  - Brightness 0 not actually meaning off.
//  - Edge-case LED counts (0 and 1) throwing or looping forever — real
//    devices report single-LED zones.
import { EFFECTS } from "../dist-electron/backend/types.js";
import { computeEffectFrame } from "../dist-electron/backend/effectsEngine.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const BASE = {
  deviceId: 0,
  zoneId: null,
  color: { r: 255, g: 46, b: 122 },
  secondaryColor: { r: 40, g: 120, b: 255 },
  speed: 45,
  brightness: 100,
};

const LED_COUNTS = [0, 1, 8, 12, 68, 130];
const TIMES = [0, 1, 37, 250, 999, 5000, 60_000, 3_600_000];

console.log(`Effect frame math — ${EFFECTS.length} effects...\n`);

// --- Shape, range and integer-ness across every effect/size/time ---------
let shapeOk = true;
let rangeOk = true;
let badDetail = "";
for (const effect of EFFECTS) {
  for (const ledCount of LED_COUNTS) {
    for (const ms of TIMES) {
      const frame = computeEffectFrame({ ...BASE, effectId: effect.id }, ledCount, ms);
      if (!Array.isArray(frame) || frame.length !== ledCount) {
        shapeOk = false;
        badDetail = `${effect.id} @ ledCount=${ledCount} returned ${frame?.length}`;
        continue;
      }
      for (const c of frame) {
        for (const ch of ["r", "g", "b"]) {
          const v = c?.[ch];
          if (!Number.isInteger(v) || v < 0 || v > 255) {
            rangeOk = false;
            badDetail = `${effect.id} @ ledCount=${ledCount} t=${ms} produced ${ch}=${v}`;
          }
        }
      }
    }
  }
}
check(`every effect returns exactly ledCount colors, for ${LED_COUNTS.length} sizes × ${TIMES.length} timestamps`, shapeOk);
check(`every channel is an integer 0-255 (no NaN, no overflow)${rangeOk ? "" : ` — ${badDetail}`}`, rangeOk);

// --- Determinism: the whole reason previews can be trusted ---------------
let deterministic = true;
for (const effect of EFFECTS) {
  const a = computeEffectFrame({ ...BASE, effectId: effect.id }, 64, 1234);
  const b = computeEffectFrame({ ...BASE, effectId: effect.id }, 64, 1234);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    deterministic = false;
    badDetail = effect.id;
  }
}
check(
  `identical inputs produce identical frames — previews match hardware${deterministic ? "" : ` — ${badDetail} varies`}`,
  deterministic
);

// --- Brightness 0 means off ----------------------------------------------
// Reactive is deliberately excluded: it keeps a dim idle glow by design
// (see its case in effectsEngine.ts), so 0 brightness is not "off" there.
let blackAtZero = true;
for (const effect of EFFECTS) {
  if (effect.id === "reactive") continue;
  const frame = computeEffectFrame({ ...BASE, effectId: effect.id, brightness: 0 }, 32, 4321);
  if (frame.some((c) => c.r !== 0 || c.g !== 0 || c.b !== 0)) {
    blackAtZero = false;
    badDetail = effect.id;
  }
}
check(`brightness 0 turns every effect fully off${blackAtZero ? "" : ` — ${badDetail} still lit`}`, blackAtZero);

// --- Animated effects actually animate ------------------------------------
// Guards the opposite failure from the above: an effect that compiles, stays
// in range, and is deterministic, but is silently frozen (e.g. a speed
// factor accidentally multiplied to zero).
//
// Excluded are the effects that are not driven by the clock, and so are
// *supposed* to hold still here:
//   - static / gradient: still images by definition.
//   - reactive / ambient-sync / music-reactive: driven by a live signal
//     (keystrokes, screen contents, audio) rather than elapsed time — with
//     no signal being reported, holding steady is the correct behavior.
//     That they respond to their signal is covered thoroughly in
//     smoke-live-effects.mjs, which can feed those signals directly.
const NOT_TIME_ANIMATED = new Set(["static", "gradient", "reactive", "ambient-sync", "music-reactive"]);
let animates = true;
for (const effect of EFFECTS) {
  if (NOT_TIME_ANIMATED.has(effect.id)) continue;
  const frames = [0, 400, 900, 1600, 2600, 4000].map((ms) =>
    JSON.stringify(computeEffectFrame({ ...BASE, effectId: effect.id }, 32, ms))
  );
  if (new Set(frames).size < 2) {
    animates = false;
    badDetail = effect.id;
  }
}
check(`every animated effect actually changes over time${animates ? "" : ` — ${badDetail} is frozen`}`, animates);

// --- Two-color effects work without a secondary color ---------------------
// Gallery looks saved before two-color effects existed have no
// secondaryColor; secondaryOf() must fill one in rather than throwing or
// producing black.
let secondaryFallbackOk = true;
for (const effect of EFFECTS.filter((e) => e.params.usesSecondaryColor)) {
  const noSecondary = { ...BASE };
  delete noSecondary.secondaryColor;
  const frame = computeEffectFrame({ ...noSecondary, effectId: effect.id }, 32, 700);
  if (frame.length !== 32 || frame.every((c) => c.r === 0 && c.g === 0 && c.b === 0)) {
    secondaryFallbackOk = false;
    badDetail = effect.id;
  }
}
check(
  `two-color effects still render with no secondaryColor set (old saved looks)${secondaryFallbackOk ? "" : ` — ${badDetail}`}`,
  secondaryFallbackOk
);

// --- Unknown effect id degrades to solid color, never to black ------------
const unknown = computeEffectFrame({ ...BASE, effectId: "not-a-real-effect-from-the-future" }, 16, 500);
check(
  "an unknown effect id falls back to the solid color, not a dead-looking black device",
  unknown.length === 16 && unknown.every((c) => c.r === 255 && c.g === 46 && c.b === 122)
);

// --- Every effect declared in EFFECTS is actually implemented -------------
// Catches the "added it to the list, forgot the case" mistake: an
// unimplemented id would silently hit the default branch and render as a
// flat solid color while claiming to be an animation.
let allImplemented = true;
for (const effect of EFFECTS) {
  if (NOT_TIME_ANIMATED.has(effect.id)) continue;
  const solidLike = [0, 500, 1500, 3000].every((ms) => {
    const frame = computeEffectFrame({ ...BASE, effectId: effect.id }, 24, ms);
    return frame.every((c) => c.r === BASE.color.r && c.g === BASE.color.g && c.b === BASE.color.b);
  });
  if (solidLike) {
    allImplemented = false;
    badDetail = effect.id;
  }
}
check(
  `no effect in EFFECTS silently falls through to the default branch${allImplemented ? "" : ` — ${badDetail} is unimplemented`}`,
  allImplemented
);

// --- "Rainbow" as a colour choice -------------------------------------------
// Rainbow is applied by substituting the assignment's colour, so it has to
// work for every colour-using effect without any of them knowing about it —
// and must leave the ones that ignore colour completely untouched.
{
  const base = { deviceId: 0, zoneId: null, color: { r: 255, g: 0, b: 0 }, speed: 50, brightness: 100 };
  const colourUsing = EFFECTS.filter((e) => e.params.usesColor).map((e) => e.id);

  // Music Reactive is the one deliberate exception to "changes over time":
  // with silence and no audio reported it is legitimately still, and its
  // rainbow behaviour is the drifting hue tested separately below.
  const overTime = colourUsing.filter((id) => id !== "music-reactive");
  const driftsOverTime = overTime.filter((effectId) => {
    const early = computeEffectFrame({ ...base, effectId, rainbow: true }, 6, 0);
    const later = computeEffectFrame({ ...base, effectId, rainbow: true }, 6, 4000);
    return JSON.stringify(early) !== JSON.stringify(later);
  });
  check(
    `every colour-using effect changes hue over time with rainbow on (${driftsOverTime.length}/${overTime.length})`,
    driftsOverTime.length === overTime.length
  );

  // Sampled at several moments rather than one: Strobe is legitimately black
  // during its off phase, and comparing a single timestamp that happens to
  // land there would report a working effect as broken.
  const differsFromFixed = overTime.filter((effectId) =>
    [500, 1500, 3000, 4500, 6000].some((ms) => {
      const fixed = computeEffectFrame({ ...base, effectId }, 6, ms);
      const rainbow = computeEffectFrame({ ...base, effectId, rainbow: true }, 6, ms);
      return JSON.stringify(fixed) !== JSON.stringify(rainbow);
    })
  );
  check(
    "...and none of them silently ignores the flag",
    differsFromFixed.length === overTime.length
  );

  // The fix that came out of writing this: Music Reactive used to throw the
  // chosen colour away and always drift, so picking a colour did nothing.
  {
    const red = computeEffectFrame({ ...base, effectId: "music-reactive", color: { r: 255, g: 0, b: 0 } }, 1, 0)[0];
    const blue = computeEffectFrame({ ...base, effectId: "music-reactive", color: { r: 0, g: 0, b: 255 } }, 1, 0)[0];
    check("Music Reactive pulses in the colour you picked", red.r > red.b && blue.b > blue.r);
  }

  check(
    "rainbow frames stay in range for every effect",
    EFFECTS.every((e) =>
      computeEffectFrame({ ...base, effectId: e.id, rainbow: true }, 6, 1500).every((c) =>
        [c.r, c.g, c.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
      )
    )
  );

  check(
    "rainbow is still deterministic",
    JSON.stringify(computeEffectFrame({ ...base, effectId: "breathing", rainbow: true }, 6, 2500)) ===
      JSON.stringify(computeEffectFrame({ ...base, effectId: "breathing", rainbow: true }, 6, 2500))
  );

  // A whole spectrum, not a red-to-orange wobble.
  const hues = new Set();
  for (let ms = 0; ms < 9000; ms += 500) {
    const c = computeEffectFrame({ ...base, effectId: "breathing", rainbow: true, brightness: 100 }, 1, ms)[0];
    hues.add(`${c.r > c.g && c.r > c.b}|${c.g > c.r && c.g > c.b}|${c.b > c.r && c.b > c.g}`);
  }
  check("one cycle passes through reds, greens and blues", hues.size >= 3);

  check(
    "effects that ignore colour are unaffected by it",
    JSON.stringify(computeEffectFrame({ ...base, effectId: "rainbow-wave" }, 6, 1000)) ===
      JSON.stringify(computeEffectFrame({ ...base, effectId: "rainbow-wave", rainbow: true }, 6, 1000))
  );
}

// --- Music Reactive: bands and beats ----------------------------------------
// It used to report one loudness number, so bass and treble were
// indistinguishable and nothing could land on a beat.
{
  const { computeBands, bandEdges, BeatDetector } = await import("../dist-electron/backend/audioAnalysis.js");
  const { reportAudioSpectrum } = await import("../dist-electron/backend/effectsEngine.js");

  // Bands must be logarithmic, or nearly all of music lands in the first two.
  const edges = bandEdges(128, 8);
  check("band edges rise across the whole spectrum", edges[0] === 0 && edges.at(-1) === 128);
  check("...and every band has at least one bin", edges.every((edge, i) => i === 0 || edge > edges[i - 1]));
  check(
    "...spaced logarithmically, so bass isn't one giant band",
    edges[1] - edges[0] < edges.at(-1) - edges.at(-2)
  );

  const bassOnly = new Uint8Array(128);
  for (let i = 0; i < 4; i++) bassOnly[i] = 255;
  const bands = computeBands(bassOnly);
  check("energy in the low bins shows up in the bass band", bands[0] > 0.5);
  check("...and not in the treble band", bands.at(-1) < 0.05);

  const silence = computeBands(new Uint8Array(128));
  check("silence reads as silence", silence.every((band) => band === 0));
  check("an empty spectrum doesn't throw", computeBands(new Uint8Array(0)).length === 8);

  // Beat detection compares against a rolling average, not a fixed threshold.
  const beats = new BeatDetector(8, 1.35, 0.08);
  let early = false;
  for (let i = 0; i < 7; i++) early = beats.push(0.2) || early;
  check("nothing counts as a beat before there's history to compare against", !early);
  for (let i = 0; i < 8; i++) beats.push(0.2);
  check("a steady level is not a beat", !beats.push(0.2));
  check("a sudden jump in bass is a beat", beats.push(0.9));

  const quiet = new BeatDetector(4, 1.35, 0.08);
  for (let i = 0; i < 8; i++) quiet.push(0.001);
  check("hiss in silence is never a beat", !quiet.push(0.02));

  // And the effect actually uses them.
  const assignment = {
    deviceId: 0,
    zoneId: null,
    effectId: "music-reactive",
    color: { r: 255, g: 0, b: 0 },
    speed: 50,
    brightness: 100,
  };
  reportAudioSpectrum([1, 0, 0, 0, 0, 0, 0, 0], false);
  const bassEnd = computeEffectFrame(assignment, 8, 0);
  const brightness = (c) => c.r + c.g + c.b;
  check("a bass-heavy moment lights the bass end of a strip", brightness(bassEnd[0]) > brightness(bassEnd[7]));

  reportAudioSpectrum([0, 0, 0, 0, 0, 0, 0, 1], false);
  const trebleEnd = computeEffectFrame(assignment, 8, 0);
  check("...and treble lights the other end", brightness(trebleEnd[7]) > brightness(trebleEnd[0]));

  reportAudioSpectrum([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3], false);
  const flat = computeEffectFrame(assignment, 8, 0)[0];
  reportAudioSpectrum([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3], true);
  const onBeat = computeEffectFrame(assignment, 8, 0)[0];
  check("a beat is visibly brighter than the same level without one", brightness(onBeat) > brightness(flat));

  const single = computeEffectFrame(assignment, 1, 0);
  check("a single-LED device still pulses rather than going dark", single.length === 1 && brightness(single[0]) > 0);

  reportAudioSpectrum([], false);
  check("nothing reporting doesn't throw", computeEffectFrame(assignment, 4, 0).length === 4);
}

// --- Sampling the screen into bands ----------------------------------------
// Electron hands back BGRA, and reading it as RGBA would swap red and blue —
// a mistake that looks like "the colours are wrong" rather than like a crash.
{
  const { sampleBands, averageOfBands } = await import("../dist-electron/backend/ambientSampling.js");
  const size = { width: 4, height: 1 };
  // Two red pixels then two blue ones, written BGRA.
  const bitmap = Buffer.from([
    0, 0, 255, 255,
    0, 0, 255, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
  ]);
  const bands = sampleBands(bitmap, size, 2);
  check("BGRA is read in the right order — red stays red", bands[0].r === 255 && bands[0].b === 0);
  check("...and blue stays blue", bands[1].b === 255 && bands[1].r === 0);
  check("bands follow screen position, left to right", bands.length === 2);
  check("the average of the row sits between them", averageOfBands(bands).r === 128 || averageOfBands(bands).r === 127);
  check("an empty frame doesn't throw", sampleBands(Buffer.alloc(0), { width: 0, height: 0 }, 4).length === 4);
  check("more bands than pixels still returns the right count", sampleBands(bitmap, size, 16).length === 16);
}

// --- Screen Sync is bias lighting, not one averaged colour ------------------
{
  const { reportAmbientBands } = await import("../dist-electron/backend/effectsEngine.js");
  const base = {
    deviceId: 0,
    zoneId: null,
    effectId: "ambient-sync",
    color: { r: 0, g: 0, b: 0 },
    speed: 50,
    brightness: 100,
  };

  // Red on the left of the screen, blue on the right.
  reportAmbientBands([
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 0, b: 255 },
  ]);
  const strip = computeEffectFrame(base, 8, 0);
  check("a strip shows the left of the screen on its left", strip[0].r > strip[0].b);
  check("...and the right of the screen on its right", strip[7].b > strip[7].r);
  check(
    "...blended across, not in visible steps",
    strip.slice(1, 7).every((c, i) => c.r <= strip[i].r)
  );

  const single = computeEffectFrame(base, 1, 0);
  check(
    "a single-LED device still gets one sensible colour",
    single.length === 1 && single[0].r > 0 && single[0].b > 0
  );

  reportAmbientBands([]);
  check("no sample yet is black rather than a crash", computeEffectFrame(base, 4, 0)[0].r === 0);

  // Back to something harmless for any later checks.
  reportAmbientBands([{ r: 0, g: 0, b: 0 }]);
}

console.log("");
if (failures > 0) {
  console.error(`ALL_EFFECT_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_EFFECT_CHECKS_PASSED");
