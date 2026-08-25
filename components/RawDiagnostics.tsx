import type { KLDevice } from "../../electron/backend/types";
import { MODE_DIRECTION_LABELS, MODE_COLOR_MODE_LABELS } from "../../electron/backend/types";

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-hare-muted">{label}</span>
      <span className="text-hare-text/90 font-mono">{value}</span>
    </div>
  );
}

/** Read-only dump of every mode and zone exactly as OpenRGB reports it. */
export function RawDiagnostics({ device }: { device: KLDevice }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-hare-muted mb-2">Modes ({device.modes.length})</p>
        <div className="space-y-2">
          {device.modes.map((mode) => (
            <div key={mode.id} className="rounded-lg border border-hare-border bg-hare-panel2 p-3 space-y-1.5">
              <p className="text-sm font-medium mb-1">{mode.name}</p>
              <Field label="id" value={mode.id} />
              <Field label="active" value={device.activeModeId === mode.id ? "yes" : "no"} />
              <Field label="flags" value={mode.flagList.join(", ") || "none"} />
              {mode.speed !== undefined && (
                <Field label="speed" value={`${mode.speed} (${mode.minSpeed ?? "-"}–${mode.maxSpeed ?? "-"})`} />
              )}
              {mode.brightness !== undefined && (
                <Field
                  label="brightness"
                  value={`${mode.brightness} (${mode.brightnessMin ?? "-"}–${mode.brightnessMax ?? "-"})`}
                />
              )}
              <Field label="direction" value={MODE_DIRECTION_LABELS[mode.direction] ?? mode.direction} />
              <Field label="color mode" value={MODE_COLOR_MODE_LABELS[mode.colorMode] ?? mode.colorMode} />
              <Field label="color slots" value={`${mode.colors.length} (max ${mode.colorMax})`} />
              {mode.colors.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {mode.colors.map((c, i) => (
                    <span
                      key={i}
                      className="h-4 w-4 rounded-full border border-hare-border/60"
                      style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-hare-muted mb-2">Zones ({device.zones.length})</p>
        <div className="space-y-2">
          {device.zones.map((zone) => (
            <div key={zone.id} className="rounded-lg border border-hare-border bg-hare-panel2 p-3 space-y-1.5">
              <p className="text-sm font-medium mb-1">{zone.name}</p>
              <Field label="id" value={zone.id} />
              <Field label="type" value={["Single", "Linear", "Matrix"][zone.type] ?? zone.type} />
              <Field label="LEDs" value={`${zone.ledCount} (${zone.ledsMin}–${zone.ledsMax})`} />
              <Field label="LED start" value={zone.ledStart} />
              <Field label="resizable" value={zone.resizable ? "yes" : "no"} />
              {zone.matrix && <Field label="matrix" value={`${zone.matrix.rows} × ${zone.matrix.cols}`} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
