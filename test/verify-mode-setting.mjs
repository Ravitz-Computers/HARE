// Setting a built-in mode on a device the library can't read, and giving a
// hub channel a starting length that lights the fans plugged into it.
//
// WHY THIS EXISTS
//
// Two separate failures on the same machine, both reported as "the fans don't
// work", both caused by code that looked correct.
//
// 1. EVERY BUILT-IN MODE ERRORED OUT. openrgb-sdk's `updateMode` re-fetches
//    the whole device before it sends anything. On a Lian Li Uni Hub — whose
//    controller data that parser walks off the end of — the re-fetch threw, so
//    all eighteen modes failed with an offset error before a single byte
//    reached the hardware. The hub was fine. The read on the way in was not.
//    HARE now builds and sends the message itself for those devices, from the
//    mode it already parsed. A wrong byte order here is worse than an error:
//    the controller would accept the message and do something else.
//
// 2. THE LED COUNT BEHAVED "LIKE LOCATION INSTEAD OF QUANTITY". Setting a
//    channel to 5 lit two-thirds of the first fan; setting it to 24 lit down
//    near the third. That is OpenRGB working correctly — a zone's length is
//    how many LEDs are on that channel — and HARE's fault was starting every
//    zone at eight. Eight is right for a motherboard ARGB header and far too
//    small for a hub channel carrying three daisy-chained fans.
//
// The checks below hold the wire format against an independent encoder, and
// hold the starting length against both kinds of zone.
import {
  buildUpdateModeBody,
  sendUpdateMode,
  parseControllerData,
} from "../dist-electron/backend/openrgbRawDevice.js";
import { buildControllerData } from "./fake-openrgb-server.mjs";
import { readFileSync } from "node:fs";
import { startingLengthFor } from "../dist-electron/backend/backendManager.js";
import net from "node:net";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("Setting modes without the library, and sizing hub channels...\n");

// --- The mode block matches an independent encoder -------------------------
//
// test/fake-openrgb-server.mjs writes mode blocks the way OpenRGB does, and it
// was written for the parser, not for this. If the two agree byte for byte,
// the layout is right for reasons other than "the same person wrote both".
{
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    return b;
  };
  const u16 = (n) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n, 0);
    return b;
  };
  const str = (s) => {
    const body = Buffer.from(`${s}\0`, "ascii");
    return Buffer.concat([u16(body.length), body]);
  };

  const MODE = {
    index: 3,
    name: "Rainbow Wave",
    value: 7,
    flags: 0b101010,
    speedMin: 0,
    speedMax: 255,
    brightnessMin: 0,
    brightnessMax: 100,
    colorMin: 0,
    colorMax: 4,
    speed: 120,
    brightness: 80,
    direction: 2,
    colorMode: 1,
    colors: [],
  };

  // The independent encoding, spelled out here rather than imported, so a
  // change to either side has to be made twice on purpose.
  const expectedBlock = Buffer.concat([
    str(MODE.name),
    u32(MODE.value),
    u32(MODE.flags),
    u32(MODE.speedMin),
    u32(MODE.speedMax),
    u32(MODE.brightnessMin),
    u32(MODE.brightnessMax),
    u32(MODE.colorMin),
    u32(MODE.colorMax),
    u32(MODE.speed),
    u32(MODE.brightness),
    u32(MODE.direction),
    u32(MODE.colorMode),
    u16(0),
  ]);

  const body = buildUpdateModeBody(5, MODE);
  const declaredSize = body.readUInt32LE(0);
  const index = body.readUInt32LE(4);
  const block = body.subarray(8);

  check("the message declares its own total size", declaredSize === body.length);
  check(`the mode index leads the block (${index})`, index === MODE.index);
  check("the mode block matches the independent encoding byte for byte", block.equals(expectedBlock));

  // Protocol 2 has no brightness fields. Sending them to a server that isn't
  // expecting them shifts every field after by eight bytes — the mode would
  // apply with someone else's speed and direction.
  const old = buildUpdateModeBody(2, MODE);
  check(
    "an older protocol version leaves the two brightness ranges and brightness out (12 bytes shorter)",
    old.length === body.length - 12
  );

  // A palette mode carries its colours; each is four bytes, blue-padded last.
  const withColors = buildUpdateModeBody(5, {
    ...MODE,
    colors: [
      { red: 10, green: 20, blue: 30 },
      { red: 40, green: 50, blue: 60 },
    ],
  });
  const tail = withColors.subarray(withColors.length - 10);
  check(
    "mode colours are sent as a count then four bytes each",
    tail.readUInt16LE(0) === 2 &&
      tail[2] === 10 &&
      tail[3] === 20 &&
      tail[4] === 30 &&
      tail[6] === 40 &&
      tail[8] === 60
  );
}

