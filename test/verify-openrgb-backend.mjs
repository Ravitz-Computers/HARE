// Verifies HARE's real OpenRGB backend (electron/backend/openrgbBackend.ts,
// compiled to dist-electron/) against the simulated device lineup in
// fake-openrgb-server.mjs. This exercises the actual device/zone/mode
// mapping and color-setting code paths — not a mock of HARE's own code,
// only of the OpenRGB SDK server on the other end of the wire.
//
// Run via `npm run test:openrgb` (which builds electron first and starts
// the fake server for you) rather than directly.
import { DEVICES } from "./fake-openrgb-server.mjs";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.HARE_TEST_OPENRGB_PORT) || 6743;
const { OpenRgbBackend } = await import("../dist-electron/backend/openrgbBackend.js");

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  OK: " + msg);
}

const backend = new OpenRgbBackend({ host: "127.0.0.1", port: PORT, connectTimeoutMs: 5000 });

await backend.connect();
const devices = backend.getDevices();
console.log(`Connected. Devices reported: ${devices.length}\n`);
// One fixture device is unreadable at protocol 4 and 5 and fine at 3 (see
// `segmentLie` in fake-openrgb-server.mjs) — the shape of a real Lian Li fan
// controller that openrgb-sdk walked off the end of. HARE is expected to
// notice it lost a device, try older protocols, and keep the one that reads
// the most. So *every* device should arrive, by way of the fallback.
assert(
  devices.length === DEVICES.length,
  `all ${DEVICES.length} devices arrive, via the protocol fallback (got ${devices.length})`
);
assert(
  devices.some((d) => d.name === "Malformed Controller"),
  "...including the one the newest protocol couldn't read"
);
assert(
  backend.getUnreadableDevices().length === 0,
  "...and nothing is left unreadable once it settles"
);

const byName = Object.fromEntries(devices.map((d) => [d.name, d]));

console.log("Checking ROG STRIX B550-F GAMING (motherboard)...");
const mobo = byName["ROG STRIX B550-F GAMING"];
assert(mobo, "motherboard present");
assert(mobo.vendor === "ASUSTeK COMPUTER INC.", "motherboard vendor correct");
assert(mobo.type === "motherboard", "motherboard type mapped correctly, got " + mobo.type);
// Two zones now: the onboard lighting, and an ARGB header that starts empty
// — the shape a real ASUS board reports, and the one that exposed the bug
// where colours were written into a zero-length zone.
assert(mobo.zones.length === 2 && mobo.zones[0].ledCount === 8, "motherboard has an 8-LED onboard zone");
assert(
  mobo.zones[1].ledCount === 0 && mobo.zones[1].resizable,
  "...and an empty, resizable ARGB header"
);
assert(mobo.modes.find((m) => m.name === "Direct").supportsDirectColor === true, "motherboard Direct mode flagged correctly");
assert(mobo.modes.find((m) => m.name === "Static").supportsDirectColor === false, "motherboard Static mode correctly NOT direct-color");
assert(mobo.modes.find((m) => m.name === "Rainbow").maxSpeed === 255, "motherboard Rainbow mode speed range parsed");

console.log("\nChecking Vengeance RGB Pro (ram)...");
const ram = byName["Vengeance RGB Pro"];
assert(ram.vendor === "Corsair", "ram vendor correct");
assert(ram.type === "ram", "ram type mapped correctly, got " + ram.type);
assert(ram.zones[0].ledCount === 10, "ram has 10 LEDs");

console.log("\nChecking Kraken Z63 (cooler, multi-zone)...");
const cooler = byName["Kraken Z63"];
assert(cooler.type === "cooler", "cooler type mapped correctly, got " + cooler.type);
assert(cooler.zones.length === 2, "cooler has 2 zones");
assert(cooler.zones[0].name === "Pump Ring" && cooler.zones[0].ledCount === 24, "cooler pump ring zone correct");
assert(cooler.zones[1].name === "Fan LEDs" && cooler.zones[1].ledCount === 8, "cooler fan LEDs zone correct");
assert(cooler.zones[1].ledStart === 24, "cooler second zone's ledStart correctly offset past the first zone");
const spectrumMode = cooler.modes.find((m) => m.name === "Spectrum Cycle");
assert(spectrumMode.minSpeed === 0 && spectrumMode.maxSpeed === 255 && spectrumMode.speed === 150, "cooler Spectrum Cycle speed fields parsed correctly");

