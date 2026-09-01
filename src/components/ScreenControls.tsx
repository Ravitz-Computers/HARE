import { useEffect, useRef, useState } from "react";
import { Droplets, Gauge, Image as ImageIcon, RotateCw, Upload } from "lucide-react";
import { getHareApi } from "@/lib/hareApi";
import { useHareStore } from "@/state/store";
import { screenKey } from "@/lib/screenKey";
import { formatReading } from "../../electron/backend/sensors/sensorTypes";
import { MAX_SCREEN_METRICS, SCREEN_METRICS, metricDef, type ScreenMetricId } from "@/lib/screenMetrics";
import type { KLDisplayDevice } from "../../electron/backend/types";

const ORIENTATIONS: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

/** Joins metric names into a sentence, lower-cased so they read as part of one. */
function listNames(ids: ScreenMetricId[]): string {
  const names = ids.map((id) => (metricDef(id)?.label ?? id).toLowerCase());
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * Decodes an image file and resizes it to the screen's exact native
 * resolution, returning raw RGBA.
 *
 * Doing this here rather than in the main process means HARE ships no image
 * library at all: the browser engine already decodes PNG, JPEG, WEBP, BMP and
 * GIF, and a canvas does the scaling. The device only ever receives pixels
 * that are already the right size.
 *
 * The image is drawn "cover"-style — scaled to fill and centre-cropped —
 * because these screens are square or near-square and letterboxing a photo
 * into one looks worse than cropping it.
 */
async function toDeviceRgba(file: File, width: number, height: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't prepare the image.");

    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const drawW = bitmap.width * scale;
    const drawH = bitmap.height * scale;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);

    return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
  } finally {
    bitmap.close();
  }
}

/** One layer's on/off row. Two of these, so they read as a pair rather than as unrelated settings. */
function Layer({
  icon,
  label,
  on,
  onToggle,
  disabled,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <span className={on && !disabled ? "text-glow-green" : "text-hare-muted"}>{icon}</span>
        {label}
        {hint && <span className="text-[11px] font-normal text-hare-muted">&mdash; {hint}</span>}
      </p>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        title={on ? "On - click to turn off" : "Off - click to turn on"}
        className={`h-6 w-6 shrink-0 rounded-full border-2 transition-colors disabled:opacity-40 ${
          on && !disabled
            ? "border-glow-green bg-glow-green shadow-[0_0_10px_0_rgba(61,220,151,0.6)]"
            : "border-hare-border bg-transparent hover:border-hare-muted"
        }`}
      />
    </div>
  );
}

