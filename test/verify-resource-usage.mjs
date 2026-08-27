// Verifies the two changes that decide what HARE costs while it's just
// sitting there running, plus the renderer hardening that went in alongside
// them.
//
// HARE is meant to be left running all the time — it starts with the PC and
// lives in the tray. That makes idle cost the number that actually matters,
// far more than peak throughput. Two things dominate it:
//
//   1. **Hardware writes.** The effect loop ticks 30 times a second. Several
//      effects sit still for long stretches by design (Screen Sync on a
//      static desktop, Music Reactive in silence, Reactive between
//      keystrokes), and re-sending an identical frame is USB traffic, an
//      SMBus transaction per device, and CPU on both sides — all to set the
//      colours to exactly what they already are.
//
//   2. **Renderer animation.** Every on-screen preview used to run its own
//      timer, 18 of them at once on the Effects page, and they kept running
//      while HARE was minimised to the tray with nothing visible.
//
// These are behavioural checks where they can be, and source checks where the
// behaviour depends on a browser API that doesn't exist in Node.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { EffectRunner } from "../dist-electron/backend/effectsEngine.js";
import { reportAmbientColor } from "../dist-electron/backend/effectsEngine.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

console.log("Idle resource cost...\n");

const assignment = (over = {}) => ({
  deviceId: 1,
  zoneId: null,
  effectId: "static",
  color: { r: 10, g: 20, b: 30 },
  speed: 50,
  brightness: 100,
  ...over,
});

/** Runs a runner for a while and counts how many frames actually reached "hardware". */
async function countPushes(assign, ms, fps = 60) {
  let pushes = 0;
  const runner = new EffectRunner(() => pushes++, fps);
  runner.set(assign, 8);
  await new Promise((r) => setTimeout(r, ms));
  runner.clearAll();
  return pushes;
}

// --- A motionless effect writes once, not 30 times a second ---------------
// "static" never goes through the runner in normal use (BackendManager pushes
// it once), but it is the cleanest possible stand-in for any effect that is
// currently holding still.
{
  const pushes = await countPushes(assignment(), 500);
  check(`a motionless effect writes once and then stops (${pushes} writes in 500ms)`, pushes === 1);
}

// --- Screen Sync on a static desktop is equally quiet ----------------------
// This is the real-world case: the screen sampler keeps reporting the same
// average colour, so every computed frame is identical.
{
  reportAmbientColor({ r: 40, g: 50, b: 60 });
  const pushes = await countPushes(assignment({ effectId: "ambient-sync" }), 500);
  check(`Screen Sync on an unchanging desktop writes once (${pushes} writes in 500ms)`, pushes === 1);
}

// --- ...but it follows the screen the moment it changes -------------------
// The optimisation must not turn into "the effect stopped working".
{
  let pushes = 0;
  const runner = new EffectRunner(() => pushes++, 60);
  reportAmbientColor({ r: 1, g: 1, b: 1 });
  runner.set(assignment({ effectId: "ambient-sync" }), 8);
  await new Promise((r) => setTimeout(r, 120));
  const afterQuiet = pushes;

  reportAmbientColor({ r: 200, g: 30, b: 90 });
  await new Promise((r) => setTimeout(r, 120));
  runner.clearAll();

  check(`a changed screen colour is written straight away (${afterQuiet} → ${pushes})`, pushes > afterQuiet);
}

// --- A genuinely animated effect is not throttled -------------------------
// The skip must cost nothing when frames really do change every tick.
{
  const pushes = await countPushes(assignment({ effectId: "rainbow-wave", speed: 80 }), 400);
  check(`an animating effect still writes every frame (${pushes} writes in 400ms)`, pushes > 10);
}