// --- The message actually reaches a socket, addressed correctly ------------
//
// Nothing comes back from OpenRGB for a mode change, so this is the only place
// the addressing can be checked at all. A message sent to device 0 instead of
// device 4 would look exactly like success from inside HARE.
{
  const received = [];
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => received.push(chunk));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  await sendUpdateMode(
    "127.0.0.1",
    port,
    4,
    5,
    {
      index: 1,
      name: "Static",
      value: 0,
      flags: 0,
      speedMin: 0,
      speedMax: 0,
      colorMin: 0,
      colorMax: 0,
      speed: 0,
      direction: 0,
      colorMode: 0,
      colors: [],
    },
    false,
    "HARE-test"
  );

  const all = Buffer.concat(received);
  server.close();

  // Message one is SET_CLIENT_NAME; message two is the mode.
  const frames = [];
  let at = 0;
  while (at + 16 <= all.length) {
    const magic = all.subarray(at, at + 4).toString("ascii");
    const deviceId = all.readUInt32LE(at + 4);
    const commandId = all.readUInt32LE(at + 8);
    const length = all.readUInt32LE(at + 12);
    frames.push({ magic, deviceId, commandId, length, body: all.subarray(at + 16, at + 16 + length) });
    at += 16 + length;
  }

  check(`two messages arrive, framed cleanly (${frames.length}, ${all.length} bytes consumed)`, frames.length === 2 && at === all.length);
  check("every message carries the ORGB magic", frames.every((f) => f.magic === "ORGB"));
  check("HARE names itself first, so the user can see who is connected in OpenRGB", frames[0]?.commandId === 50 && frames[0]?.body.toString("ascii").startsWith("HARE-test"));
  check("the mode goes to the device that was asked for, not device 0", frames[1]?.deviceId === 4);
  check("it is sent as UPDATE_MODE, which does not write the device's flash", frames[1]?.commandId === 1101);
  check("the header length matches the body actually sent", frames[1]?.length === frames[1]?.body.length);
}

// --- Saving is a different command ----------------------------------------
//
// SAVE_MODE writes the controller's onboard memory, which has a finite number
// of write cycles. Sending it when only a preview was wanted would burn them.
{
  const received = [];
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => received.push(chunk));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  await sendUpdateMode(
    "127.0.0.1",
    port,
    0,
    5,
    {
      index: 0,
      name: "Static",
      value: 0,
      flags: 0,
      speedMin: 0,
      speedMax: 0,
      colorMin: 0,
      colorMax: 0,
      speed: 0,
      direction: 0,
      colorMode: 0,
      colors: [],
    },
    true
  );
  const all = Buffer.concat(received);
  server.close();

  const second = 16 + all.readUInt32LE(12);
  check("asking to persist sends SAVE_MODE, not UPDATE_MODE", all.readUInt32LE(second + 8) === 1102);
}

// --- A refused connection is reported, not swallowed ----------------------
{
  let threw = false;
  try {
    // Port 1 on loopback: nothing listens there.
    await sendUpdateMode("127.0.0.1", 1, 0, 5, {
      index: 0,
      name: "Static",
      value: 0,
      flags: 0,
      speedMin: 0,
      speedMax: 0,
      colorMin: 0,
      colorMax: 0,
      speed: 0,
      direction: 0,
      colorMode: 0,
      colors: [],
    });
  } catch {
    threw = true;
  }
  check("a mode that could not be sent rejects instead of reporting success", threw);
}

