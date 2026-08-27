import { useEffect, useState } from "react";
import { useHareStore } from "@/state/store";
import { subscribeToPreviewTicker } from "@/lib/previewTicker";
import { computeAssignmentFrame } from "../../../electron/backend/effectsEngine";
import { friendlyDeviceType } from "@/lib/deviceClassification";
import type { KLColor, KLDevice } from "../../../electron/backend/types";

/** How many dots one device's strip is drawn with, whatever its real LED count. */
const DOTS = 20;

/**
 * What every device is doing right now, as a row of live strips.
 *
 * A device running a solid color is drawn from the colors the backend
 * reports. A device running an effect is drawn by rendering the same look
 * with the same math the hardware is being driven with, since effect frames
 * go straight to the device and are never reported back.
 */
export function LightingWidget() {
  const { state } = useHareStore();
  const devices = state.devices;

  return (
    <div className="hr-card p-6 flex flex-col overflow-hidden h-full">
      <h2 className="font-display font-semibold text-lg mb-4 shrink-0">Lighting</h2>
      {devices.length === 0 ? (
        <p className="text-hare-muted">No devices connected.</p>
      ) : (
        <div className="space-y-4 overflow-y-auto pr-1">
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceRow({ device }: { device: KLDevice }) {
  const colors = useLiveColors(device);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium truncate">{device.name}</p>
        <p className="text-sm text-hare-muted shrink-0">{friendlyDeviceType(device)}</p>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {colors.map((c, i) => (
          <span
            key={i}
            className="h-4 flex-1 rounded-full"
            style={{
              backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})`,
              boxShadow: `0 0 10px 0 rgba(${c.r}, ${c.g}, ${c.b}, 0.55)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The colors to draw for one device.
 *
 * Only subscribes to the shared preview clock while the device is actually
 * running an animated look — a device sitting on a solid color costs nothing
 * to draw, and a dashboard full of idle devices should be doing no work at
 * all.
 */
function useLiveColors(device: KLDevice): KLColor[] {
  const assignment = device.activeAssignment;
  const animated = !!assignment && (assignment.effectId !== "static" || !!assignment.layers?.length);
  const [frame, setFrame] = useState<KLColor[] | null>(null);

  useEffect(() => {
    if (!animated || !assignment) {
      setFrame(null);
      return;
    }
    return subscribeToPreviewTicker((elapsed) => {
      setFrame(computeAssignmentFrame({ ...assignment, deviceId: device.id }, DOTS, elapsed));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated, device.id, JSON.stringify(assignment)]);

  if (frame) return frame;
  return resample(device.colors.length ? device.colors : [{ r: 30, g: 26, b: 36 }], DOTS);
}

/** Squeezes (or stretches) a device's real LED colors onto a fixed number of dots. */
function resample(colors: KLColor[], count: number): KLColor[] {
  const out: KLColor[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = colors[Math.floor((i / count) * colors.length)] ?? colors[colors.length - 1];
  }
  return out;
}
