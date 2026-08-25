import { desktopCapturer } from "electron";
import { sampleBands, SAMPLE_WIDTH, SAMPLE_HEIGHT, BAND_COUNT } from "./ambientSampling.js";
import type { KLColor } from "./types.js";

/**
 * Samples what's on screen and hands the result to the Screen Sync effect.
 *
 * It reports **a row of colours across the screen**, not one average. That
 * difference is what separates real bias lighting from a lamp that changes
 * colour: a strip behind the monitor should show what's on the left of the
 * screen on its left, and a dark scene with one bright corner should light
 * that corner, not wash everything in the muddy average of the two. Devices
 * with a single LED still get the average, so nothing is lost.
 *
 * Runs entirely in the main process via Electron's desktopCapturer thumbnail
 * API. Unlike Music Reactive (see src/lib/musicReactive.ts), this needs no
 * renderer involvement, no getUserMedia permission prompt, and keeps working
 * even while HARE is minimized to the tray — desktopCapturer thumbnails are
 * generated from the compositor, not a visible window.
 */
export class AmbientSyncController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Guards against overlapping samples if a capture ever takes longer than one tick interval. */
  private sampling = false;

  /** Which screen to sample, by index into what the compositor reports. */
  private displayIndex = 0;

  constructor(
    private onSample: (bands: KLColor[]) => void,
    private fps = 8,
    /**
     * Told when capture starts failing, and when it recovers.
     *
     * Screen capture can be refused — by Windows, or by security software
     * that treats it as screen recording. Every failure used to be a console
     * warning, so the effect stayed selected, the lights held their last
     * colour, and nothing anywhere said why.
     */
    private onProblem: (reason: string | null) => void = () => {}
  ) {}

  /**
   * Chooses which monitor to follow.
   *
   * On a multi-monitor PC the primary screen is often not the one being
   * watched, and sampling the wrong one makes the whole feature look broken.
   */
  setDisplayIndex(index: number): void {
    this.displayIndex = Math.max(0, Math.floor(index));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.sampleOnce(), Math.round(1000 / this.fps));
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private async sampleOnce(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      // Still a tiny thumbnail: wide enough to tell one side of the screen
      // from the other, small enough that asking the compositor for it eight
      // times a second costs almost nothing.
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT },
      });
      // Falls back to the first screen if the chosen one has been unplugged,
      // rather than going dark with no explanation.
      const screen = sources[this.displayIndex] ?? sources[0];
      if (!screen || screen.thumbnail.isEmpty()) {
        this.onProblem("Windows returned no screen to sample. Ambient Glow needs a screen it's allowed to read.");
        return;
      }
      const size = screen.thumbnail.getSize();
      this.onSample(sampleBands(screen.thumbnail.toBitmap(), size, BAND_COUNT));
      this.onProblem(null);
    } catch (err) {
      // Non-fatal — most likely screen-recording permission hasn't been
      // granted yet on this PC (macOS-style prompts aside, some Windows
      // security software gates this too). Ambient Sync just stays idle
      // until the next successful sample instead of crashing HARE.
      console.warn("[HARE] Ambient sync sample failed:", err);
      this.onProblem(
        "HARE can't read the screen. Security software often blocks screen capture — allowing it for HARE fixes this."
      );
    } finally {
      this.sampling = false;
    }
  }
}
