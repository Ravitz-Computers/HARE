#!/usr/bin/env node
// Repairs a crash in openrgb-sdk 0.6.0 that stops HARE seeing any hardware.
//
// THE BUG, AND WHY IT LOOKS LIKE SOMETHING ELSE
//
// A real machine (ASUS board + Lian Li hub) reported "0 devices" with:
//
//   Couldn't reach an OpenRGB server on 127.0.0.1:6742 after 4 attempts
//   (Invalid array length)
//
// which reads as a connection problem and is not one. The socket connected.
// "Invalid array length" is what `new Array(-1)` throws, and openrgb-sdk
// throws it while *parsing* the controller data OpenRGB sent back. OpenRGB's
// own window shows every device, because the fault is in the JavaScript
// client, not in OpenRGB and not in the hardware.
//
// The SDK decodes bitfields like this, in three places (dist/device.js):
//
//   let flagcheck = Array(flags.length - flagcheck_str.length)
//                     .concat(flagcheck_str.split("")).reverse();
//
// It right-aligns the binary string into an array as wide as the list of
// flags it knows about. If the device reports MORE bits than the SDK knows,
// that subtraction goes negative and `Array(-1)` throws. Every device on the
// machine is lost, because one unknown bit killed the parse.
//
// This is not hypothetical, and it is not one flag. Against OpenRGB's current
// protocol (Documentation/RGBControllerAPI.md) all three sites are live:
//
//   - **Zone flags** — the SDK knows 1 (bit 0). OpenRGB defines bits up to 24.
//     A zone whose size is manually configurable sets bit 1, so `zoneFlags`
//     of 2 is enough. Any resizable ARGB header or fan hub does this, which
//     is why an ASUS/Lian Li machine hit it immediately.
//   - **Device flags** — the SDK knows up to bit 8. OpenRGB defines bits up
//     to 25 (bit 16 "manually configurable name" and friends).
//   - **Mode flags** — the SDK knows bits 0-9. OpenRGB added bit 10, "mode
//     always applies to the entire device".
//
// 0.6.0 is the newest release, so there is no version to upgrade to.
//
// WHAT THIS CHANGES
//
// Two edits per site, and nothing else:
//
//   - `Math.max(0, ...)` so the pad can never go negative.
//   - `.slice(-N)` on the bit string so only the low N bits — the ones the
//     SDK actually has names for — are decoded. Without this, clamping alone
//     would push `undefined` into the flag list for every unknown high bit.
//
// Flags HARE relies on (`perLedColor`, which is how a direct-colour mode is
// found) are all low bits and decode exactly as before. Unknown high bits are
// ignored instead of fatal, which is what should have happened all along.
//
// The exact expected text is asserted before anything is written. If a future
// openrgb-sdk changes these lines, this fails loudly rather than silently
// leaving the crash in place -- a patch that quietly stops applying is worse
// than no patch, because nothing looks wrong until a stranger's PC finds it.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(root, "node_modules", "openrgb-sdk", "dist", "device.js");

/** The marker that says this file has already been repaired. Makes re-running a no-op. */
const MARKER = "/* hare-patched: tolerate unknown flag bits */";

/**
 * Each site, as it appears in the shipped file.
 *
 * `list` is the identifier holding the known-flag names; its `.length` is how
 * many bits have meaning. Matched as exact strings rather than by regex so a
 * rewritten SDK can't be half-patched by a pattern that still happens to fit.
 */
const SITES = [
  { list: "flagsArray", count: 1 },
  { list: "flags", count: 2 },
];

function siteSource(list) {
  return (
    `Array(${list}.length - flagcheck_str.length).concat(flagcheck_str.split("")).reverse()`
  );
}

function siteReplacement(list) {
  return (
    `Array(Math.max(0, ${list}.length - flagcheck_str.length))` +
    `.concat(flagcheck_str.slice(-${list}.length).split("")).reverse()`
  );
}

function fail(...lines) {
  console.error("");
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

if (!existsSync(TARGET)) {
  fail(
    "openrgb-sdk isn't installed, so there's nothing to patch.",
    "Run `npm install` first."
  );
}

let source = readFileSync(TARGET, "utf8");

if (source.includes(MARKER)) {
  console.log("  openrgb-sdk: flag decoding already repaired.");
  process.exit(0);
}

let patched = 0;
for (const { list, count } of SITES) {
  const from = siteSource(list);
  const found = source.split(from).length - 1;
  if (found !== count) {
    fail(
      `openrgb-sdk has changed: expected ${count} use(s) of the ${list} bitfield decoder, found ${found}.`,
      "This patch fixes a crash that otherwise leaves every user with zero devices,",
      "so it refuses to apply half of itself.",
      "",
      `Check ${path.relative(root, TARGET)} and update scripts/patch-openrgb-sdk.mjs to match.`
    );
  }
  source = source.split(from).join(siteReplacement(list));
  patched += found;
}

writeFileSync(TARGET, `${MARKER}\n${source}`, "utf8");
console.log(`  openrgb-sdk: flag decoding repaired at ${patched} site(s) — unknown flag bits are now ignored, not fatal.`);