console.log("\nChecking K95 RGB PLATINUM (keyboard, matrix zone)...");
const kb = byName["K95 RGB PLATINUM"];
assert(kb.type === "keyboard", "keyboard type mapped correctly, got " + kb.type);
assert(kb.zones.length === 1, "keyboard has 1 zone");
const kbZone = kb.zones[0];
assert(kbZone.matrix !== null, "keyboard zone reports a matrix (not null)");
assert(kbZone.matrix.rows === 6 && kbZone.matrix.cols === 22, `keyboard matrix dimensions correct, got ${JSON.stringify(kbZone.matrix)}`);
// 6*22 = 132 grid cells, minus the 2 deliberately-carved-out gaps = 130 real LEDs
assert(kbZone.ledCount === 130, "keyboard LED count correctly excludes the 2 matrix gaps, got " + kbZone.ledCount);
assert(kb.modes.length === 4, "keyboard has 4 modes");
assert(kb.modes.find((m) => m.name === "Reactive").supportsDirectColor === false, "keyboard Reactive mode correctly not direct-color");

console.log("\nChecking G502 HERO (mouse)...");
const mouse = byName["G502 HERO"];
assert(mouse.type === "mouse", "mouse type mapped correctly, got " + mouse.type);
assert(mouse.zones.length === 2, "mouse has 2 zones (Logo, DPI Indicator)");

console.log("\nChecking AER RGB 2 fan hub (led-strip, 3 zones)...");
const fans = byName["AER RGB 2 (x3 fans)"];
assert(fans.type === "led-strip", "fan hub type mapped correctly, got " + fans.type);
assert(fans.zones.length === 3, "fan hub has 3 zones");
assert(fans.zones.every((z) => z.ledCount === 8), "each fan zone has 8 LEDs");
assert(fans.zones[2].ledStart === 16, "third fan zone's ledStart correctly offset (8+8)");

console.log("\nExercising setDeviceColor / setZoneColor / setLedColors across devices...");
await backend.setDeviceColor(mobo.id, { r: 10, g: 20, b: 30 });
assert(true, "setDeviceColor on motherboard succeeded");

await backend.setZoneColor(cooler.id, cooler.zones[1].id, { r: 200, g: 0, b: 0 });
assert(true, "setZoneColor on cooler's second zone (Fan LEDs) succeeded");

const kbColors = new Array(kbZone.ledCount).fill({ r: 5, g: 5, b: 5 });
await backend.setLedColors(kb.id, kbZone.id, kbColors);
assert(true, `setLedColors succeeded across all ${kbZone.ledCount} keyboard LEDs`);

