import { useEffect, useRef } from "react";
import { getHareApi } from "@/lib/hareApi";
import { useHareStore } from "@/state/store";
import { gaugeReading, renderGauge } from "@/lib/screenGauge";
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

  // Screens are otherwise only looked for when someone opens Widget Engine,
  // which would leave a saved readout blank until they went there. The look
  // only happens when something is actually configured, so a machine with no
  // screen never touches USB for this.
  const configured = Object.values(appSettings.screenGauges).some((g) => g.enabled);
  useEffect(() => {
    if (configured) void refreshDisplayDevices();
  }, [configured, refreshDisplayDevices]);

  const active = displayDevices.filter(
    (screen) => screen.controllable && appSettings.screenGauges[screenKey(screen)]?.enabled
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
        const config = settingsRef.current[screenKey(screen)];
        const reading = gaugeReading(snapshotRef.current, config?.sensorId ?? null);
        try {
          const rgba = renderGauge(reading, screen.resolutionWidth, screen.resolutionHeight);
          await api.setDisplayImage(screen.vendorId, screen.productId, rgba);
        } catch (err) {
          // A screen that's been unplugged, or is being held by its vendor's
          // own software, must not take the loop down with it — the next pass
          // tries again, and the panel shows the state either way.
          console.warn("[HARE] Couldn't update the screen readout:", err);
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
