import { useEffect, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { ColorPicker } from "./ColorPicker";
import { useHareStore } from "@/state/store";
import type { KLDevice, KLColor } from "../../electron/backend/types";

function toCss(c: KLColor): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/**
 * Click-to-paint per-LED control. Matrix zones (keyboards) render as a real
 * grid, gaps included (a non-rectangular layout reports undefined cells —
 * see KLZone.matrix). Everything else renders as a row. Painting updates a
 * local color array as you go and pushes the whole array once you release
 * the mouse, rather than one network call per LED touched during a drag.
 */
export function LedPainter({ device }: { device: KLDevice }) {
  const { setRawLedColors, saveLook, run } = useHareStore();
  const [paintColor, setPaintColor] = useState<KLColor>({ r: 255, g: 46, b: 122 });
  const [localColors, setLocalColors] = useState<KLColor[]>(device.colors);
  const [isPainting, setIsPainting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lookName, setLookName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isPainting) setLocalColors(device.colors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, device.colors.length]);

  const paint = (index: number) => {
    setLocalColors((prev) => {
      const next = [...prev];
      next[index] = paintColor;
      return next;
    });
    setDirty(true);
  };

  const startPaint = (index: number) => {
    setIsPainting(true);
    paint(index);
  };

  const commit = async () => {
    setIsPainting(false);
    if (!dirty) return;
    setDirty(false);
    await run("Painting", () => setRawLedColors(device.id, localColors));
  };

  /** Enter or Space on a focused LED paints that one and sends it. */
  const paintOne = async (index: number) => {
    const next = [...localColors];
    next[index] = paintColor;
    setLocalColors(next);
    await run("Painting", () => setRawLedColors(device.id, next));
  };

  const fillAll = async () => {
    const next = localColors.map(() => paintColor);
    setLocalColors(next);
    await run("Filling", () => setRawLedColors(device.id, next), "Every LED set.");
  };

  /**
   * Saving lives here rather than with the Save to Gallery box further up the
   * device page, because the painting only exists here. That box saves the
   * effect and colour it can see, which for a painted device is whatever was
   * selected before the painting started — not the painting.
   */
  const saveToGallery = async () => {
    const name = lookName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const ok = await run(
        "Saving the look",
        () =>
          saveLook({
            name,
            sourceDeviceName: device.name,
            sourceDeviceType: device.type,
            effectId: "static",
            color: paintColor,
            speed: 45,
            brightness: 100,
            ledColors: localColors.map((c) => ({ ...c })),
          }),
        `Saved "${name}" to your Gallery.`
      );
      if (ok) setLookName("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" onMouseUp={() => void commit()} onMouseLeave={() => isPainting && void commit()}>
      <div className="flex items-center justify-between gap-3">
        <ColorPicker value={paintColor} onChange={setPaintColor} compact />
        <button
          onClick={() => void fillAll()}
          className="hr-btn-sm"
        >
          Fill all
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <BookmarkPlus size={16} className="hidden shrink-0 text-glow-violet sm:block" />
        <input
          type="text"
          value={lookName}
          onChange={(e) => setLookName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void saveToGallery()}
          placeholder="Name this painting"
          maxLength={60}
          aria-label="Name this painting"
          className="flex-1 rounded-lg border border-hare-border bg-hare-panel2 px-3 py-2 text-sm placeholder:text-hare-muted/70 focus:border-glow-violet/50 focus:outline-none"
        />
        <button
          onClick={() => void saveToGallery()}
          disabled={saving || !lookName.trim()}
          className="hr-btn-sm justify-center"
        >
          {saving ? "Saving…" : "Save to Gallery"}
        </button>
      </div>

      <div className="space-y-3 select-none">
        {device.zones.map((zone) => (
          <div key={zone.id}>
            <p className="text-xs text-hare-muted mb-1.5">{zone.name}</p>
            {zone.matrix ? (
              <div
                className="inline-grid gap-1"
                style={{ gridTemplateColumns: `repeat(${zone.matrix.cols}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: zone.matrix.rows * zone.matrix.cols }, (_, cell) => {
                  const row = Math.floor(cell / zone.matrix!.cols);
                  const col = cell % zone.matrix!.cols;
                  const relIndex = zone.matrix!.keys[row]?.[col];
                  if (relIndex === undefined) return <span key={cell} className="h-4 w-4" />;
                  const absIndex = zone.ledStart + relIndex;
                  const color = localColors[absIndex] ?? { r: 0, g: 0, b: 0 };
                  return (
                    <button
                      key={cell}
                      onMouseDown={() => startPaint(absIndex)}
                      onMouseEnter={() => isPainting && paint(absIndex)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void paintOne(absIndex);
                        }
                      }}
                      aria-label={`${zone.name}, row ${row + 1}, key ${col + 1}`}
                      className="h-5 w-5 rounded-sm border border-hare-border/60 hover:border-glow-pink/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-glow-pink"
                      style={{ backgroundColor: toCss(color) }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: zone.ledCount }, (_, i) => {
                  const absIndex = zone.ledStart + i;
                  const color = localColors[absIndex] ?? { r: 0, g: 0, b: 0 };
                  return (
                    <button
                      key={absIndex}
                      onMouseDown={() => startPaint(absIndex)}
                      onMouseEnter={() => isPainting && paint(absIndex)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void paintOne(absIndex);
                        }
                      }}
                      aria-label={`${zone.name}, LED ${i + 1}`}
                      className="h-6 w-6 rounded-full border border-hare-border/60 hover:border-glow-pink/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-glow-pink"
                      style={{ backgroundColor: toCss(color) }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
