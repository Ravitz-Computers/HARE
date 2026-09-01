// Verifies that lighting survives a restart, and — just as important — that
// restoring it never fights the user.
//
// The hard part here isn't saving; it's identity and timing.
//
// IDENTITY: OpenRGB device ids are just indices into whatever it enumerated
// this run. Plug in a keyboard and every id after it shifts, so an id makes a
// useless persistent key — restore by id and a reboot could apply your
// motherboard's colour to your RAM. Devices are fingerprinted by properties
// that survive a reboot instead, with an ordinal to separate genuinely
// identical hardware (four matching RAM sticks would otherwise collapse onto
// one shared preference).
//
// TIMING: a restore that runs on every device-list change would overwrite
// whatever the user just picked, every time a device reconnects or they hit
// rescan. Restoring must happen once per device per session, and choosing
// anything must immediately count as settled.
import { deviceFingerprint, isDevicePreference } from "../dist-electron/backend/deviceIdentity.js";
import { readFileSync } from "node:fs";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const dev = (id, vendor, name, leds) => ({
  id,
  vendor,
  name,
  colors: new Array(leds).fill({ r: 0, g: 0, b: 0 }),
});

console.log("Per-device preference persistence...\n");

// --- Fingerprints are stable across id churn -------------------------------
{
  const before = [dev(0, "ASUS", "B550-F", 3), dev(1, "Corsair", "K95", 130)];
  // A keyboard is plugged in, so everything after it shifts id.
  const after = [dev(0, "ASUS", "B550-F", 3), dev(1, "NEW", "Keeb", 90), dev(2, "Corsair", "K95", 130)];

  const k95Before = deviceFingerprint(before[1], before);
  const k95After = deviceFingerprint(after[2], after);
  check(
    `a device keeps its fingerprint when ids shift around it (${k95Before})`,
    k95Before === k95After
  );
  check(
    "different devices get different fingerprints",
    deviceFingerprint(before[0], before) !== k95Before
  );
}

// --- Identical hardware doesn't collapse onto one preference ---------------
// Four matching RAM sticks share vendor, name and LED count. Without the
// ordinal they'd all read and write the same saved value.
{
  const kit = [
    dev(0, "Corsair", "Vengeance RGB Pro", 10),
    dev(1, "Corsair", "Vengeance RGB Pro", 10),
    dev(2, "Corsair", "Vengeance RGB Pro", 10),
    dev(3, "Corsair", "Vengeance RGB Pro", 10),
  ];
  const keys = kit.map((d) => deviceFingerprint(d, kit));
  check(`four identical RAM sticks get four distinct keys`, new Set(keys).size === 4);
  check("...and those keys are stable, not random", deviceFingerprint(kit[2], kit) === keys[2]);
}

// --- An unrelated device appearing doesn't disturb sibling ordinals --------
{
  const before = [dev(0, "Corsair", "RAM", 10), dev(1, "Corsair", "RAM", 10)];
  const after = [dev(9, "ASUS", "Board", 3), dev(0, "Corsair", "RAM", 10), dev(1, "Corsair", "RAM", 10)];
  check(
    "adding an unrelated device leaves identical siblings' keys alone",
    deviceFingerprint(before[1], before) === deviceFingerprint(after[2], after)
  );
}

// --- Stored preferences are validated, never trusted off disk -------------
{
  check("a colour preference is accepted", isDevicePreference({ kind: "color", color: { r: 1, g: 2, b: 3 } }));
  check("a firmware-mode preference is accepted", isDevicePreference({ kind: "mode", modeId: 2 }));
  check(
    "an effect preference is accepted",
    isDevicePreference({
      kind: "effect",
      assignment: { zoneId: null, effectId: "comet", color: { r: 1, g: 2, b: 3 }, speed: 40, brightness: 100 },
    })
  );
  check(
    "a painted preference is accepted",
    isDevicePreference({ kind: "raw", colors: [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }] })
  );
  check("...but not an empty one, which would restore nothing", !isDevicePreference({ kind: "raw", colors: [] }));
  check(
    "...and not one with a bad entry, which would reach the hardware as undefined",
    !isDevicePreference({ kind: "raw", colors: [{ r: 1, g: 2, b: 3 }, null] })
  );
  check("an unknown kind is rejected", !isDevicePreference({ kind: "wat", color: { r: 1, g: 2, b: 3 } }));
  check("a malformed colour is rejected", !isDevicePreference({ kind: "color", color: { r: "red" } }));
  check("an effect missing its numbers is rejected", !isDevicePreference({ kind: "effect", assignment: { effectId: "comet" } }));
  check("null is rejected rather than throwing", !isDevicePreference(null));
  check("a bare string is rejected", !isDevicePreference("static"));
}

