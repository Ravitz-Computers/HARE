// HARE's own reader for a device openrgb-sdk can't parse.
//
// WHY THIS EXISTS
//
// A Lian Li fan controller on a real PC reported data openrgb-sdk walked off
// the end of, at every protocol version, with the same target offset each time
// while the reply itself shrank. That rules out every version-specific field
// and points at something the parser gets wrong regardless of version.
//
// The suspect is `matrix_len`. OpenRGB prefixes a zone's matrix with the
// length of the block in bytes; openrgb-sdk ignores it, reads height and width
// out of the block, and then reads height*width values on trust. A zone whose
// declared length and declared dimensions disagree sends the parser hundreds
// of bytes past the end — and the overshoot seen on that machine was about the
// size of a 100-key matrix that was never sent.
//
// This test builds exactly that device and requires two things of it:
//
//   1. **openrgb-sdk really does fail on it.** Without that, the fixture is
//      not reproducing the problem and everything below is theatre.
//   2. **HARE's reader gets the device anyway**, with its zones, modes and
//      LED count intact — not a husk that merely didn't throw.
//
// The fallback is only worth having if both hold.
import { parseControllerData } from "../dist-electron/backend/openrgbRawDevice.js";
import { buildControllerData } from "./fake-openrgb-server.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const FLAG_PER_LED = 1 << 5;

/** A fan controller with several zones, one of which lies about its matrix. */
const AWKWARD = {
  name: "UNI HUB",
  vendor: "Lian Li",
  type: 4,
  zones: [
    { name: "Channel 1", ledsCount: 8, ledsMin: 0, ledsMax: 120 },
    { name: "Channel 2", ledsCount: 8, ledsMin: 0, ledsMax: 120, matrixLie: true },
    { name: "Channel 3", ledsCount: 8, ledsMin: 0, ledsMax: 120 },
  ],
  modes: [
    { name: "Direct", flags: FLAG_PER_LED },
    { name: "Rainbow", flags: 1, speedMin: 0, speedMax: 255, speed: 100 },
  ],
  color: [10, 20, 30],
};

console.log("HARE's own OpenRGB device reader...\n");

for (const version of [5, 4, 3]) {
  console.log(`\nProtocol ${version}:`);
  const body = buildControllerData(AWKWARD, version);

  // 1. The SDK must genuinely fail, or this proves nothing.
  let sdkError = null;
  try {
    const Device = require("openrgb-sdk/dist/device.js").default;
    new Device(body, 0, version);
  } catch (err) {
    sdkError = err;
  }
  check(
    `openrgb-sdk fails on this device${sdkError ? ` (${sdkError.message.slice(0, 48)}…)` : ""}`,
    sdkError !== null
  );

  // 2. HARE's reader gets it.
  let device = null;
  let ourError = null;
  try {
    device = parseControllerData(body, 0, version);
  } catch (err) {
    ourError = err;
  }
  check(`...and HARE reads it${ourError ? ` — ${ourError.message}` : ""}`, ourError === null);
  if (!device) continue;

  check("...with the right name", device.name === "UNI HUB");
  check("...the right vendor", device.vendor === "Lian Li");
  check("...all three zones", device.zones.length === 3);
  check(
    "...their LED counts intact, which is what colours are written against",
    device.zones.every((z) => z.ledsCount === 8)
  );
  check(
    "...the resizable header still marked resizable",
    device.zones.every((z) => z.resizable === true)
  );
  check("...both modes", device.modes.length === 2);
  // Losing this flag would be worse than losing the device: HARE would find
  // no direct-colour mode and quietly write into a firmware effect.
  check(
    "...and Direct still flagged as taking per-LED colour",
    device.modes[0].flagList.includes("perLedColor")
  );
  check("...with every LED accounted for", device.colors.length === 24);

  // The lying matrix costs the matrix, not the device.
  check(
    "the zone that lied about its matrix has no matrix, and is otherwise fine",
    device.zones[1].matrix === undefined && device.zones[1].name === "Channel 2"
  );
}

// --- A well-formed device must come out identical to the SDK's reading ----
// The fallback runs on devices the SDK failed, but it must not be a different
// interpretation of the same bytes. If the two disagree on an ordinary device,
// one of them is wrong about the protocol.
console.log("\nAgainst a device openrgb-sdk reads fine:");
{
  const ordinary = {
    name: "ROG STRIX B550-F GAMING",
    vendor: "ASUSTeK COMPUTER INC.",
    type: 0,
    zones: [
      { name: "Motherboard", ledsCount: 8 },
      { name: "Aura Addressable 1", ledsCount: 0, ledsMin: 0, ledsMax: 240 },
    ],
    modes: [
      { name: "Direct", flags: FLAG_PER_LED },
      { name: "Rainbow", flags: 1, speedMin: 0, speedMax: 255, speed: 128 },
    ],
    color: [255, 0, 60],
  };
  const body = buildControllerData(ordinary, 5);
  const Device = require("openrgb-sdk/dist/device.js").default;
  const theirs = new Device(body, 0, 5);
  const ours = parseControllerData(body, 0, 5);

  check("the name agrees", ours.name === theirs.name);
  check("the vendor agrees", ours.vendor === theirs.vendor);
  check("the device type agrees", ours.type === theirs.type);
  check("the active mode agrees", ours.activeMode === theirs.activeMode);
  check("the zone count agrees", ours.zones.length === theirs.zones.length);
  check(
    "every zone's LED count agrees",
    ours.zones.every((z, i) => z.ledsCount === theirs.zones[i].ledsCount)
  );
  check(
    "every zone's resizability agrees",
    ours.zones.every((z, i) => z.resizable === theirs.zones[i].resizable)
  );
  check("the mode count agrees", ours.modes.length === theirs.modes.length);
  check(
    "every mode's name agrees",
    ours.modes.every((m, i) => m.name === theirs.modes[i].name)
  );
  check(
    "and the per-LED-colour flag agrees on every mode",
    ours.modes.every(
      (m, i) => m.flagList.includes("perLedColor") === theirs.modes[i].flagList.includes("perLedColor")
    )
  );
  check("the LED count agrees", ours.colors.length === theirs.colors.length);
}

console.log("");
if (failures > 0) {
  console.error(`ALL_RAW_PARSER_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_RAW_PARSER_CHECKS_PASSED");
