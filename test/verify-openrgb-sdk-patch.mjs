// The openrgb-sdk flag-decoding repair, and the honesty of the error it hid.
//
// WHY THIS EXISTS
//
// A real PC — ASUS board, Lian Li hub — showed zero devices in HARE with:
//
//   Couldn't reach an OpenRGB server on 127.0.0.1:6742 after 4 attempts
//   (Invalid array length)
//
// while OpenRGB's own window showed everything. Two separate failures, and
// each one alone was enough to lose every device on the machine:
//
//   1. **openrgb-sdk 0.6.0 throws on any flag bit it doesn't know.** It
//      decodes bitfields with `Array(known.length - bits.length)`, which goes
//      negative — and `Array(-1)` throws "Invalid array length" — the moment
//      a device reports more bits than the SDK's table has names for.
//      OpenRGB has moved on: zone flags go to bit 24 (the SDK knows one),
//      device flags to bit 25 (the SDK knows nine), mode flags to bit 10 (the
//      SDK knows ten). A resizable zone sets zone-flag bit 1, so this fires
//      on ordinary hardware, and 0.6.0 is the newest release.
//   2. **HARE reported that parse failure as a connection failure**, and
//      retried it four times. The socket was fine. The message sent someone
//      hunting a network problem that did not exist.
//
// The fixture in fake-openrgb-server.mjs now sends the flag values that
// crashed that machine, so `npm run test:openrgb` reproduces the original
// failure byte for byte against an unpatched SDK. This file guards the parts
// that test can't see: that the patch is still applied, still correct, and
// still runs as part of the build.
import { readFileSync, existsSync } from "node:fs";

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

console.log("openrgb-sdk flag decoding...\n");

const SDK = "node_modules/openrgb-sdk/dist/device.js";
const sdk = read(SDK);
const patcher = read("scripts/patch-openrgb-sdk.mjs");
const backend = read("electron/backend/openrgbBackend.ts");
const fixture = read("test/fake-openrgb-server.mjs");

// --- The patch is applied, everywhere ------------------------------------
{
  check("openrgb-sdk is installed", sdk.length > 0);
  check("...and has been repaired", sdk.includes("hare-patched"));

  // Every remaining decoder must be the safe form. One missed site is one
  // unknown bit away from taking the whole device list down again.
  const unsafe = [...sdk.matchAll(/Array\((\w+)\.length - flagcheck_str\.length\)/g)].map((m) => m[0]);
  check(
    `no bitfield decoder can still go negative${unsafe.length ? ` — ${unsafe.join(", ")}` : ""}`,
    unsafe.length === 0
  );
  const safe = [...sdk.matchAll(/Array\(Math\.max\(0, \w+\.length - flagcheck_str\.length\)\)/g)];
  check(`all three decoders are the clamped form (found ${safe.length})`, safe.length === 3);
  check(
    "...and each one only decodes bits it has names for",
    (sdk.match(/flagcheck_str\.slice\(-\w+\.length\)/g) ?? []).length === 3
  );
}

// --- The repair is correct, not merely non-throwing -----------------------
// Clamping alone would stop the crash and silently push `undefined` into the
// flag list for every unknown high bit. `perLedColor` is the flag HARE reads
// to find a direct-colour mode, so a decoder that drifts by one position
// would leave every device looking like it can't take colour from software.
{
  const decode = (flags, value) => {
    const s = value.toString(2);
    const arr = Array(Math.max(0, flags.length - s.length))
      .concat(s.slice(-flags.length).split(""))
      .reverse();
    const out = [];
    arr.forEach((el, i) => {
      if (el === "1") out.push(flags[i]);
    });
    return out;
  };
  const MODE = [
    "speed", "directionLR", "directionUD", "directionHV", "brightness",
    "perLedColor", "modeSpecificColor", "randomColor", "manualSave", "automaticSave",
  ];
  const ZONE = ["resizeEffectsOnly"];

  check("a known flag still decodes to itself", decode(MODE, 1 << 5).join() === "perLedColor");
  check(
    "...and still does with an unknown bit set alongside it",
    decode(MODE, (1 << 5) | (1 << 10)).join() === "perLedColor"
  );
  check("multiple known flags keep their order", decode(MODE, 0b10001).join() === "speed,brightness");
  check("a zone flag of 2 no longer throws", Array.isArray(decode(ZONE, 2)));
  check(
    "...and unknown bits never leak in as undefined",
    [0, 1, 2, 1 << 16, 0x1000012].every((v) => !decode(ZONE, v).includes(undefined)) &&
      [0, 32, 1056, 1 << 25].every((v) => !decode(MODE, v).includes(undefined))
  );
}

