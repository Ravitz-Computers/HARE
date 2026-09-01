/**
 * Counts how many things in one window want sensor readings.
 *
 * WHY THIS IS A COUNT AND NOT A FLAG
 *
 * The main process tracks sensor watching per *window*: the first request from
 * a window takes a claim on the hub, any later one is ignored, and a single
 * release drops it. That is correct for the hub — a closed window must never
 * leave it polling — but it means a window with several independent watchers
 * has to reconcile them itself.
 *
 * One window has four: the cooler-screen redraw loop, the Widgets & Screens
 * panel, the sensor settings page, and the dashboard's sensor widget. They
 * mount and unmount as the user moves around. Without a count, opening the
 * screen panel and leaving it sent one release that dropped the claim the
 * redraw loop was relying on, and polling stopped. Nothing failed visibly:
 * the cooler kept being redrawn from a snapshot that never changed again, so
 * every reading on it showed a dash until HARE was restarted.
 *
 * Lives here rather than beside the store so it can be tested on its own, and
 * so the rule it encodes sits next to the hub whose contract it exists for.
 */
export interface ClaimCounter {
  /**
   * Records a watcher arriving or leaving, and answers whether the main
   * process needs telling: true only on the first arrival and the last
   * departure.
   */
  change(wanting: boolean): boolean;
  readonly count: number;
}

export function createClaimCounter(): ClaimCounter {
  let count = 0;
  return {
    change(wanting: boolean): boolean {
      if (wanting) {
        count++;
        return count === 1;
      }
      // A release with nothing held is not an error worth throwing over —
      // React re-runs cleanups in development, and a window reload starts the
      // count from zero while the main process still holds its claim. Either
      // way, sending a stop nobody asked for would switch off a source
      // something else is using.
      if (count === 0) return false;
      count--;
      return count === 0;
    },
    get count(): number {
      return count;
    },
  };
}
