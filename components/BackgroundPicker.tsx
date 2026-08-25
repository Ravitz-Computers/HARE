import { useRef, useState } from "react";
import { Image as ImageIcon, Palette, Square, Trash2 } from "lucide-react";
import type { DashboardBackground } from "../../electron/backend/types";

/**
 * What sits behind the widgets on the second screen.
 *
 * Four answers: HARE's own dark wash, a flat colour, a picture, or nothing at
 * all — which makes the window itself transparent so the desktop shows
 * through and only the cards are drawn.
 */

const COLORS = ["#0b0810", "#000000", "#101820", "#1b1030", "#0f2027", "#2b0a12", "#1a1a1a", "#ffffff"];

/**
 * The longest edge a chosen picture is stored at.
 *
 * The image has to reach a second window and survive a restart, so it lives
 * in the settings file as a data URL. Full-size photos from a modern camera
 * are tens of megabytes; at this size a JPEG is a couple of hundred kilobytes
 * and still sharper than any panel HARE draws on.
 */
const MAX_EDGE = 1920;
const QUALITY = 0.82;

/** Decodes, downscales and re-encodes a chosen file, entirely in the window. */
async function toStoredImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't read that picture.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    bitmap.close();
  }
}

export function BackgroundPicker({
  value,
  onChange,
}: {
  value: DashboardBackground;
  onChange: (next: DashboardBackground) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await toStoredImage(file);
      onChange({ kind: "image", image, fit: "cover", dim: 35 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that picture.");
    } finally {
      setBusy(false);
    }
  };

  const tabs: { kind: DashboardBackground["kind"]; label: string; icon: typeof Palette }[] = [
    { kind: "app", label: "HARE", icon: Square },
    { kind: "color", label: "Colour", icon: Palette },
    { kind: "image", label: "Picture", icon: ImageIcon },
    { kind: "none", label: "None", icon: Trash2 },
  ];

  const choose = (kind: DashboardBackground["kind"]) => {
    if (kind === value.kind) return;
    if (kind === "app") onChange({ kind: "app" });
    else if (kind === "none") onChange({ kind: "none" });
    else if (kind === "color") onChange({ kind: "color", color: COLORS[0] });
    else fileRef.current?.click();
  };

  return (
    <div className="rounded-xl border border-hare-border p-3.5">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-hare-muted">Background</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap gap-2">
        {tabs.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            onClick={() => choose(kind)}
            disabled={busy}
            aria-pressed={value.kind === kind}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              value.kind === kind
                ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                : "border-hare-border text-hare-muted hover:text-hare-text"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {value.kind === "color" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => onChange({ kind: "color", color })}
              title={color}
              aria-label={`Background ${color}`}
              aria-pressed={value.color === color}
              className={`h-6 w-6 rounded-full border-2 transition-transform ${
                value.color === color ? "scale-110 border-hare-text" : "border-hare-border hover:scale-105"
              }`}
              style={{ background: color }}
            />
          ))}
          <label className="flex items-center gap-1.5 text-xs text-hare-muted">
            <input
              type="color"
              value={value.color}
              onChange={(e) => onChange({ kind: "color", color: e.target.value })}
              aria-label="Pick any background colour"
              className="h-6 w-8 cursor-pointer rounded border border-hare-border bg-transparent p-0"
            />
            Any
          </label>
        </div>
      )}

      {value.kind === "image" && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="hr-btn-sm">
              <ImageIcon size={12} />
              {busy ? "Reading…" : "Choose another"}
            </button>
            {(["cover", "contain"] as const).map((fit) => (
              <button
                key={fit}
                onClick={() => onChange({ ...value, fit })}
                aria-pressed={value.fit === fit}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  value.fit === fit
                    ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                    : "border-hare-border text-hare-muted hover:text-hare-text"
                }`}
              >
                {fit === "cover" ? "Fill the screen" : "Fit the whole picture"}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 flex justify-between text-xs text-hare-muted">
              <span>Darken</span>
              <span>{value.dim}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={90}
              value={value.dim}
              onChange={(e) => onChange({ ...value, dim: Number(e.target.value) })}
              className="w-full"
            />
          </label>
        </div>
      )}

      {value.kind === "none" && (
        <p className="mt-2.5 text-[11px] text-hare-muted">
          The screen shows your desktop behind the widgets. Turn the second screen off and on again
          after changing this.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-glow-amber">{error}</p>}
    </div>
  );
}