// --- Changing the look writes immediately ---------------------------------
// A new assignment whose opening frame happens to match the previous one must
// not be swallowed by the cache.
{
  let pushes = 0;
  const runner = new EffectRunner(() => pushes++, 60);
  runner.set(assignment({ color: { r: 5, g: 5, b: 5 } }), 8);
  await new Promise((r) => setTimeout(r, 80));
  const first = pushes;
  // Same colour, different effect — the frame is identical.
  runner.set(assignment({ color: { r: 5, g: 5, b: 5 }, brightness: 100 }), 8);
  await new Promise((r) => setTimeout(r, 80));
  runner.clearAll();
  check(`re-applying a look writes again rather than being skipped (${first} → ${pushes})`, pushes > first);
}

// --- The runner stops entirely when nothing is assigned -------------------
{
  const runner = new EffectRunner(() => {}, 60);
  runner.set(assignment({ effectId: "rainbow-wave" }), 8);
  runner.clear(1, null);
  let pushes = 0;
  const runner2 = new EffectRunner(() => pushes++, 60);
  runner2.set(assignment({ effectId: "rainbow-wave" }), 8);
  runner2.clearAll();
  await new Promise((r) => setTimeout(r, 200));
  check("clearing every effect stops the loop dead", pushes === 0);
}

// --- Renderer previews share one clock, and stop when hidden --------------
// requestAnimationFrame and document.visibilityState don't exist in Node, so
// these are checked at the source level.
{
  const ticker = read("src/lib/previewTicker.ts");
  const swatch = read("src/components/EffectPreviewSwatch.tsx");
  const devicePreview = read("src/components/DeviceEffectPreview.tsx");

  check("a shared preview ticker exists", ticker.length > 0);
  check(
    "it uses requestAnimationFrame, which the browser suspends when hidden",
    ticker.includes("requestAnimationFrame")
  );
  check("it also checks visibility explicitly rather than relying on that alone", ticker.includes("document.hidden"));
  check("it stops when the window becomes hidden", ticker.includes("visibilitychange"));
  check("it stops when nothing is subscribed", ticker.includes("subscribers.size === 0"));
  check(
    "one bad preview can't stop the others",
    /try\s*\{[\s\S]{0,80}tick\(/.test(ticker)
  );

  check(
    "the effect swatch no longer runs its own timer",
    swatch.includes("subscribeToPreviewTicker") && !swatch.includes("setInterval")
  );
  check(
    "the per-device preview no longer runs its own timer",
    devicePreview.includes("subscribeToPreviewTicker") && !devicePreview.includes("setInterval")
  );

  // Any timer left in the renderer would keep waking a tray-minimised app.
  const strays = ["src/components", "src/pages"]
    .flatMap((dir) => {
      try {
        return readdirSync(dir).map((f) => `${dir}/${f}`);
      } catch {
        return [];
      }
    })
    .filter((f) => /\.tsx?$/.test(f) && read(f).includes("setInterval("));
  check(
    `no renderer component drives itself with setInterval${strays.length ? ` — found in ${strays.join(", ")}` : ""}`,
    strays.length === 0
  );
}

// --- The screen sampler only runs while something needs it ----------------
{
  const main = read("electron/main.ts");
  check(
    "the desktop sampler is gated on Screen Sync actually being in use",
    main.includes("isEffectActive(\"ambient-sync\")")
  );
}

// --- Renderer hardening ---------------------------------------------------
{
  const main = read("electron/main.ts");
  check("new windows are denied by default", main.includes("setWindowOpenHandler") && main.includes('action: "deny"'));
  check("outbound links go to the real browser", main.includes("shell.openExternal"));
  check("navigation away from the app is blocked", main.includes('"will-navigate"'));
  check("webviews can't be attached", main.includes('"will-attach-webview"'));
  check("a Content-Security-Policy is set", main.includes("Content-Security-Policy"));
  check("the packaged policy forbids inline script", main.includes('"script-src \'self\'"'));
  check("...and forbids plugins and framing", main.includes("object-src 'none'") && main.includes("frame-ancestors 'none'"));
  check(
    "the looser dev policy is confined to unpackaged builds",
    main.includes("isDev ? development : production")
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_RESOURCE_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_RESOURCE_CHECKS_PASSED");
process.exit(0);
