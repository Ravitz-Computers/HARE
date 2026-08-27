import { useEffect, useRef, useState } from "react";
import { Droplets, Gauge, Image as ImageIcon, RotateCw, Upload } from "lucide-react";
import { getHareApi } from "@/lib/hareApi";
import { useHareStore } from "@/state/store";
import { screenKey } from "@/lib/screenKey";
import { formatReading } from "../../electron/backend/sensors/sensorTypes";
import type { KLDisplayDevice } from "../../electron/backend/types";

const ORIENTATIONS: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

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

export function ScreenControls({ screen }: { screen: KLDisplayDevice }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(80);
  const caps = screen.capabilities;

  const { appSettings, setAppSettings, sensors, watchSensors } = useHareStore();
  const key = screenKey(screen);
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

  const setGauge = (patch: { enabled?: boolean; sensorId?: string | null }) =>
    setAppSettings({
      screenGauges: {
        ...appSettings.screenGauges,
        [key]: { enabled: gauge?.enabled ?? false, sensorId: gauge?.sensorId ?? null, ...patch },
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

  if (!screen.controllable) {
    return (
      <p className="text-xs text-hare-muted">
        HARE can see this screen but can't send pictures to it yet.
      </p>
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
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Gauge size={15} className={gauge?.enabled ? "text-glow-green" : "text-hare-muted"} />
            Show a live temperature
          </p>
          <button
            role="switch"
            aria-checked={gauge?.enabled ?? false}
            aria-label="Show a live temperature on this screen"
            onClick={() => void setGauge({ enabled: !gauge?.enabled })}
            title={gauge?.enabled ? "On — click to turn off" : "Off — click to turn on"}
            className={`h-6 w-6 shrink-0 rounded-full border-2 transition-colors ${
              gauge?.enabled
                ? "border-glow-green bg-glow-green shadow-[0_0_10px_0_rgba(61,220,151,0.6)]"
                : "border-hare-border bg-transparent hover:border-hare-muted"
            }`}
          />
        </div>
        {gauge?.enabled && (
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="mb-1.5 block text-xs text-hare-muted">Which reading</span>
              <select
                value={gauge.sensorId ?? ""}
                onChange={(e) => void setGauge({ sensorId: e.target.value || null })}
                className="w-full rounded-lg border border-hare-border bg-hare-panel2 px-2.5 py-1.5 text-sm"
              >
                <option value="">Hottest right now</option>
                {temperatures.map((reading) => (
                  <option key={reading.id} value={reading.id}>
                    {reading.label} · {formatReading(reading)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-hare-muted">
              Updates every few seconds while HARE is running. Send an image, or hit Reset to stock,
              to stop it.
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
