/**
 * Turning an audio spectrum into something lighting can use.
 *
 * Music Reactive used to report a single loudness number, so every effect
 * could do was pulse with volume: bass and treble were indistinguishable, and
 * nothing could land on a beat. These functions add the two things that
 * change — a handful of frequency bands, and a beat flag — and they live here,
 * apart from the Web Audio code that feeds them, because the maths is where
 * the mistakes are and this way it can be tested directly.
 */

/**
 * How many bands the spectrum is reduced to.
 *
 * Few enough to map onto a device with a handful of LEDs, and to keep the IPC
 * message small at ~30 a second. More bands would be more precise and less
 * legible: nobody can see sixty-fourths of a spectrum on an LED strip.
 */
export const BAND_COUNT = 8;

/**
 * Groups FFT bins into bands on a logarithmic scale.
 *
 * Linear bins would put almost everything musical into the first two bands —
 * an octave near the bottom of human hearing spans a few dozen hertz, one
 * near the top spans thousands. Splitting logarithmically is what makes the
 * bass band respond to bass and the treble band respond to treble, which is
 * the entire point of having bands at all.
 */
export function bandEdges(binCount: number, bands = BAND_COUNT): number[] {
  const edges: number[] = [0];
  for (let i = 1; i <= bands; i++) {
    // Starts at bin 1: bin 0 is DC, which carries no signal and would drag the
    // bass band toward silence.
    const fraction = i / bands;
    edges.push(Math.min(binCount, Math.max(edges[i - 1] + 1, Math.round(binCount ** fraction))));
  }
  return edges;
}

/** Averages each band's bins into a 0-1 level. */
export function computeBands(spectrum: Uint8Array | number[], bands = BAND_COUNT): number[] {
  const binCount = spectrum.length;
  if (binCount === 0) return new Array(bands).fill(0);
  const edges = bandEdges(binCount, bands);
  const out: number[] = [];

  for (let band = 0; band < bands; band++) {
    const from = edges[band];
    const to = Math.max(from + 1, edges[band + 1]);
    let total = 0;
    let count = 0;
    for (let bin = from; bin < to && bin < binCount; bin++) {
      total += spectrum[bin];
      count++;
    }
    // Byte spectrum data is 0-255. Scaled up because music rarely fills the
    // range, and a band that never passes half is a band that never looks
    // like it is doing anything.
    out.push(count === 0 ? 0 : Math.min(1, total / count / 180));
  }
  return out;
}

/**
 * Detects a beat as a sudden jump in bass energy.
 *
 * Compared against a rolling average rather than a fixed threshold, because
 * "loud" is relative: quiet music has beats too, and a fixed threshold either
 * misses them or fires continuously on loud music. The floor stops silence
 * and hiss registering as a rhythm.
 */
export class BeatDetector {
  private history: number[] = [];

  constructor(
    private readonly windowSize = 24,
    private readonly sensitivity = 1.35,
    private readonly floor = 0.08
  ) {}

  /** True when this sample is a beat. */
  push(bassLevel: number): boolean {
    const average =
      this.history.length === 0
        ? 0
        : this.history.reduce((sum, value) => sum + value, 0) / this.history.length;

    this.history.push(bassLevel);
    if (this.history.length > this.windowSize) this.history.shift();

    // A full window is needed before anything counts, or the first loud
    // sample after silence always reads as a beat.
    if (this.history.length < this.windowSize) return false;
    return bassLevel > this.floor && bassLevel > average * this.sensitivity;
  }

  reset(): void {
    this.history = [];
  }
}