export function ScreenControls({ screen }: { screen: KLDisplayDevice }) {
  const backgroundRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(80);
  const caps = screen.capabilities;

  const { appSettings, setAppSettings, sensors, watchSensors } = useHareStore();
  const key = screenKey(screen);
  /**
   * What this screen is set to, or nothing at all.
   *
   * There is no entry until something is saved for a screen, so on a screen
   * nobody has touched — which is every screen the first time it is opened —
   * this is undefined, and every read of it below has to survive that. One
   * `gauge.sensorId` without the question mark threw while rendering, and
   * because that happens inside React rather than in the main process, the
   * whole panel disappeared behind an error card with nothing in the log to
   * say why. Reported twice as "the screen doesn't allow any control".
   *
   * verify-widget-editing.mjs fails the build if a bare `gauge.` comes back.
   */
  const gauge = appSettings.screenGauges[key];
  const temperatures = sensors.readings.filter((r) => r.kind === "temperature");

  // Watched while this panel is open so the list below has something to
  // choose from. The readout itself holds its own claim.
  useEffect(() => {
    void watchSensors(true);
    return () => {
      void watchSensors(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setGauge = (patch: {
    enabled?: boolean;
    sensorId?: string | null;
    metrics?: string[];
    backgroundEnabled?: boolean;
    infographicEnabled?: boolean;
    background?: string | null;
    textColor?: string;
  }) =>
    setAppSettings({
      screenGauges: {
        ...appSettings.screenGauges,
        [key]: {
          enabled: gauge?.enabled ?? false,
          sensorId: gauge?.sensorId ?? null,
          metrics: gauge?.metrics ?? [],
          backgroundEnabled: gauge?.backgroundEnabled ?? false,
          infographicEnabled: gauge?.infographicEnabled ?? true,
          background: gauge?.background ?? null,
          textColor: gauge?.textColor ?? "#ffffff",
          ...patch,
        },
      },
    });

  /**
   * Anything that puts a picture on the screen stops the readout first,
   * otherwise the next redraw paints straight over what was just sent and the
   * upload looks like it silently failed.
   */
  const stopGauge = async () => {
    if (gauge?.enabled) await setGauge({ enabled: false });
  };

  const run = async (label: string, fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(label);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(result.ok ? "Done." : (result.message ?? "That didn't work."));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    await stopGauge();
    const api = await getHareApi();
    const isGif = file.type === "image/gif";

    if (isGif && caps.gif) {
      // GIFs go up as their original file bytes — the screen's own firmware
      // decodes and animates them, so re-encoding here would only lose the
      // animation.
      await run("upload", async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return api.setDisplayGif(screen.vendorId, screen.productId, bytes);
      });
      return;
    }

    await run("upload", async () => {
      const rgba = await toDeviceRgba(file, screen.resolutionWidth, screen.resolutionHeight);
      return api.setDisplayImage(screen.vendorId, screen.productId, rgba);
    });
  };

  // A screen HARE can't draw on is still a screen the user owns, and naming
  // it is the whole difference between "detected, no write path" and "my
  // screen doesn't show up in HARE" -- which is what an owner of one actually
  // reported, because this branch used to render one anonymous sentence.
  // Both layers default to the old behaviour for a screen that predates them:
  // readings on, no background. Nobody's existing setup changes.
  const backgroundOn = gauge?.backgroundEnabled === true;
  const infographicOn = gauge?.infographicEnabled !== false;

  /**
   * Crops the chosen picture to the screen and keeps it as a data URL.
   *
   * Cropped here, once, rather than every frame: the panel is a fixed size, so
   * a 12-megapixel photo has no business being decoded and scaled every five
   * seconds for the rest of the session.
   */
  const chooseBackground = async (file: File) => {
    setBusy("background");
    setMessage(null);
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = screen.resolutionWidth;
        canvas.height = screen.resolutionHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Couldn't prepare the picture.");
        const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
        const drawW = bitmap.width * scale;
        const drawH = bitmap.height * scale;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, (canvas.width - drawW) / 2, (canvas.height - drawH) / 2, drawW, drawH);
        // JPEG, not PNG: this is stored in the settings file, and a PNG of a
        // photograph is several times the size for no visible gain on a panel
        // behind tinted glass.
        await setGauge({ background: canvas.toDataURL("image/jpeg", 0.9), backgroundEnabled: true });
      } finally {
        bitmap.close();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Ticking is order-preserving: a metric goes on the end and comes off in
  // place, so the numbers next to the ticks are the rows on the screen.
  const selectedMetrics = (gauge?.metrics ?? []) as ScreenMetricId[];

  /**
   * Which readings nothing is reporting at the moment.
   *
   * A metric with no source draws a dash on the cooler, and from across a
   * room a dash looks like a broken screen rather than a missing sensor.
   * Saying so next to the tickbox is the only place someone can tell the two
   * apart, so it is worked out from the same matchers the renderer uses
   * rather than a second list that could disagree with them.
   */
  const unreadable = new Set(
    SCREEN_METRICS.filter((m) => m.id !== "clock" && !m.match(sensors.readings)).map((m) => m.id)
  );
  const missingChosen = selectedMetrics.filter((id) => unreadable.has(id));
  const toggleMetric = async (id: ScreenMetricId) => {
    const next = selectedMetrics.includes(id)
      ? selectedMetrics.filter((m) => m !== id)
      : [...selectedMetrics, id].slice(0, MAX_SCREEN_METRICS);
    // Ticking anything turns the readout on. Choosing what to show and then
    // having to find a separate switch is the kind of step people miss and
    // then report as "it doesn't work".
    await setGauge({ metrics: next, enabled: next.length > 0 ? true : gauge?.enabled ?? false });
  };

  if (!screen.controllable) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{screen.name}</p>
        <p className="text-xs text-hare-muted">
          {screen.resolutionWidth}x{screen.resolutionHeight} &middot; USB{" "}
          {screen.vendorId.toString(16).padStart(4, "0")}:
          {screen.productId.toString(16).padStart(4, "0")}
        </p>
        <p className="text-xs text-hare-muted">
          HARE can see this screen but can't send pictures to it yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg border border-hare-border px-2.5 py-1.5 text-xs font-medium text-hare-muted hover:text-hare-text hover:border-glow-violet/40 transition-colors disabled:opacity-50"
        >
          <Upload size={13} className={busy === "upload" ? "animate-pulse" : ""} />
          {busy === "upload" ? "Sending…" : "Send image or GIF"}
        </button>

        {caps.liquidMode && (
          <button
            onClick={() =>
              void run("liquid", async () => {
                await stopGauge();
                return (await getHareApi()).setDisplayLiquidMode(screen.vendorId, screen.productId);
              })
            }
            disabled={busy !== null}
            title="Put the screen back to its normal liquid-temperature display"
            className="flex items-center gap-1.5 rounded-lg border border-hare-border px-2.5 py-1.5 text-xs font-medium text-hare-muted hover:text-hare-text transition-colors disabled:opacity-50"
          >
            <Droplets size={13} />
            Reset to stock
          </button>
        )}
      </div>

      {/*
        The thing a screen on a cooler is actually for. HARE could read
        temperatures and could send pictures; this is what joins them.
      */}
      <div className="rounded-xl border border-hare-border p-3.5">
        {/*
          Two layers, switched separately. A picture on its own, readings on
          their own, or readings over a picture — these used to be mutually
          exclusive for no reason other than that sending an image stopped the
          readout.
        */}
        <div className="space-y-2.5">
          <Layer
            icon={<ImageIcon size={15} />}
            label="Background picture"
            on={backgroundOn}
            onToggle={() => void setGauge({ backgroundEnabled: !backgroundOn })}
            disabled={!gauge?.background}
            hint={gauge?.background ? undefined : "Choose a picture first"}
          />
          <Layer
            icon={<Gauge size={15} />}
            label="Readings on top"
            on={infographicOn}
            onToggle={() => void setGauge({ infographicEnabled: !infographicOn })}
          />
        </div>

        {/*
          Always shown, never behind the switch above it.
          
          It used to render only while the background layer was on, and that
          layer could not be turned on without a picture — so the switch said
          "Choose one below" and there was nothing below. There was no way in
          at all, which is how it was reported: no place to add a background
          picture.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => backgroundRef.current?.click()}
            disabled={busy !== null}
            className="hr-btn-sm"
          >
            <Upload size={13} />
            {gauge?.background ? "Change picture" : "Choose a picture"}
          </button>
          {gauge?.background && (
            <>
              <img
                src={gauge?.background}
                alt=""
                className="h-9 w-9 rounded-md border border-hare-border object-cover"
              />
              <button
                type="button"
                onClick={() => void setGauge({ background: null, backgroundEnabled: false })}
                disabled={busy !== null}
                className="text-xs text-hare-muted underline underline-offset-2 hover:text-hare-text disabled:opacity-40"
              >
                Remove
              </button>
            </>
          )}
          <input
            ref={backgroundRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void chooseBackground(file);
            }}
          />
        </div>

        {infographicOn && (
          <div className="mt-3 space-y-2">
            {/*
              Tick what to show. Order is the order they were ticked, which is
              the order they appear on the screen — so "put the CPU on top"
              needs no extra control, just unticking and re-ticking.
            */}
            <div>
              <span className="mb-1.5 block text-xs text-hare-muted">
                What to show &mdash; up to {MAX_SCREEN_METRICS}
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {SCREEN_METRICS.map((metric) => {
                  const chosen = selectedMetrics.indexOf(metric.id);
                  const isOn = chosen >= 0;
                  const full = selectedMetrics.length >= MAX_SCREEN_METRICS && !isOn;
                  const noReading = unreadable.has(metric.id);
                  return (
                    <button
                      key={metric.id}
                      type="button"
                      disabled={full}
                      onClick={() => void toggleMetric(metric.id)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isOn
                          ? "border-glow-green/50 bg-glow-green/10 text-hare-text"
                          : "border-hare-border text-hare-muted hover:border-hare-muted disabled:opacity-40"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${
                          isOn ? "border-glow-green bg-glow-green text-black" : "border-hare-border"
                        }`}
                      >
                        {isOn ? chosen + 1 : ""}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{metric.label}</span>
                      {noReading && (
                        <span className="shrink-0 rounded bg-hare-panel2 px-1 text-[10px] text-hare-muted">
                          no reading
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {missingChosen.length > 0 && (
                <p className="mt-1.5 text-xs text-hare-muted">
                  Nothing is reporting {listNames(missingChosen)} right now, so {missingChosen.length === 1 ? "it shows" : "they show"}{" "}
                  a dash. Settings &rarr; Hardware &rarr; System Sensors lists what HARE can read.
                </p>
              )}
            </div>

            {selectedMetrics.length === 0 && (
              <label className="block">
                <span className="mb-1.5 block text-xs text-hare-muted">
                  Nothing ticked, so it shows one big reading
                </span>
                <select
                  value={gauge?.sensorId ?? ""}
                  onChange={(e) => void setGauge({ sensorId: e.target.value || null })}
                  className="w-full rounded-lg border border-hare-border bg-hare-panel2 px-2.5 py-1.5 text-sm"
                >
                  <option value="">Hottest right now</option>
                  {temperatures.map((reading) => (
                    <option key={reading.id} value={reading.id}>
                      {reading.label} &middot; {formatReading(reading)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex items-center gap-2.5">
              <span className="text-xs text-hare-muted">Text colour</span>
              <input
                type="color"
                value={gauge?.textColor ?? "#ffffff"}
                onChange={(e) => void setGauge({ textColor: e.target.value })}
                aria-label="Colour of the readings on the screen"
                className="h-7 w-12 cursor-pointer rounded border border-hare-border bg-transparent"
              />
              <span className="text-[11px] text-hare-muted">
                White suits most pictures. Change it if yours is pale.
              </span>
            </label>

            <p className="text-[11px] text-hare-muted">
              Updates every few seconds while HARE is running. Hit Reset to stock to give the screen
              back to the cooler.
            </p>
            {temperatures.length === 0 && (
              <p className="text-[11px] text-glow-amber">
                No temperatures yet — Settings → Hardware → System Sensors says what's missing.
              </p>
            )}
          </div>
        )}
      </div>

      {caps.orientation && (
        <div className="flex items-center gap-2">
          <RotateCw size={13} className="text-hare-muted shrink-0" />
          {ORIENTATIONS.map((deg) => (
            <button
              key={deg}
              onClick={() =>
                void run("orientation", async () =>
                  (await getHareApi()).setDisplayOrientation(screen.vendorId, screen.productId, deg)
                )
              }
              disabled={busy !== null}
              className="rounded-lg border border-hare-border px-2 py-1 text-[11px] font-medium text-hare-muted hover:text-hare-text transition-colors disabled:opacity-50"
            >
              {deg}°
            </button>
          ))}
        </div>
      )}

      {caps.brightness && (
        <label className="block">
          <span className="text-xs text-hare-muted flex justify-between mb-1">
            <span>Screen brightness</span>
            <span>{brightness}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            onPointerUp={() =>
              void run("brightness", async () =>
                (await getHareApi()).setDisplayBrightness(screen.vendorId, screen.productId, brightness)
              )
            }
            className="w-full"
          />
        </label>
      )}

      <p className="text-[11px] text-hare-muted flex items-start gap-1.5">
        <ImageIcon size={12} className="mt-0.5 shrink-0" />
        Stills are cropped to fill {screen.resolutionWidth}×{screen.resolutionHeight}. GIFs play as-is.
        {!caps.video && " Video isn't something these screens accept — use a GIF."}
      </p>

      {message && <p className="text-xs text-glow-violet">{message}</p>}
    </div>
  );
}
