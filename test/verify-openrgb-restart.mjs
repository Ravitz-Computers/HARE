// Restarting the OpenRGB server.
//
// WHY THIS EXISTS
//
// The state this exists for is OpenRGB still being *connected* but no longer
// doing anything. HARE reports a healthy connection, the device list looks
// right, and nothing lights up. Before this the only way out was closing HARE,
// finding OpenRGB.exe in Task Manager, killing it, and starting again.
//
// The reason it needs a test rather than a button is that there are three
// genuinely different situations behind one word, and the naive version gets
// two of them badly wrong:
//
//   - **HARE started the server.** Stop it, wait for the port, start it again.
//   - **The elevated logon task started it.** HARE runs unelevated on purpose,
//     so it cannot kill that process at all. Killing the *port holder* is not
//     an option either; the task has to be ended and re-run.
//   - **Somebody is running OpenRGB themselves,** with their own window open.
//     Killing it would make their application vanish from under them. HARE
//     must not touch it.
//
// And in every case, relaunching before the port is actually free produces a
// second server that binds nothing and reports no devices -- which looks
// exactly like the fault being restarted.
import { existsSync, readFileSync } from "node:fs";

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

console.log("Restarting OpenRGB...\n");

const backend = read("electron/backend/openrgbBackend.ts");
const manager = read("electron/backend/backendManager.ts");
const main = read("electron/main.ts");
const elevation = read("electron/backend/elevationHelper.ts");

// --- HARE only stops what it started ---------------------------------------
{
  check("the backend knows whether the running server is its own", backend.includes("get ownsServer"));
  check(
    "...which is whether HARE has a process for it, not a guess",
    /get ownsServer\(\): boolean \{\s*return this\.spawnedProcess !== null;/.test(backend)
  );
  check("there is a stop that only stops HARE's own server", backend.includes("async stopOwnServer"));
  check(
    "the manager refuses to restart a server it doesn't own",
    /if \(!live \|\| !owned\) return \{ stopped: false, owned \};/.test(manager)
  );
}

// --- The port has to be free before starting again -------------------------
{
  check(
    "stopping waits for the port to actually free up",
    /while \(Date\.now\(\) < deadline\)[\s\S]{0,200}isServerAlreadyRunning/.test(backend)
  );
  check(
    "...and reports failure rather than starting into a held port",
    /return false;\s*\}\s*\n\s*async isServerAlreadyRunning/.test(backend)
  );
  check(
    "the elevated path waits too, between ending the task and running it",
    /schtasks\.exe", \["\/End"[\s\S]{0,400}setTimeout[\s\S]{0,120}startNow/.test(elevation)
  );
}

// --- The three cases are all handled, and all reported ---------------------
{
  check("there is a restart handler", main.includes("IPC.RESTART_OPENRGB"));
  check(
    "case 1: HARE's own server is stopped and started",
    /manager\.restartOwnServer\(\)/.test(main)
  );
  check(
    "case 2: an elevated server is restarted through the task, not killed",
    /elevation\.isEnabled\(\)[\s\S]{0,300}elevation\.restartServer\(\)/.test(main)
  );
  check("...and that path exists", elevation.includes("async restartServer"));
  check(
    "case 3: someone else's OpenRGB is left running",
    /wasn't started by HARE, so it was left running/.test(main)
  );
  check(
    "...and HARE reconnects to it instead of doing nothing",
    /manager\.reconnect\(\)/.test(main) && manager.includes("async reconnect")
  );
  check(
    "every outcome says what happened, rather than a bare ok/failed",
    (main.match(/message: `?["`]?/g) ?? []).length > 3 && /found\("found"\)/.test(main)
  );
  check(
    "a thrown error is reported rather than left to reject across the bridge",
    /catch \(err\)[\s\S]{0,200}ok: false/.test(main)
  );
}

// --- It's reachable, and it's where the other troubleshooting is -----------
{
  const settings = read("src/pages/Settings.tsx");
  check("the button exists", settings.includes("Restart OpenRGB"));
  check(
    "...in the panel about lighting not changing, which is when it's wanted",
    settings.indexOf("Lighting Not Changing?") < settings.indexOf("Restart OpenRGB")
  );
  check("...and can't be pressed twice while it's working", settings.includes("disabled={restarting}"));
  check("...saying what it will do before it's pressed", /title="Stops OpenRGB and starts it again/.test(settings));
  check(
    "the result reaches the person, not just the console",
    /notify\(result\.ok \? "ok" : "error", result\.message\)/.test(settings)
  );

  check("it's plumbed through the bridge", read("electron/preload.ts").includes("restartOpenRgb"));
  check(
    "...and the device list is re-read afterwards, since it almost always changed",
    /restartOpenRgb: async[\s\S]{0,300}getState\(\)/.test(read("src/state/store.ts"))
  );
}

// --- Saved lighting comes back ---------------------------------------------
// A restart that leaves every device dark has traded one broken state for
// another. `start()` is what re-runs the restore, which is why the restart
// goes through it rather than reconnecting the socket by hand.
{
  check(
    "restarting goes through the same start path that restores saved lighting",
    /if \(stopped\) await this\.start\(\);/.test(manager)
  );
  check(
    "...and that path is what restores it",
    /restoreSavedLighting\(\)/.test(manager)
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_OPENRGB_RESTART_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_OPENRGB_RESTART_CHECKS_PASSED");
