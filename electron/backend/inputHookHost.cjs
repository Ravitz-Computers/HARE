/**
 * Hosts the global input hook in a process of its own.
 *
 * This file exists because of one specific failure: `uIOhook.start()` can call
 * `abort()` from native C++ code. That is not a JavaScript exception — no
 * try/catch anywhere can stop it — and it takes down whatever process it runs
 * in. It has actually happened in this project's Linux sandbox, where there
 * is no X11 display to hook.
 *
 * Windows uses SetWindowsHookEx and shouldn't hit that particular case, but
 * "shouldn't" is not a safety property. A native crash in a lighting effect
 * must never be able to kill an app whose whole promise is that it keeps your
 * lighting on and stays out of the way. So the hook lives here, and if this
 * process dies, HARE notices and carries on without it.
 *
 * Deliberately CommonJS: it is forked with ELECTRON_RUN_AS_NODE, and a
 * `.cjs` file loads the same way whether or not the surrounding package is a
 * module.
 */
let uIOhook;
try {
  ({ uIOhook } = require("uiohook-napi"));
} catch (err) {
  // No native binary for this platform. Exiting cleanly tells the parent this
  // is permanent rather than a crash worth retrying.
  process.send?.({ type: "unavailable", reason: String(err && err.message ? err.message : err) });
  process.exit(0);
}

/**
 * Input events are coalesced before being sent.
 *
 * The Reactive effect only cares *that* input happened, not how much: it
 * flashes and decays over ~350ms. Someone typing quickly generates far more
 * events than that needs, and forwarding every one would be pure IPC traffic
 * for no visible difference.
 */
const MIN_GAP_MS = 40;
let lastSentAt = 0;

function report() {
  const now = Date.now();
  if (now - lastSentAt < MIN_GAP_MS) return;
  lastSentAt = now;
  process.send?.({ type: "input" });
}

try {
  uIOhook.on("keydown", report);
  uIOhook.on("mousedown", report);
  uIOhook.on("wheel", report);
  uIOhook.start();
  process.send?.({ type: "started" });
} catch (err) {
  process.send?.({ type: "unavailable", reason: String(err && err.message ? err.message : err) });
  process.exit(0);
}

// The parent asks for a clean shutdown before killing anything, so the OS
// hook is released properly rather than torn down with the process.
process.on("message", (message) => {
  if (message && message.type === "stop") {
    try {
      uIOhook.stop();
    } catch {
      // Shutting down anyway.
    }
    process.exit(0);
  }
});
