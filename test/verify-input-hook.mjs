// The global input hook, and the promise that it can't take HARE down.
//
// WHY THIS EXISTS
//
// `uIOhook.start()` can call `abort()` from native C++ code. That is not a
// throwable exception — no try/catch reaches it — and it kills whatever
// process it runs in. It has actually happened in this project's Linux
// sandbox. The hook therefore runs in a child process, and this suite drives
// that supervision logic with a fake child so the crash paths can be
// exercised without needing a real one.
//
// The property under test is simple and worth stating plainly: **a crash in
// an optional lighting effect must never end the app.**
import {
  setInputHookFork,
  startGlobalInputHook,
  stopGlobalInputHook,
  isGlobalInputHookActive,
  globalInputHookProblem,
  resetGlobalInputHook,
} from "../dist-electron/backend/inputHook.js";
import { computeEffectFrame } from "../dist-electron/backend/effectsEngine.js";
import { EventEmitter } from "node:events";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stands in for the forked host process. */
class FakeHost extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.killed = false;
  }
  send(message) {
    this.sent.push(message);
  }
  kill() {
    this.killed = true;
  }
  /** Simulates the native abort() this whole design exists for. */
  crash() {
    this.emit("exit", null, "SIGABRT");
  }
  quit() {
    this.emit("exit", 0, null);
  }
}

console.log("Global input hook supervision...\n");

// --- It is isolated at all -------------------------------------------------
{
  const source = readFileSync("electron/backend/inputHook.ts", "utf8");
  check("the hook is forked rather than loaded in-process", source.includes("fork("));
  check(
    "the host script ships with the build",
    existsSync("dist-electron/backend/inputHookHost.cjs") &&
      readFileSync("scripts/build-preload.mjs", "utf8").includes("inputHookHost.cjs")
  );
  check(
    "the main process no longer imports the native module directly",
    !source.includes('import("uiohook-napi")')
  );
}

// --- A crash is survived, then given up on --------------------------------
{
  resetGlobalInputHook();
  const hosts = [];
  setInputHookFork(() => {
    const host = new FakeHost();
    hosts.push(host);
    return host;
  });

  await startGlobalInputHook();
  check("starting the effect starts the hook", isGlobalInputHookActive() && hosts.length === 1);

  hosts[0].crash();
  await sleep(10);
  check("a native crash is survived and the hook restarted", hosts.length === 2 && isGlobalInputHookActive());

  hosts[1].crash();
  await sleep(10);
  check("a second crash restarts it once more", hosts.length === 3);

  hosts[2].crash();
  await sleep(10);
  check("a hook that keeps crashing is given up on rather than respawned forever", hosts.length === 3);
  check("...and the reason is recorded", (globalInputHookProblem() ?? "").includes("crashing"));
  check("...and it isn't running", !isGlobalInputHookActive());

  // Once given up on, asking again must not start a new crash loop.
  await startGlobalInputHook();
  check("starting again after giving up does nothing", hosts.length === 3);
}

// --- A platform that simply can't do it -----------------------------------
{
  resetGlobalInputHook();
  const hosts = [];
  setInputHookFork(() => {
    const host = new FakeHost();
    hosts.push(host);
    return host;
  });

  await startGlobalInputHook();
  hosts[0].emit("message", { type: "unavailable", reason: "no native binary for this platform" });
  hosts[0].quit();
  await sleep(10);
  check("an unsupported platform is not treated as a crash", hosts.length === 1);
  check("...and the reason is kept for the log", (globalInputHookProblem() ?? "").includes("native binary"));
}

// --- Input actually reaches the effect ------------------------------------
{
  resetGlobalInputHook();
  const hosts = [];
  setInputHookFork(() => {
    const host = new FakeHost();
    hosts.push(host);
    return host;
  });
  await startGlobalInputHook();

  const assignment = {
    deviceId: 1,
    zoneId: null,
    effectId: "reactive",
    color: { r: 255, g: 255, b: 255 },
    speed: 50,
    brightness: 100,
  };

  const idle = computeEffectFrame(assignment, 4, 0)[0];
  hosts[0].emit("message", { type: "input" });
  const flashed = computeEffectFrame(assignment, 4, 0)[0];
  check(
    "a keystroke in the child process lights up the Reactive effect",
    flashed.r > idle.r
  );
}

// --- Stopping releases the hook cleanly -----------------------------------
{
  resetGlobalInputHook();
  const hosts = [];
  setInputHookFork(() => {
    const host = new FakeHost();
    hosts.push(host);
    return host;
  });
  await startGlobalInputHook();
  stopGlobalInputHook();

  check("stopping asks the host to release the OS hook first", hosts[0].sent.some((m) => m.type === "stop"));
  check("...rather than killing it outright", !hosts[0].killed);
  check("...and the hook is immediately considered stopped", !isGlobalInputHookActive());

  stopGlobalInputHook();
  check("stopping twice is harmless", true);
}

setInputHookFork(null);
resetGlobalInputHook();

console.log("");
if (failures > 0) {
  console.error(`ALL_INPUT_HOOK_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_INPUT_HOOK_CHECKS_PASSED");
process.exit(0);
