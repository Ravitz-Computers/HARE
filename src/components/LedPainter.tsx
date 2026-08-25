import { useEffect, useState } from "react";
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
  const { setRawLedColors } = useHareStore();
  const [paintColor, setPaintColor] = useState<KLColor>({ r: 255, g: 46, b: 122 });
  const [localColors, setLocalColors] = useState<KLColor[]>(device.colors);
  const [isPainting, setIsPainting] = useState(false);
  const [dirty, setDirty] = useState(false);

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
    await setRawLedColors(device.id, localColors);
  };

  const fillAll = async () => {
    const next = localColors.map(() => paintColor);
    setLocalColors(next);
    await setRawLedColors(device.id, next);
  };

  return (
    <div className="space-y-4" onMouseUp={() => void commit()} onMouseLeave={() => isPainting && void commit()}>
      <div className="flex items-center justify-between gap-3">
        <ColorPicker value={paintColor} onChange={setPaintColor} compact />
        <button
          onClick={() => void fillAll()}
          className="whitespace-nowrap text-xs font-medium text-hare-muted hover:text-hare-text rounded-lg border border-hare-border px-2.5 py-1.5 hover:border-glow-violet/40 transition-colors"
        >
          Fill all
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
                      className="h-4 w-4 rounded-sm border border-hare-border/60 hover:border-glow-pink/60"
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
                      className="h-5 w-5 rounded-full border border-hare-border/60 hover:border-glow-pink/60"
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