// --- It is applied by the build, not by hand ------------------------------
// node_modules is not committed, so an unpatched SDK is one `npm ci` away.
{
  const pkg = JSON.parse(read("package.json"));
  check(
    "the patch runs as part of the build",
    pkg.scripts["build:electron"].includes("patch-openrgb-sdk.mjs")
  );
  check("...before anything is compiled against it", /patch-openrgb-sdk\.mjs && node scripts\/build-stamp/.test(pkg.scripts["build:electron"]));
  check("it is safe to run twice", patcher.includes("MARKER") && patcher.includes("already repaired"));
  check(
    "a changed SDK fails loudly rather than silently not patching",
    /found \$\{found\}/.test(patcher) && patcher.includes("refuses to apply half of itself")
  );

  // node_modules is not in electron-builder.yml's `files` -- electron-builder
  // adds production dependencies itself. So "the repaired copy is the copy
  // that ships" is an assumption unless something checks the built archive,
  // and the cost of it being wrong is every user seeing zero devices.
  const packager = read("scripts/package-win.mjs");
  check(
    "the packaged app is checked for the repair, not assumed to have it",
    packager.includes("app.asar") && packager.includes("hare-patched: tolerate unknown flag bits")
  );
  check(
    "...and packaging fails if it isn't there",
    /does NOT contain the repaired openrgb-sdk[\s\S]{0,600}process\.exit\(1\)/.test(packager)
  );
}

// --- The fixture sends what the real machine sent -------------------------
{
  check(
    "the fake server reports a zone flag the SDK doesn't know",
    /zone\.zoneFlags \?\? 0x02/.test(fixture)
  );
  check(
    "...a device flag it doesn't know",
    /spec\.deviceFlags \?\? \(1 << 16\)/.test(fixture)
  );
  check(
    "...and a mode flag it doesn't know, on a mode HARE has to read correctly",
    /wholeDeviceOnly: 1 << 10/.test(fixture) &&
      /flags: FLAG\.perLedColor \| FLAG\.wholeDeviceOnly/.test(fixture)
  );
}

// --- A parse failure is not a connection failure --------------------------
{
  check(
    "reading the device list is not retried as though the socket failed",
    /await client\.connect\(timeoutMs\);\s*\}\s*catch \(err\) \{/.test(backend) &&
      /continue;\s*\}/.test(backend)
  );
  check(
    "...and says OpenRGB was reached, so nobody hunts a connection problem",
    backend.includes("Connected to OpenRGB, but couldn't read the device list")
  );
  check(
    "...and says where the devices can still be seen",
    /its own window will still show your devices/.test(backend)
  );
}

