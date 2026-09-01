// The bus guard: HARE declining to start a hardware scan next to another
// RGB application.
//
// WHY THIS EXISTS
//
// Motherboard, RAM and GPU lighting runs over SMBus, and SMBus tolerates one
// master at a time. Two programs sweeping it at once is the documented way to
// put a controller into an invalid state — and on DDR5 it is the shape of an
// open OpenRGB report where a stick's SPD EEPROM ends up corrupted and the
// machine stops booting. That is not a flicker; it is hardware that has to be
// replaced.
//
// Three things have to stay true for the guard to be worth anything, and each
// of them is easy to undo by accident:
//
//   1. **It guards the scan, not the colour writes.** Colour goes to devices
//      that were already found. Starting OpenRGB is what sweeps the bus. A
//      guard on the wrong operation would cost functionality and protect
//      nothing.
//   2. **It doesn't gate joining a server that's already running.** That scan
//      already happened. Refusing there would break the elevated-logon-task
//      setup and the "user runs OpenRGB themselves" case for no benefit.
//   3. **It is overridable.** It is a warning, not a lock. A false positive —
//      a process name that matches something innocent — must never leave
//      somebody permanently unable to find their hardware.
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

console.log("SMBus scan guard...\n");

const conflicts = read("electron/backend/vendors/smbusConflicts.ts");
const backend = read("electron/backend/openrgbBackend.ts");
const manager = read("electron/backend/backendManager.ts");
const main = read("electron/main.ts");
const dashboard = read("src/pages/Dashboard.tsx");

// --- 1. The guard is on the scan, and only the scan ------------------------
{
  check("there is a gate to ask before scanning", conflicts.includes("export async function scanBlockedBy"));
  check(
    "...and the backend asks it before starting OpenRGB",
    /beforeSpawn/.test(backend) && /const refusal = this\.opts\.beforeSpawn/.test(backend)
  );
  check(
    "...the manager supplies it",
    /beforeSpawn: async \(\)/.test(manager) && manager.includes("scanBlockedBy()")
  );

  // The refusal has to happen before spawn(), not after. Ordering is the
  // whole safeguard: a check that runs after OpenRGB has already started has
  // already let the sweep happen.
  const spawnIndex = backend.indexOf('spawn(exe, ["--server"');
  const refusalIndex = backend.indexOf("const refusal = this.opts.beforeSpawn");
  check(
    "...before the process is actually spawned, not after",
    refusalIndex > 0 && spawnIndex > 0 && refusalIndex < spawnIndex
  );

  // Colour writes must not be gated. Guarding those would cost real
  // functionality and protect nothing, since the bus sweep is long over by
  // then.
  check(
    "colour writes are not gated — they aren't what touches the bus",
    !/setDeviceColor[\s\S]{0,600}beforeSpawn/.test(backend) &&
      !/setLedColors[\s\S]{0,600}scanBlockedBy/.test(backend)
  );
}

// --- 2. An already-running server is joined, not refused -------------------
{
  // isServerAlreadyRunning() returns before the guard is consulted. If that
  // ordering ever flips, HARE stops working with the elevated logon task and
  // with an OpenRGB the user runs themselves — both supported setups.
  const alreadyRunning = backend.indexOf("if (await this.isServerAlreadyRunning()) return;");
  const refusalIndex = backend.indexOf("const refusal = this.opts.beforeSpawn");
  check(
    "a server that is already up is joined without being gated",
    alreadyRunning > 0 && refusalIndex > alreadyRunning
  );
}

// --- 3. The refusal says what to do, and can be overridden -----------------
{
  check(
    "the refusal names the program to close",
    conflicts.includes("export function conflictMessage") && /Close /.test(conflicts)
  );
  check(
    "a refused scan reports which apps blocked it, rather than an empty device list",
    /blockedBy/.test(main) && /RescanResult/.test(read("electron/backend/types.ts"))
  );
  check(
    "the user can override it",
    /rescan\(force = false\)/.test(manager) && /if \(!force\)/.test(manager)
  );
  check(
    "...and the override is reachable from the UI, not just the API",
    /rescan\(true\)/.test(dashboard) && /Scan anyway/.test(dashboard)
  );
  check(
    "a refused scan is shown differently from the ordinary hint",
    /scanBlockedBy\.length > 0/.test(dashboard) &&
      /scanBlockedBy\.length === 0 && conflicts\.length > 0/.test(dashboard)
  );
}

// --- 4. Nothing here can throw -------------------------------------------
// A guard that crashes is worse than no guard: it would take out the one path
// that finds hardware at all. detectConflicts() is documented as never
// throwing, and the spawn path has to keep that promise.
{
  check(
    "conflict detection is documented as never throwing",
    /Never throws/.test(conflicts)
  );
  check(
    "a refusal is reported as itself, not as a connection failure",
    /if \(this\.spawnRefusal\)/.test(backend) && /throw new Error\(this\.spawnRefusal\)/.test(backend)
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_SCAN_GUARD_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_SCAN_GUARD_CHECKS_PASSED");