// --- Round trip through the real manager ----------------------------------
// An in-memory stand-in for the store, so this exercises BackendManager's
// real save and restore paths without touching disk or needing Electron's
// app.getPath.
{
  const { BackendManager } = await import("../dist-electron/backend/backendManager.js");
  const { FixtureBackend } = await import("../dist-electron/backend/fixtureBackend.js");

  class MemoryPrefs {
    constructor(seed = {}) {
      this.prefs = new Map(Object.entries(seed));
      this.restored = new Set();
      this.writes = [];
    }
    get(k) { return this.prefs.get(k) ?? null; }
    async set(k, v) { this.prefs.set(k, v); this.restored.add(k); this.writes.push({ k, v }); }
    async clear(k) { this.prefs.delete(k); this.restored.add(k); }
    async clearAll() { this.prefs.clear(); }
    shouldRestore(k) {
      if (this.restored.has(k)) return false;
      this.restored.add(k);
      return this.prefs.has(k);
    }
  }

  // --- Saving ---
  const store = new MemoryPrefs();
  const manager = new BackendManager({ testBackend: new FixtureBackend() });
  manager.setDevicePrefsStore(store);
  await manager.start();

  const devices = manager.getState().devices;
  const target = devices[0];

  await manager.setDeviceColor(target.id, { r: 7, g: 8, b: 9 });
  check("picking a colour saves a preference", store.writes.some((w) => w.v.kind === "color"));

  manager.applyEffect({
    deviceId: devices[1].id,
    zoneId: null,
    effectId: "comet",
    color: { r: 200, g: 30, b: 90 },
    speed: 40,
    brightness: 100,
  });
  const effectWrite = store.writes.find((w) => w.v.kind === "effect");
  check("applying an effect saves a preference", !!effectWrite);
  check(
    "...that records the effect and its parameters",
    effectWrite?.v.assignment.effectId === "comet" && effectWrite?.v.assignment.speed === 40
  );
  check(
    "...but not the device id, which won't be valid next boot",
    effectWrite && !("deviceId" in effectWrite.v.assignment)
  );

  await manager.setNativeMode(devices[2].id, devices[2].modes[0].id);
  check("choosing a firmware mode saves a preference", store.writes.some((w) => w.v.kind === "mode"));

  // Painting was the one thing HARE could do that vanished on restart, and
  // it's the only one that can't be recreated from a few settings. The order
  // is the trap: setRawLedColors clears the device's preference first, so a
  // save written before that call is erased by it.
  const painted = devices[3] ?? devices[0];
  const painting = painted.colors.map((_, i) => ({ r: i * 3, g: 10, b: 200 }));
  await manager.setRawLedColors(painted.id, painting);
  const rawWrite = [...store.writes].reverse().find((w) => w.v.kind === "raw");
  check("painting LEDs saves a preference", !!rawWrite);
  check(
    "...and it survives the clear that the same call performs",
    store.prefs.get(rawWrite?.k)?.kind === "raw"
  );
  check(
    "...carrying the exact colours, not a summary of them",
    rawWrite?.v.colors.length === painting.length && rawWrite?.v.colors[1]?.r === 3
  );

  // --- Restoring, as if HARE had just restarted ---
  const saved = Object.fromEntries(store.prefs);
  const store2 = new MemoryPrefs(saved);
  const manager2 = new BackendManager({ testBackend: new FixtureBackend() });
  manager2.setDevicePrefsStore(store2);
  await manager2.start();
  await new Promise((r) => setTimeout(r, 150));

  const restored = manager2.getState().devices;
  const restoredTarget = restored.find((d) => d.name === target.name);
  check(
    "a saved colour is reapplied on the next start",
    restoredTarget?.colors.every((c) => c.r === 7 && c.g === 8 && c.b === 9)
  );
  check(
    "a saved effect is running again on the next start",
    restored.find((d) => d.name === devices[1].name)?.activeEffectId === "comet"
  );
  const restoredPaint = restored.find((d) => d.name === painted.name);
  check(
    "a painting is back on the next start, LED for LED",
    restoredPaint?.colors.every((c, i) => c.r === painting[i % painting.length].r && c.b === 200)
  );

  // --- Restore is once per session ---------------------------------------
  // The user overrides the restored colour, then rescans. HARE must not
  // reapply the saved preference a second time and stomp that choice.
  //
  // Asserted as "the old saved colour did not come back" rather than "the new
  // colour is still there": FixtureBackend.rescan() rebuilds its sample
  // devices from scratch, so it resets its own colours regardless of what
  // HARE does. Real hardware keeps whatever it was last sent. The property
  // that actually matters here — restore ran once, not twice — is the same
  // either way.
  const before = manager2.getState().devices.find((d) => d.name === target.name);
  await manager2.setDeviceColor(before.id, { r: 111, g: 111, b: 111 });
  await manager2.rescan();
  await new Promise((r) => setTimeout(r, 150));
  const afterRescan = manager2.getState().devices.find((d) => d.name === target.name);
  check(
    "a rescan does not re-apply the saved look over what the user just picked",
    !afterRescan?.colors.every((c) => c.r === 7 && c.g === 8 && c.b === 9)
  );

  // --- Turning an effect off is itself remembered ---
  manager2.clearEffect(restored.find((d) => d.name === devices[1].name).id, null);
  check(
    "turning an effect off forgets the saved look, so it stays off next boot",
    ![...store2.prefs.values()].some((v) => v.kind === "effect" && v.assignment.effectId === "comet")
  );
}