// --- Did the write actually take? ------------------------------------------
// The OpenRGB protocol never acknowledges a write, so "sent" and "worked" are
// different things. A motherboard sitting in one of its own firmware modes
// accepts everything and changes nothing — which is exactly what happened on
// a real ASUS board, while HARE reported success. So a deliberate colour
// change is read back and compared.
console.log("\nChecking that a colour change is verified rather than assumed...");
{
  // The simulated server does apply what it's told, so this is the good case.
  await backend.setDeviceColor(mobo.id, { r: 123, g: 45, b: 67 });
  // Give the read-back a moment; it is deliberately off the write path.
  await new Promise((r) => setTimeout(r, 200));
  assert(
    backend.isDeviceResponsive(mobo.id),
    "a device that really applies the colour is not flagged"
  );
  // Proves the check has teeth: the simulator stores what it was sent and
  // reports it back, exactly as the real server does, so a device that
  // ignored the write genuinely would be caught.
  const afterWrite = backend.getDevices().find((d) => d.id === mobo.id);
  assert(
    afterWrite.colors[0].r === 123 && afterWrite.colors[0].g === 45 && afterWrite.colors[0].b === 67,
    "the simulated server reflects the colour it was sent, the way real OpenRGB does"
  );

  const src = readFileSync("electron/backend/openrgbBackend.ts", "utf8");
  assert(
    src.includes("confirmWrite"),
    "a deliberate colour change is read back and compared"
  );
  assert(
    /confirmWrite[\s\S]{0,2000}customModeSet\.delete/.test(src),
    "a write that didn't take re-arms direct mode, rather than giving up on the device"
  );
  assert(
    !/setLedColors[\s\S]{0,400}confirmWrite/.test(src),
    "effect frames are NOT read back — that would cost more than the write itself"
  );
  assert(
    src.includes("none of its modes"),
    "a device whose modes can't accept per-LED colour says so in the log"
  );
}

// --- The firmware effect that painted over everything HARE did ------------
// Reported on an ASRock Polychrome board: use only the board's own firmware
// modes and HARE looks fine, but apply a HARE effect and it comes out wrong.
// Both were running at once. The firmware kept animating while HARE wrote to
// the same LEDs, so the two composited.
//
// The two obvious workarounds both fail, and the fixture is built so they
// still would: setting the board to "Off" stops the output as well as the
// firmware, so HARE's colours go nowhere; painting every LED black is undone
// the moment the firmware draws its next frame.
//
// The fix is to put the device in the mode that hands the LEDs to software.
// HARE used to ask for that with the protocol's SetCustomMode request, which
// asks the *controller* which of its modes is the custom one — and a
// controller that doesn't answer accepts the request and changes nothing. The
// simulated Polychrome ignores SetCustomMode for exactly that reason, so this
// only passes if HARE selects the mode by index itself.
console.log("\nChecking that a firmware effect is switched off before HARE paints...");
{
  const asrock = backend.getDevices().find((d) => d.name.includes("Polychrome"));
  assert(asrock, "the simulated ASRock board is present");

  const firmware = asrock.modes[asrock.activeModeId];
  assert(
    firmware && firmware.name === "Spectrum Cycle",
    `it starts in one of its own firmware effects, not Direct (was "${firmware?.name}")`
  );
  const direct = asrock.modes.find((m) => m.name === "Direct");
  assert(direct && direct.id !== 0, "its Direct mode is not mode 0, the way a real board's often isn't");
  assert(
    asrock.modes.some((m) => m.name === "Off"),
    "...and it has an Off mode, which is the workaround that stops the lights entirely"
  );

  await backend.setDeviceColor(asrock.id, { r: 200, g: 30, b: 30 });
  await new Promise((r) => setTimeout(r, 200));

  const after = backend.getDevices().find((d) => d.id === asrock.id);
  assert(
    after.activeModeId === direct.id,
    `HARE put the board into "${direct.name}" before writing (it is in "${after.modes[after.activeModeId]?.name}")`
  );
  assert(
    after.activeModeId !== asrock.modes.findIndex((m) => m.name === "Off"),
    "...and did not reach for Off, which would stop the board lighting at all"
  );
  assert(
    backend.isDeviceResponsive(asrock.id),
    "...and the colour it then wrote actually took"
  );

  // Read the device back off the wire rather than out of HARE's own cache.
  // A backend that only updated its local copy would pass every check above
  // while the board carried on running its firmware effect underneath — which
  // is precisely the failure being fixed.
  await backend.rescan();
  const wire = backend.getDevices().find((d) => d.id === asrock.id);
  assert(
    wire.activeModeId === direct.id,
    `the board itself reports the new mode, not just HARE's copy of it (it reports "${wire.modes[wire.activeModeId]?.name}")`
  );
}

