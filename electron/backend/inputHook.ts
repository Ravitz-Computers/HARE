import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportInputActivity } from "./effectsEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The global (OS-level) keyboard and mouse hook that drives the Reactive
 * effect — run in a child process, on purpose.
 *
 * WHY A WHOLE PROCESS FOR THIS
 *
 * `uIOhook.start()` can call `abort()` from native C++ code. That is not a
 * throwable exception; no try/catch can catch it, and it takes down whatever
 * process it runs in. It has genuinely happened here — in the Linux sandbox
 * this project is developed in, where there is no X11 display to hook.
 *
 * Windows uses SetWindowsHookEx and shouldn't hit that case. But an app whose
 * entire promise is "it keeps your lighting on and stays out of the way"
 * cannot have one optional effect that is capable of killing it, on a
 * "shouldn't" rather than a "can't". So the hook is isolated: if it dies,
 * HARE logs it, the Reactive effect falls back to its idle glow, and
 * everything else carries on.
 *
 * It also only runs while some device actually has Reactive assigned. A
 * global input hook is the same technique a keylogger uses, so some antivirus
 * software flags it heuristically — running it only when genuinely in use
 * keeps that surface as small as it can be.
 */

/** How many times a crashing hook is restarted before HARE stops trying. */
const MAX_RESTARTS = 2;
/** A host that survives this long is considered healthy, so its restart budget resets. */
const HEALTHY_MS = 30_000;

type ForkLike = (modulePath: string) => ChildProcess;

let child: ChildProcess | null = null;
let restarts = 0;
let startedAt = 0;
let unavailableReason: string | null = null;
let forkImpl: ForkLike = defaultFork;

function defaultFork(modulePath: string): ChildProcess {
  return fork(modulePath, [], {
    // Electron's own binary runs as plain Node with this set, so there is no
    // second Node runtime to ship or find.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    // No console window flashes up: the child inherits Electron's own
    // windowless behaviour when run as Node.
    silent: false,
  });
}

/** Test seam: swap in a fake process launcher. */
export function setInputHookFork(impl: ForkLike | null): void {
  forkImpl = impl ?? defaultFork;
}

function hostPath(): string {
  return path.join(__dirname, "inputHookHost.cjs");
}

export async function startGlobalInputHook(): Promise<void> {
  if (child || unavailableReason) return;
  spawnHost();
}

function spawnHost(): void {
  try {
    child = forkImpl(hostPath());
  } catch (err) {
    // Couldn't even start it: treat as permanently unavailable rather than
    // retrying forever.
    unavailableReason = err instanceof Error ? err.message : String(err);
    console.warn("[HARE] Reactive effect can't start its input hook:", unavailableReason);
    child = null;
    return;
  }
  startedAt = Date.now();

  child.on("message", (message: { type?: string; reason?: string }) => {
    if (message?.type === "input") reportInputActivity();
    else if (message?.type === "unavailable") {
      // The host said this platform can't do it at all. Not a crash, so not
      // worth a restart.
      unavailableReason = message.reason ?? "not available on this PC";
      console.warn("[HARE] Reactive effect will idle instead of responding to input:", unavailableReason);
    }
  });

  child.on("error", (err) => {
    console.warn("[HARE] Input hook process error:", err);
  });

  child.on("exit", (code, signal) => {
    const wasRunning = child;
    child = null;
    if (!wasRunning || unavailableReason) return;

    // A clean exit is the stop path, and needs no comment.
    if (code === 0 && !signal) return;

    // A crash. This is the case the whole child process exists for: HARE is
    // still alive to see it.
    const lived = Date.now() - startedAt;
    if (lived > HEALTHY_MS) restarts = 0;
    if (restarts >= MAX_RESTARTS) {
      unavailableReason = "the input hook keeps crashing";
      console.warn("[HARE] Giving up on the input hook after repeated crashes — Reactive will idle.");
      return;
    }
    restarts++;
    console.warn(`[HARE] Input hook stopped unexpectedly (${signal ?? code}); restarting.`);
    spawnHost();
  });
}

export function stopGlobalInputHook(): void {
  const running = child;
  child = null;
  if (!running) return;
  try {
    // Asked to stop first, so the OS hook is released rather than torn down
    // with the process; killed only if it doesn't go.
    running.send?.({ type: "stop" });
    setTimeout(() => {
      try {
        if (!running.killed) running.kill();
      } catch {
        /* already gone */
      }
    }, 250).unref?.();
  } catch {
    try {
      running.kill();
    } catch {
      /* already gone */
    }
  }
}

export function isGlobalInputHookActive(): boolean {
  return child !== null;
}

/** Why the hook isn't running, when it isn't. Null while it's fine. */
export function globalInputHookProblem(): string | null {
  return unavailableReason;
}

/** Test-only: forget that the hook was declared unavailable. */
export function resetGlobalInputHook(): void {
  unavailableReason = null;
  restarts = 0;
  child = null;
}