// --- A preference that no longer fits must not stop HARE starting ---------
{
  const { BackendManager } = await import("../dist-electron/backend/backendManager.js");
  const { FixtureBackend } = await import("../dist-electron/backend/fixtureBackend.js");

  class ThrowingPrefs {
    constructor() { this.restored = new Set(); }
    get() { return { kind: "mode", modeId: 99999 }; } // a mode that doesn't exist
    async set() {}
    async clear() {}
    async clearAll() {}
    shouldRestore(k) {
      if (this.restored.has(k)) return false;
      this.restored.add(k);
      return true;
    }
  }

  const manager = new BackendManager({ testBackend: new FixtureBackend() });
  manager.setDevicePrefsStore(new ThrowingPrefs());
  let threw = false;
  try {
    await manager.start();
    await new Promise((r) => setTimeout(r, 100));
  } catch {
    threw = true;
  }
  check("a stale preference that no longer fits doesn't stop HARE starting", !threw);
  check("...and devices still come up", manager.getState().devices.length > 0);
}

// --- An untouched ARGB header gets a length automatically -------------------
// A header reports zero LEDs because the board can't count what's plugged
// into it, and a zero-length zone swallows every colour in silence. Leaving
// it at zero made HARE look broken on a real ASUS board, so an untouched one
// is started at a sensible length rather than left dark.
{
  const src = readFileSync("electron/backend/backendManager.ts", "utf8");

  check(
    "an empty resizable zone is given a starting length",
    /zone\.ledCount === 0[\s\S]{0,900}resizeQuietly\(/.test(src)
  );
  // A convenience nobody asked for must not be able to crash the main
  // process, and must not repeat itself on every device refresh — both of
  // which it did, eight times per click, on a controller that can't be read
  // back after a resize.
  check(
    "...quietly, so a controller that refuses can't throw into the void",
    /private async resizeQuietly/.test(src) && !/void this\.backend\.resizeZone/.test(src)
  );
  check(
    "...and once per zone, not on every refresh",
    /this\.sizedZones\.has\(key\)/.test(src) && /this\.sizedZones\.add\(key\)/.test(src)
  );
  check(
    "...of 8 for a motherboard header, matching what the device page offers",
    src.includes("const DEFAULT_HEADER_LEDS = 8")
  );
  // A fan hub's channel is the same kind of zone with a different answer: it
  // drives a chain of fans, and eight lights a third of the first one. That
  // read as "the number is a position, not a quantity" to the person it
  // happened to, which is the worst way to learn a setting.
  check(
    "...but a fan channel starts at what the channel can drive, not at 8",
    /startingLengthFor\(zone\)/.test(src) && /HUB_CHANNEL_MIN_MAX/.test(src)
  );
  check(
    "a length the user set always wins over that default",
    /typeof saved === "number"[\s\S]{0,400}continue;/.test(src)
  );
  check(
    "sizes are restored before saved lighting, or the colour lands in an empty zone",
    src.indexOf("this.restoreZoneSizes();") < src.indexOf("this.restoreSavedLighting();")
  );
  check(
    "a zone that isn't resizable is left alone",
    /if \(!zone\.resizable\) continue;/.test(src)
  );
  // The log has to name the number, or someone reading it back cannot tell a
  // zone HARE sized from one the hardware reported.
  check(
    "the choice is explained in the log, not made silently",
    /reports no LEDs[\s\S]{0,200}starting it at \$\{size\}/.test(src)
  );
  check(
    "...and says where to change it",
    /Change it on the device's page/.test(src)
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_DEVICE_PREF_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_DEVICE_PREF_CHECKS_PASSED");
// Restored effects leave their 30fps runner ticking, which would otherwise
// keep Node alive forever. Nothing here needs graceful teardown.
process.exit(0);
