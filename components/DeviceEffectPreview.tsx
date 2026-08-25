import { useEffect, useState } from "react";
import { computeAssignmentFrame } from "../../electron/backend/effectsEngine";
import { subscribeToPreviewTicker } from "@/lib/previewTicker";
import type { EffectAssignment, KLColor, KLDevice } from "../../electron/backend/types";

/**
 * Shows what an assignment will look like on *this specific device* before
 * it's applied — laid out the way the device actually is, rather than the
 * generic strip used in the effect picker (EffectPreviewSwatch).
 *
 * Matrix zones (keyboards) render as a real grid including the gaps where
 * there's no physical key; everything else renders as a row per zone. Frames
 * come from computeAssignmentFrame — the exact same function the backend
 * pushes to hardware, called with this device's real LED count — so what's on
 * screen is what the device will do, layer stacks included, not an
 * approximation.
 */
export function DeviceEffectPreview({
  device,
  assignment,
}: {
  device: KLDevice;
  /** Everything except the device/zone ids, which are taken from `device`. */
  assignment: Omit<EffectAssignment, "deviceId" | "zoneId">;
}) {
  const ledCount = device.colors.length;
  const [colors, setColors] = useState<KLColor[]>(() => new Array(ledCount).fill({ r: 0, g: 0, b: 0 }));
  // The assignment is a fresh object every render, so it can't be a dependency
  // directly without restarting the animation constantly. Serializing it means
  // the preview restarts only when something about the look actually changed.
  const signature = JSON.stringify(assignment);

  useEffect(() => {
    const parsed = JSON.parse(signature) as Omit<EffectAssignment, "deviceId" | "zoneId">;
    const render = (elapsed: number) =>
      setColors(computeAssignmentFrame({ ...parsed, deviceId: device.id, zoneId: null }, ledCount, elapsed));
    // Paint once immediately so the preview isn't blank until the next frame.
    render(0);
    return subscribeToPreviewTicker(render);
  }, [device.id, ledCount, signature]);

  const dot = (c: KLColor, key: string | number, className: string) => (
    <span
      key={key}
      className={className}
      style={{
        backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})`,
        boxShadow: c.r + c.g + c.b > 40 ? `0 0 6px 0 rgba(${c.r}, ${c.g}, ${c.b}, 0.65)` : undefined,
      }}
    />
  );

  return (
    <div className="space-y-2.5">
      {device.zones.map((zone) => (
        <div key={zone.id}>
          {device.zones.length > 1 && <p className="text-[11px] text-hare-muted mb-1">{zone.name}</p>}
          {zone.matrix ? (
            <div
              className="inline-grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${zone.matrix.cols}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: zone.matrix.rows * zone.matrix.cols }, (_, cell) => {
                const row = Math.floor(cell / zone.matrix!.cols);
                const col = cell % zone.matrix!.cols;
                const rel = zone.matrix!.keys[row]?.[col];
                if (rel === undefined) return <span key={cell} className="h-2.5 w-2.5" />;
                const c = colors[zone.ledStart + rel] ?? { r: 0, g: 0, b: 0 };
                return dot(c, cell, "h-2.5 w-2.5 rounded-[2px]");
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: zone.ledCount }, (_, i) => {
                const c = colors[zone.ledStart + i] ?? { r: 0, g: 0, b: 0 };
                return dot(c, zone.ledStart + i, "h-3 w-3 rounded-full");
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