// --- One bad device must not cost all of them ----------------------------
// Two different parsing bugs in two builds each turned a PC full of working
// hardware into "0 devices detected". Whatever the third one is, the blast
// radius has to be one device.
{
  check(
    "devices are read one at a time, not in a loop that dies as a whole",
    /for \(let i = 0; i < count; i\+\+\) \{\s*try \{/.test(backend)
  );
  check(
    "...an unreadable one is skipped and named in the log",
    /sent data HARE couldn't read/.test(backend) && /Skipping it and carrying on/.test(backend)
  );
  check(
    "...and recorded, so the UI can say so rather than pretend it isn't there",
    /getUnreadableDevices\(\)/.test(backend)
  );
  check(
    "...while nothing readable at all still fails, since that is a different problem",
    /devices\.length === 0 && unreadable\.length > 0/.test(backend)
  );
  check(
    "the fixture contains a device that really is unparseable",
    /segmentLie/.test(fixture)
  );
  // The fixture has to answer in the version it was asked for, or "fall back
  // to an older protocol" can't be tested at all — only asserted.
  check(
    "...and the fixture honours the protocol version it is asked for",
    /const version = Math\.min\(requested, PROTOCOL_VERSION\)/.test(fixture) &&
      /if \(version >= 4\)/.test(fixture) &&
      /if \(version >= 5\)/.test(fixture)
  );
}

// --- Falling back to an older protocol ------------------------------------
// Every older OpenRGB protocol version has strictly FEWER fields, and HARE
// reads none of the ones that disappear. So when the newest reply is
// something the parser can't handle, stepping down costs nothing a user would
// notice and is far better than no devices at all.
{
  check("there is a fallback ladder", /PROTOCOL_FALLBACKS/.test(backend));
  check(
    "...starting with the negotiated version, then older ones",
    /PROTOCOL_FALLBACKS: \(number \| null\)\[\] = \[null, 4, 3\]/.test(backend)
  );
  check(
    "...requested through the SDK's own setting rather than a patch",
    /forceProtocolVersion: this\.forcedProtocolVersion/.test(backend)
  );
  // A server that isn't running is equally not running at every version.
  // Retrying the ladder on a connection error would make a missing OpenRGB
  // take three times as long to report, for nothing.
  check(
    "...and the version that reads the MOST devices is the one kept",
    /if \(!best \|\| readable > best\.count\)/.test(backend) &&
      /Settling on protocol/.test(backend)
  );
  check(
    "only a parse failure falls back, never a connection failure",
    /isParseFailure/.test(backend) && /if \(!\(err instanceof Error\) \|\| !this\.isParseFailure\(err\)\) throw err;/.test(backend)
  );
}


// --- A device that needs the fallback must not fail on every read ---------
// The first version of the fallback only ran in the full device refresh. Every
// other read of that device — after a resize, after a mode change — still went
// straight to openrgb-sdk and threw. One click on a machine with one awkward
// controller produced eight recovered promise rejections and a failed IPC
// handler, and the device was resized again on the next pass, for ever.
{
  const manager = read("electron/backend/backendManager.ts");

  check(
    "there is one place that reads a device",
    /private async readOneDevice/.test(backend)
  );
  check(
    "...and a device that needed the fallback is remembered, not retried into a throw",
    /directReadDevices/.test(backend) && /this\.directReadDevices\.has\(deviceId\)/.test(backend)
  );
  check(
    "...used by the single-device refresh as well as the full one",
    /refreshSingleDevice[\s\S]{0,700}readOneDevice/.test(backend)
  );
  check(
    "re-reading a device never rejects",
    /Promise<boolean>[\s\S]{0,600}Keeping what HARE already knew/.test(backend)
  );

  // A resize that can't be confirmed still has to move HARE's idea of the
  // zone, or the automatic sizing sees zero again and resizes for ever.
  check(
    "a resize that can't be read back is taken on trust rather than left at zero",
/LEDs on trust/.test(backend) && /staleZone\.ledCount = size/.test(backend)
  );
  check(
    "...and the zones after it move along the strip with it",
    /other\.ledStart > staleZone\.ledStart/.test(backend)
  );

  // Automatic header sizing is a convenience. It must not be able to produce
  // an unhandled rejection, and it must not repeat.
  check(
    "automatic header sizing happens once per zone, not on every refresh",
    /sizedZones/.test(manager) && /this\.sizedZones\.has\(key\)/.test(manager)
  );
  check(
    "...and can't throw into the void",
    /private async resizeQuietly/.test(manager) && !/void this\.backend\.resizeZone/.test(manager)
  );

  // "Writing rgb(255, 46, 122) to all 0 LEDs" is a sentence that appeared in a
  // real log.
  check(
    "a device with no LEDs is told so rather than written to",
    /reports no LEDs, so there is nowhere to put a colour/.test(backend)
  );
}


console.log("");
if (failures > 0) {
  console.error(`ALL_SDK_PATCH_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_SDK_PATCH_CHECKS_PASSED");