// --- The controller's own mode record is what goes back ------------------
//
// This is the check that would have caught the build that turned the lights
// off. `value` is the vendor's private effect number and `flags` says which
// of the fields after it mean anything; neither exists in HARE's mapped copy
// of a device, so an implementation that builds the message from that copy
// has no choice but to invent them. Inventing them sent "vendor effect 0,
// brightness 0" for all eighteen of a fan hub's modes, and every one of them
// switched the fans off while reporting success.
{
  const backendSrc = readFileSync(
    new URL("../electron/backend/openrgbBackend.ts", import.meta.url),
    "utf8"
  );
  const applyMode = backendSrc.slice(
    backendSrc.indexOf("private async applyMode"),
    backendSrc.indexOf("async setRawLedColors")
  );

  check(
    "the mode message is built from the controller's own record, kept from the last read",
    /this\.directModes\.get\(deviceId\)/.test(applyMode)
  );
  check(
    "the vendor's effect number is echoed, never defaulted",
    /value: raw\.value/.test(applyMode) && !/value: 0/.test(applyMode)
  );
  check(
    "so are the mode's flags",
    /flags: raw\.flags/.test(applyMode) && !/flags: 0/.test(applyMode)
  );
  check(
    "brightness comes from the controller unless the user changed it",
    /brightness: patch\.brightness \?\? raw\.brightness/.test(applyMode)
  );
  check(
    "and with no record to echo, nothing is sent at all",
    /if \(!device \|\| !raw\) \{[\s\S]{0,400}return false;/.test(applyMode)
  );

  // The cache has to be filled on the read, or the first mode change after a
  // restart finds nothing and silently does nothing.
  check(
    "every direct read stores that record",
    /this\.directModes\.set\(deviceId, parsed\.modes\)/.test(backendSrc)
  );
}

// --- Nothing about a mode is lost between reading and re-sending ----------
//
// A round trip through the real parser and the real builder: parse a device,
// take one mode back out, and require the bytes to come back identical.
// Anything the parser reads but the builder drops shows up here as a
// difference rather than as a fan that goes dark on someone's desk.
{
  const MODE = {
    name: "Rainbow Wave",
    value: 0x0c,
    flags: 0b1010110,
    speedMin: 1,
    speedMax: 5,
    brightnessMin: 0,
    brightnessMax: 100,
    colorMin: 0,
    colorMax: 0,
    speed: 3,
    brightness: 90,
    direction: 1,
    colorMode: 2,
  };
  const data = buildControllerData(
    {
      name: "UNI HUB",
      vendor: "Lian Li",
      type: 4,
      zones: [{ name: "Channel 1", ledsCount: 8, ledsMin: 0, ledsMax: 96 }],
      modes: [MODE],
      color: [0, 0, 0],
    },
    5
  );
  const parsed = parseControllerData(data, 2, 5);
  const mode = parsed.modes[0];

  check(
    `the parser keeps the vendor's effect number (${mode.value}) and flags (${mode.flags})`,
    mode.value === MODE.value && mode.flags === MODE.flags
  );
  check(`and the brightness the controller reported (${mode.brightness})`, mode.brightness === MODE.brightness);

  // What applyMode sends when nothing is patched: the record, unchanged.
  const body = buildUpdateModeBody(5, { ...mode, index: mode.id });
  const sentBlock = body.subarray(8);
  const originalBlock = data.subarray(
    data.indexOf(Buffer.from(`${MODE.name}\0`, "ascii")) - 2,
    data.indexOf(Buffer.from(`${MODE.name}\0`, "ascii")) - 2 + sentBlock.length
  );
  check(
    "and an unmodified mode goes back to the controller byte for byte as it arrived",
    sentBlock.equals(originalBlock)
  );
}

// --- A mode gets the colours it says it needs -----------------------------
//
// Setting a mode started working and half the modes still appeared to do
// nothing. A mode declares how many colours of its own it accepts, and one
// that wants a colour and is handed none runs with an empty palette: Spectrum
// Cycle and Rainbow Wave generate their own and looked fine, Static and
// Breathing were set successfully and drew nothing.
{
  const backendSrc = readFileSync(
    new URL("../electron/backend/openrgbBackend.ts", import.meta.url),
    "utf8"
  );
  const fn = backendSrc.slice(
    backendSrc.indexOf("function modeColorsFor"),
    backendSrc.indexOf("function mapZones")
  );

  check(
    "a mode's colour count is honoured when building the message",
    /colors: modeColorsFor\(raw,/.test(backendSrc)
  );
  check("...filling up to the fewest it will accept", /colorMin/.test(fn));
  check("...and never sending more than the most", /colorMax/.test(fn) && /slice\(0, mode\.colorMax\)/.test(fn));
  check(
    "...from the colour already on the device, not an invented one",
    /current \? toOrgbColor\(current\)/.test(fn)
  );
}

// --- Starting length: a hub channel is not a motherboard header -----------
{
  // A Lian Li Uni Hub channel: can drive far more than a strip, and reports
  // nothing plugged in until it is told a length.
  // A hub channel's maximum is its capacity, not its population — 96 per
  // channel across eight channels on a Uni Hub. Starting each one there did
  // light every fan, and made the device 768 LEDs, most of them nothing: every
  // effect frame spread over four times the real length, at four times the USB
  // traffic. Reported as the fans looking "weird and choppy", which it was.
  // Eight looked broken in the other direction. Neither guess is HARE's to
  // make, so it makes none and the device page offers one click instead.
  check(
    "a hub channel is left for the user to fill, not guessed at",
    startingLengthFor({ ledsMin: 0, ledsMax: 96 }) === 0 &&
      startingLengthFor({ ledsMin: 0, ledsMax: 120 }) === 0
  );
  // A motherboard ARGB header: a strip's worth, and eight is the safe start.
  check(
    "a motherboard header keeps the small default rather than blasting to its maximum",
    startingLengthFor({ ledsMin: 0, ledsMax: 20 }) === 8
  );
  check(
    "a zone that insists on a minimum gets at least that many",
    startingLengthFor({ ledsMin: 12, ledsMax: 20 }) === 12
  );
  check(
    "a zone whose maximum is smaller than the default is not asked for more than it allows",
    startingLengthFor({ ledsMin: 0, ledsMax: 3 }) === 3
  );
  check(
    "a zone that reports no maximum at all still gets a usable starting length",
    startingLengthFor({}) === 8
  );
  // The boundary itself, so moving it has to be deliberate.
  check(
    "the line between the two sits at 32",
    startingLengthFor({ ledsMax: 32 }) === 0 && startingLengthFor({ ledsMax: 31 }) === 8
  );

  // A zero has to mean "leave it alone" all the way through, or the caller
  // resizes a channel to nothing and every colour written to it vanishes.
  const manager = readFileSync(
    new URL("../electron/backend/backendManager.ts", import.meta.url),
    "utf8"
  );
  check(
    "and a zero is skipped rather than sent to the hardware",
    /const size = startingLengthFor\(zone\);\s*\n\s*if \(size <= 0\) continue;/.test(manager)
  );

  // The one click that replaces the guess. Without it, a new fan controller
  // lights nothing until someone counts LEDs on eight channels.
  const editor = readFileSync(
    new URL("../src/components/ZoneSizeEditor.tsx", import.meta.url),
    "utf8"
  );
  check(
    "an empty channel can be filled to its maximum in one click",
    /function FillAll/.test(editor) && /zone\.ledsMax \?\? 0/.test(editor)
  );
  check(
    "...and an empty channel's box is pre-filled with that number",
    /isHubChannel\(zone\) \? max :/.test(editor)
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_MODE_SETTING_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_MODE_SETTING_CHECKS_PASSED");
