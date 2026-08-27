/**
 * One shared animation clock for every on-screen lighting preview.
 *
 * The Effects page shows a live swatch for all 18 effects at once, and each
 * one used to drive itself with its own `setInterval`. That meant ~18 timers
 * all waking independently, all recomputing, all triggering their own React
 * render — and, worse, all of it continuing while HARE sat minimised in the
 * tray with nothing on screen to look at.
 *
 * This replaces them with a single `requestAnimationFrame` loop:
 *
 *   - **One timer, not N.** Subscribers are called from the same frame, so
 *     the cost is one wake-up regardless of how many previews are visible.
 *   - **It stops when nothing is subscribed.** No idle loop.
 *   - **It stops when the window isn't visible.** rAF is throttled hard and
 *     usually suspended outright by the browser when a window is hidden or
 *     minimised, so a tray-minimised HARE does no preview work at all. That
 *     falls out of using rAF rather than a timer, and the explicit
 *     visibility check below makes it certain rather than incidental.
 *
 * Note this is deliberately only for *previews*. The real effect loop lives
 * in the main process and must keep running while HARE is hidden — that's the
 * entire point of minimising to tray with your lighting still on.
 */

type Tick = (elapsedMs: number) => void;

const TARGET_FPS = 24;
const FRAME_MS = 1000 / TARGET_FPS;

const subscribers = new Set<Tick>();
let rafId: number | null = null;
let lastFrameAt = 0;
let startedAt = 0;

function frame(now: number) {
  rafId = null;
  if (subscribers.size === 0) return;

  // Throttle to the target rate. Previews at 24fps look identical to 60 and
  // cost less than half as much to compute.
  if (now - lastFrameAt >= FRAME_MS) {
    lastFrameAt = now;
    const elapsed = now - startedAt;
    for (const tick of subscribers) {
      try {
        tick(elapsed);
      } catch {
        // One misbehaving preview must not stop every other one animating.
      }
    }
  }
  schedule();
}

function schedule() {
  if (rafId !== null || subscribers.size === 0) return;
  if (typeof document !== "undefined" && document.hidden) return;
  rafId = requestAnimationFrame(frame);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    } else {
      schedule();
    }
  });
}

/** Subscribes to the shared clock. Returns an unsubscribe function. */
export function subscribeToPreviewTicker(tick: Tick): () => void {
  if (subscribers.size === 0) {
    startedAt = performance.now();
    lastFrameAt = 0;
  }
  subscribers.add(tick);
  schedule();
  return () => {
    subscribers.delete(tick);
    if (subscribers.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

/** Test/diagnostic hook: how many previews are currently animating. */
export function previewTickerSubscriberCount(): number {
  return subscribers.size;
}
