// Verification for the live-signal effects — Screen Sync ("ambient-sync"),
// Music Reactive ("music-reactive") and Reactive — and for the per-device
// independence they gained when they stopped being global on/off toggles.
//
// Runs against the real compiled output in dist-electron/ with
// FixtureBackend (test-only sample devices, injected via the testBackend
// escape hatch), so it needs no real hardware, no OpenRGB, no screen capture
// and no audio device.
//
// This replaces the old smoke-override.mjs. Screen Sync and Music Reactive
// used to be global "override modes" that seized every device at once and
// wiped whatever per-device effects were assigned; they are ordinary
// per-device effects now. What's worth guarding, concretely:
//   - They're real, assignable effects that actually drive LEDs.
//   - They're per-device: putting Screen Sync on one device must not
//     disturb an unrelated effect running on another. (Under the old
//     override system this was impossible by construction — that's the
//     regression this file exists to prevent.)
//   - The live signal genuinely reaches the LEDs, and a newly reported
//     signal changes them.
//   - isEffectActive() is accurate, since it's what gates the screen
//     sampler (main.ts) and the renderer's audio capture (store.ts) — a
//     wrong answer there means either a dead effect or a capture left
//     running with nothing using it.
//   - A manual color pick still takes a device back from any of them.
import { BackendManager } from "../dist-electron/backend/backendManager.js";
import { FixtureBackend } from "../dist-electron/backend/fixtureBackend.js";
import { reportAmbientColor, reportAudioLevel } from "../dist-electron/backend/effectsEngine.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 120));

const manager = new BackendManager({ testBackend: new FixtureBackend() });
await manager.start();
const devices = manager.getState().devices;
const screenDeviceId = devices[0].id;
const otherDeviceId = devices[1].id;

const deviceById = (id) => manager.getState().devices.find((d) => d.id === id);

console.log("Live-signal effects (Screen Sync / Music Reactive / Reactive)...");

// --- Screen Sync drives real LEDs from the sampled color ------------------
reportAmbientColor({ r: 10, g: 20, b: 30 });
manager.applyEffect({
  deviceId: screenDeviceId,
  zoneId: null,
  effectId: "ambient-sync",
  color: { r: 0, g: 0, b: 0 },
  speed: 50,
  brightness: 100,
});
check("Screen Sync registers as the device's active effect", deviceById(screenDeviceId).activeEffectId === "ambient-sync");
check("isEffectActive reports Screen Sync — this is what starts the screen sampler", manager.isEffectActive("ambient-sync"));

await settle();
check(
  "the sampled screen color actually reaches the device's LEDs",
  deviceById(screenDeviceId).colors.every((c) => c.r === 10 && c.g === 20 && c.b === 30)
);

// --- A newly sampled color follows through --------------------------------
reportAmbientColor({ r: 200, g: 40, b: 90 });
await settle();
check(
  "a newly sampled screen color updates the LEDs",
  deviceById(screenDeviceId).colors.every((c) => c.r === 200 && c.g === 40 && c.b === 90)
);

// --- Per-device independence: the whole point of the migration ------------
manager.applyEffect({
  deviceId: otherDeviceId,
  zoneId: null,
  effectId: "breathing",
  color: { r: 0, g: 255, b: 0 },
  speed: 30,
  brightness: 100,
});
check(
  "a second device can run a normal effect at the same time",
  deviceById(otherDeviceId).activeEffectId === "breathing"
);
check(
  "...without disturbing Screen Sync on the first device (impossible under the old override system)",
  deviceById(screenDeviceId).activeEffectId === "ambient-sync"
);

await settle();
check(
  "Screen Sync's device still tracks the sampled color while the other device animates",
  deviceById(screenDeviceId).colors.every((c) => c.r === 200 && c.g === 40 && c.b === 90)
);

// --- Music Reactive ------------------------------------------------------
manager.applyEffect({
  deviceId: otherDeviceId,
  zoneId: null,
  effectId: "music-reactive",
  color: { r: 255, g: 0, b: 255 },
  speed: 50,
  brightness: 100,
});
check("isEffectActive reports Music Reactive — this is what starts audio capture", manager.isEffectActive("music-reactive"));

reportAudioLevel(1);
await settle();
const loud = deviceById(otherDeviceId).colors[0];
reportAudioLevel(0);
await settle();
const quiet = deviceById(otherDeviceId).colors[0];
const brightnessOf = (c) => c.r + c.g + c.b;
check(
  `a loud sample lights the device more than a silent one (loud=${brightnessOf(loud)}, quiet=${brightnessOf(quiet)})`,
  brightnessOf(loud) > brightnessOf(quiet)
);

// --- Out-of-range audio levels are clamped, not trusted --------------------
// This value crosses an IPC boundary ~30x/sec from the renderer, so it gets
// validated rather than fed straight into color math.
reportAudioLevel(Number.NaN);
await settle();
const afterNaN = deviceById(otherDeviceId).colors[0];
check(
  "a NaN audio level doesn't produce NaN colors",
  Number.isInteger(afterNaN.r) && Number.isInteger(afterNaN.g) && Number.isInteger(afterNaN.b)
);

reportAudioLevel(999);
await settle();
const afterHuge = deviceById(otherDeviceId).colors[0];
check(
  "an out-of-range audio level stays within 0-255",
  [afterHuge.r, afterHuge.g, afterHuge.b].every((v) => v >= 0 && v <= 255)
);

// --- A manual color pick still takes the device back ----------------------
await manager.setDeviceColor(screenDeviceId, { r: 1, g: 2, b: 3 });
check("a manual color pick clears Screen Sync off that device", deviceById(screenDeviceId).activeEffectId === null);
check("isEffectActive goes false once nothing uses Screen Sync — the sampler can stop", !manager.isEffectActive("ambient-sync"));

reportAmbientColor({ r: 111, g: 111, b: 111 });
await settle();
check(
  "once cleared, further screen samples no longer touch that device",
  deviceById(screenDeviceId).colors.every((c) => c.r === 1 && c.g === 2 && c.b === 3)
);
check(
  "...and the other device's Music Reactive is untouched by that",
  deviceById(otherDeviceId).activeEffectId === "music-reactive"
);

manager.clearEffect(otherDeviceId, null);
check("clearing the last live effect reports inactive — audio capture can stop", !manager.isEffectActive("music-reactive"));

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("ALL_LIVE_EFFECT_CHECKS_PASSED");
process.exit(0);
