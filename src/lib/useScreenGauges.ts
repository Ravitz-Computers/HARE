import { useEffect, useRef } from "react";
import { getHareApi } from "@/lib/hareApi";
import { useHareStore } from "@/state/store";
import { gaugeReading, renderGauge } from "@/lib/screenGauge";
import { renderInfographic } from "@/lib/screenInfographic";
import { tilesFor, type ScreenMetricId } from "@/lib/screenMetrics";
import { screenKey } from "@/lib/screenKey";

/**
 * How often a screen is redrawn.
 *
 * Not as often as the sensors update. Each frame opens the cooler's USB
 * handle, writes a full uncompressed image and closes it again — and the
 * sensor provider that reads liquid temperature wants that same handle. A fast
 * redraw would spend the machine's time fighting itself to animate a number
 * that moves by a degree a minute. Five seconds reads as live and leaves the
 * device alone in between.
 */
const REDRAW_MS = 5000;

/**
 * Decodes a stored background once and keeps it.
 *
 * The picture doesn't change between frames, and decoding a 480x480 image
 * every five seconds for the life of the app is work for nothing. Keyed by the
 * data URL itself, so choosing a different picture replaces it without any
 * invalidation logic to get wrong.
 */
const backgroundCache = new Map<string, HTMLImageElement>();

/**
 * How many failed redraws before a screen is left alone.
 *
 * A screen that can't be drawn on doesn't start working on the ninth attempt.
 * A Galahad II LCD (Vision) that repeats commands back instead of acting on
 * them produced a full open-query-write cycle over USB every five seconds for
 * as long as HARE was running, and forty lines of log a minute saying the same
 * thing. Three is enough to ride out a cooler briefly held by something else;
 * past that it is a fault, not a hiccup.
 */
const GIVE_UP_AFTER = 3;

/**
 * Screens whose redraw kept failing, and what went wrong last.
 *
 * Outside the component: a re-render must not resume hammering a device that
 * has already been given up on. Cleared when HARE restarts, which is also when
 * someone who has just closed the vendor's own software would want it retried.
 */
const givenUp = new Map<string, string>();

/** Consecutive failures per screen, reset by any successful draw. */
const failures = new Map<string, number>();

/**
 * Whether this screen has anything to draw.
 *
 * One predicate, used both to decide whether to go looking for screens at all
 * and to decide which ones to redraw — because two nearly-identical conditions
 * is how "I turned it off and it kept drawing" happens.
 *
 * The cases it has to get right:
 *  - both layers switched off stops the loop, even though `enabled` may still
 *    be true from before the layers existed;
 *  - a background on its own is enough, with no readings ticked;
 *  - and a screen set up before any of this keeps working untouched, which is
 *    the `g.enabled` on the end.
 */
function screenIsLive(g?: {
  enabled?: boolean;
  backgroundEnabled?: boolean;
  infographicEnabled?: boolean;
  background?: string | null;
  metrics?: string[];
}): boolean {
  if (!g) return false;
  const hasBackground = g.backgroundEnabled === true && Boolean(g.background);
  const showsReadings =
    g.infographicEnabled !== false && ((g.metrics?.length ?? 0) > 0 || g.enabled === true);
  return hasBackground || showsReadings;
}

async function loadBackground(dataUrl: string): Promise<HTMLImageElement | null> {
  const cached = backgroundCache.get(dataUrl);
  if (cached) return cached;
  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    // One picture at a time; the previous one is of no further use.
    backgroundCache.clear();
    backgroundCache.set(dataUrl, image);
    return image;
  } catch {
    // A background that won't decode must not stop the readings being drawn.
    return null;
  }
}

/**
 * Keeps every screen that's showing a temperature up to date, for as long as
 * HARE is open.
 *
 * Mounted once at the top of the app rather than inside the panel that has the
 * switch, because a readout that stops the moment you navigate away from its
 * settings page isn't a readout.
 */