// --- ARGB headers: the bug that made a real board look dead ----------------
// A motherboard can't count the LEDs on a strip plugged into a header, so the
// zone reports zero. Writing colour to a zero-length zone succeeds and lights
// nothing — which is exactly what happened on a real ASUS PRIME H510M-A:
// HARE wrote to the two onboard LEDs, verified the write, and left the header
// dark. OpenRGB's own window has a resize control; HARE had none.
console.log("\nChecking that an empty ARGB header can be given a length...");
{
  const board = backend.getDevices().find((d) => d.zones.some((z) => z.resizable));
  const header = board.zones.find((z) => z.resizable);

  assert(!!header, "a resizable ARGB header is recognised as resizable");
  assert(header.ledCount === 0, "it starts empty, the way a real header does");
  assert(header.ledsMax > header.ledsMin, "its allowed range is carried through for the UI to offer");

  const before = board.colors.length;
  await backend.resizeZone(board.id, header.id, 30);
  await new Promise((r) => setTimeout(r, 120));

  const after = backend.getDevices().find((d) => d.id === board.id);
  const resized = after.zones.find((z) => z.id === header.id);
  assert(resized.ledCount === 30, `the header now has 30 LEDs, was ${resized.ledCount}`);
  assert(
    after.colors.length === before + 30,
    "the device's LED count grew with it, so colours have somewhere to land"
  );

  // The board decides what it accepts; a silly request must not be believed.
  await backend.resizeZone(board.id, header.id, 99999);
  await new Promise((r) => setTimeout(r, 120));
  const clamped = backend.getDevices().find((d) => d.id === board.id).zones.find((z) => z.id === header.id);
  assert(
    clamped.ledCount === header.ledsMax,
    `an over-long strip is clamped to what the board allows (${clamped.ledCount} vs ${header.ledsMax})`
  );

  // And the whole point: a colour written afterwards reaches the header.
  await backend.setZoneColor(board.id, header.id, { r: 10, g: 200, b: 40 });
  await new Promise((r) => setTimeout(r, 120));
  const lit = backend.getDevices().find((d) => d.id === board.id);
  const headerZone = lit.zones.find((z) => z.id === header.id);
  const firstHeaderLed = lit.colors[headerZone.ledStart];
  assert(
    firstHeaderLed.g === 200 && firstHeaderLed.r === 10,
    "a colour written to the header actually lands on it"
  );
}

// --- The wrapper must forward everything -----------------------------------
// This is the bug that cost two rounds of testing on a real machine: vendor
// devices are merged in by CompositeBackend, `resizeZone` is optional on the
// DeviceBackend interface, and the wrapper didn't implement it. Every call
// became a silent no-op — no error, no log line, nothing to notice, and an
// ARGB header that stayed dark after the fix for ARGB headers had shipped.
//
// So: every method the contract declares must exist on the wrapper. An
// optional method is the dangerous kind, because forgetting it compiles.
console.log("\nChecking that CompositeBackend forwards the whole contract...");
{
  const { CompositeBackend } = await import("../dist-electron/backend/compositeBackend.js");
  const contract = readFileSync("electron/backend/deviceBackend.ts", "utf8");

  // Method signatures declared on the interface, optional ones included.
  const declared = [...contract.matchAll(/^\s{2}(\w+)\??\(/gm)].map((m) => m[1]);
  assert(declared.length > 5, `found ${declared.length} methods on the DeviceBackend contract`);

  const implemented = new Set(Object.getOwnPropertyNames(CompositeBackend.prototype));
  const missing = declared.filter((name) => !implemented.has(name));
  assert(
    missing.length === 0,
    `CompositeBackend forwards every DeviceBackend method${missing.length ? ` — missing: ${missing.join(", ")}` : ""}`
  );

  // And specifically the one that was missed, since it has no compile-time
  // safety net at all.
  assert(implemented.has("resizeZone"), "CompositeBackend forwards resizeZone");
}

console.log("\nALL_CHECKS_PASSED");
await backend.disconnect();
