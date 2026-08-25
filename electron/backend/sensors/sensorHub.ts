import {
  EMPTY_SNAPSHOT,
  type SensorProvider,
  type SensorReading,
  type SensorSnapshot,
  type SensorSourceStatus,
} from "./sensorTypes.js";

/**
 * Collects readings from every sensor provider — but only while something is
 * actually looking at them.
 *
 * That last part is the whole point. Polling hardware costs real CPU, and one
 * of the providers keeps a child process alive to do its job. HARE spends
 * most of its life minimised in the tray with nobody watching anything, so
 * the hub is reference-counted: the first watcher starts the timer and probes
 * the providers, the last one to leave stops the timer and disposes of
 * everything held open. Nothing polls in the background "just in case".
 *
 * This is the same rule the screen sampler and the global input hook follow —
 * pay for a capability only while it's genuinely in use.
 */
export class SensorHub {
  private providers: SensorProvider[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchers = 0;
  private snapshot: SensorSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<(snapshot: SensorSnapshot) => void>();
  private status = new Map<string, SensorSourceStatus>();
  private lastReadAt = new Map<string, number>();
  private lastReadings = new Map<string, SensorReading[]>();
  private polling = false;
  /** True between the first watcher arriving and the timer being installed. */
  private starting = false;

  constructor(
    providers: SensorProvider[],
    private readonly intervalMs = 2000,
    private readonly now: () => number = () => Date.now()
  ) {
    this.providers = providers;
  }

  getSnapshot(): SensorSnapshot {
    return this.snapshot;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** How many things are currently watching. Exposed for tests and diagnostics. */
  get watcherCount(): number {
    return this.watchers;
  }

  onSnapshot(cb: (snapshot: SensorSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Registers a watcher and returns the function that removes it. The first
   * call starts polling; the last release stops it.
   */
  watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) void this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) void this.stop();
    };
  }

  private async start(): Promise<void> {
    if (this.timer || this.starting) return;
    this.starting = true;
    try {
      await this.probeAll();
      // Probing takes real time (one source waits for a child process to
      // produce its first line), and the watcher can be gone by the time it
      // finishes — a dashboard closed a moment after opening. Installing the
      // timer anyway would leave the hub polling forever with nobody
      // watching, which is precisely what this design exists to prevent.
      if (this.watchers === 0) {
        await this.stop();
        return;
      }
      // Polls immediately so the first frame of UI has real numbers rather
      // than a placeholder that corrects itself two seconds later.
      void this.poll();
      this.timer = setInterval(() => void this.poll(), this.intervalMs);
      // Never hold the process open on this alone.
      this.timer.unref?.();
    } finally {
      this.starting = false;
    }
  }

  private async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastReadAt.clear();
    this.lastReadings.clear();
    for (const provider of this.providers) {
      try {
        await provider.dispose?.();
      } catch (err) {
        console.warn(`[HARE] Sensor source ${provider.id} didn't shut down cleanly:`, err);
      }
    }
  }

  /** Re-runs every provider's capability check — for after the user installs one of the things a source needs. */
  async refresh(): Promise<SensorSnapshot> {
    await this.probeAll();
    await this.poll();
    return this.snapshot;
  }

  private async probeAll(): Promise<void> {
    await Promise.all(
      this.providers.map(async (provider) => {
        try {
          const result = await provider.probe();
          this.status.set(provider.id, {
            id: provider.id,
            name: provider.name,
            available: result.available,
            detail: result.detail,
          });
        } catch (err) {
          this.status.set(provider.id, {
            id: provider.id,
            name: provider.name,
            available: false,
            detail: describe(err),
          });
        }
      })
    );
    this.emit();
  }

  private async poll(): Promise<void> {
    // A slow provider must never cause two polls to overlap and stack up.
    if (this.polling) return;
    this.polling = true;
    try {
      const now = this.now();
      await Promise.all(
        this.providers.map(async (provider) => {
          if (this.status.get(provider.id)?.available === false) return;

          // Providers that are slower, or that briefly claim a USB device
          // another app might want, read less often than the rest.
          const minGap = provider.minIntervalMs ?? 0;
          const last = this.lastReadAt.get(provider.id) ?? -Infinity;
          if (minGap > 0 && now - last < minGap) return;

          try {
            const readings = await provider.read();
            this.lastReadAt.set(provider.id, now);
            this.lastReadings.set(provider.id, readings);
          } catch (err) {
            // One failing source degrades to "that source stopped reporting",
            // never to a failed snapshot.
            this.lastReadings.set(provider.id, []);
            this.status.set(provider.id, {
              id: provider.id,
              name: provider.name,
              available: false,
              detail: describe(err),
            });
          }
        })
      );
      this.snapshot = {
        readings: this.collectReadings(),
        sources: [...this.status.values()],
        updatedAt: new Date(this.now()).toISOString(),
      };
      this.emit();
    } finally {
      this.polling = false;
    }
  }

  /**
   * Flattens every provider's readings, dropping duplicates.
   *
   * Sources overlap on purpose — someone running LibreHardwareMonitor gets
   * GPU temperature from both it and NVML. Whichever provider appears first
   * in the list wins, so the ordering in main.ts is a preference order:
   * direct sources before bridged ones.
   */
  private collectReadings(): SensorReading[] {
    const out: SensorReading[] = [];
    const seen = new Set<string>();
    for (const provider of this.providers) {
      for (const reading of this.lastReadings.get(provider.id) ?? []) {
        const key = `${reading.kind}:${reading.label.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(reading);
      }
    }
    return out;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // A broken listener must not stop the others being told.
      }
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