export function useScreenGauges() {
  const appSettings = useHareStore((s) => s.appSettings);
  const displayDevices = useHareStore((s) => s.displayDevices);
  const sensors = useHareStore((s) => s.sensors);
  const watchSensors = useHareStore((s) => s.watchSensors);
  const refreshDisplayDevices = useHareStore((s) => s.refreshDisplayDevices);

  // Screens are otherwise only looked for when someone opens Widgets & Screens,
  // which would leave a saved readout blank until they went there. The look
  // only happens when something is actually configured, so a machine with no
  // screen never touches USB for this.
  const configured = Object.values(appSettings.screenGauges).some(screenIsLive);
  useEffect(() => {
    if (configured) void refreshDisplayDevices();
  }, [configured, refreshDisplayDevices]);

  const active = displayDevices.filter(
    (screen) => screen.controllable && screenIsLive(appSettings.screenGauges[screenKey(screen)])
  );
  const wanted = active.length > 0;

  // Sensors are only polled while something is using them, so a live screen
  // holds its own claim — otherwise it draws whatever the last open panel
  // happened to leave behind.
  useEffect(() => {
    if (!wanted) return;
    void watchSensors(true);
    return () => {
      void watchSensors(false);
    };
  }, [wanted, watchSensors]);

  // Read at draw time rather than captured in the timer's closure: otherwise
  // every sensor update would tear down and rebuild the interval, and the
  // screen would redraw far more often than intended.
  const snapshotRef = useRef(sensors);
  snapshotRef.current = sensors;
  const activeRef = useRef(active);
  activeRef.current = active;
  const settingsRef = useRef(appSettings.screenGauges);
  settingsRef.current = appSettings.screenGauges;

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;

    const draw = async () => {
      const api = await getHareApi();
      for (const screen of activeRef.current) {
        if (cancelled) return;
        const key = screenKey(screen);
        if (givenUp.has(key)) continue;
        const config = settingsRef.current[key];
        const metrics = (config?.metrics ?? []) as ScreenMetricId[];
        // Two independent layers. Either can be off; with both off this screen
        // wouldn't be in `active` at all.
        const wantBackground = config?.backgroundEnabled === true && Boolean(config.background);
        const wantInfographic = config?.infographicEnabled !== false;
        try {
          const background = wantBackground ? await loadBackground(config!.background!) : null;
          // Two renderers, one loop. A screen with nothing chosen keeps the
          // original single big number, so nobody's existing setup changes
          // under them just because a new option exists.
          const rgba =
            background || metrics.length > 0
              ? renderInfographic(
                  wantInfographic ? tilesFor(metrics, snapshotRef.current) : [],
                  screen.resolutionWidth,
                  screen.resolutionHeight,
                  { textColor: config?.textColor, background }
                )
              : renderGauge(
                  gaugeReading(snapshotRef.current, config?.sensorId ?? null),
                  screen.resolutionWidth,
                  screen.resolutionHeight
                );
          const result = await api.setDisplayImage(screen.vendorId, screen.productId, rgba);
          // A refusal comes back as a result, not a thrown error, so counting
          // only exceptions would have retried this one for ever.
          if (result && result.ok === false) throw new Error(result.message);
          failures.delete(key);
        } catch (err) {
          // A screen that's been unplugged, or is being held by its vendor's
          // own software, must not take the loop down with it — the next pass
          // tries again, and the panel shows the state either way.
          const reason = err instanceof Error ? err.message : String(err);
          const count = (failures.get(key) ?? 0) + 1;
          failures.set(key, count);
          if (count >= GIVE_UP_AFTER) {
            givenUp.set(key, reason);
            console.warn(
              `[HARE] Giving up on drawing to ${screen.name} after ${count} attempts: ${reason} ` +
                "HARE will try again next time it starts."
            );
          } else {
            console.warn("[HARE] Couldn't update the screen readout:", reason);
          }
        }
      }
    };

    void draw();
    const timer = setInterval(() => void draw(), REDRAW_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wanted]);
}
