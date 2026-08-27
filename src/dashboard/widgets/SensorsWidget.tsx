import { useEffect } from "react";
import { Thermometer } from "lucide-react";
import { useHareStore } from "@/state/store";
import { formatReading } from "../../../electron/backend/sensors/sensorTypes";
import type { SensorReading } from "../../../electron/backend/sensors/sensorTypes";

/** Temperature bands, used for both the bar and its colour. Below 40 nothing is happening; above 85 something is wrong. */
const COOL = 30;
const HOT = 90;

function temperatureColor(celsius: number): string {
  const level = Math.max(0, Math.min(1, (celsius - COOL) / (HOT - COOL)));
  // The same blue-through-red ramp the Thermal effect uses, so a glance at
  // the screen and a glance at the lighting agree.
  return `hsl(${210 * (1 - level)}, 85%, 55%)`;
}

/**
 * Live temperatures, load and fan speeds.
 *
 * Only mounted when the user has chosen this widget, and it tells the backend
 * to start polling on mount and to stop on unmount — nothing is read while
 * nobody is looking at it.
 */
export function SensorsWidget() {
  const { sensors, watchSensors } = useHareStore();

  useEffect(() => {
    void watchSensors(true);
    return () => {
      void watchSensors(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const temperatures = sensors.readings.filter((r) => r.kind === "temperature");
  const loads = sensors.readings.filter((r) => r.kind === "load").slice(0, 4);
  const fans = sensors.readings.filter((r) => r.kind === "fan").slice(0, 4);
  const hasAnything = sensors.readings.length > 0;

  return (
    <div className="hr-card p-6 flex flex-col overflow-hidden h-full">
      <h2 className="font-display font-semibold text-lg mb-4 shrink-0">System</h2>

      {!hasAnything ? (
        <p className="text-hare-muted">
          No sensors readable on this PC yet. Settings → Hardware shows what would add some.
        </p>
      ) : (
        <div className="space-y-4 overflow-y-auto pr-1">
          {temperatures.length > 0 && (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
              {temperatures.slice(0, 4).map((reading) => (
                <TemperatureTile key={reading.id} reading={reading} />
              ))}
            </div>
          )}

          {loads.map((reading) => (
            <Bar key={reading.id} label={reading.label} value={reading.value} text={formatReading(reading)} />
          ))}

          {fans.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
              {fans.map((reading) => (
                <p key={reading.id} className="text-sm text-hare-muted">
                  {reading.label} <span className="text-hare-text tabular-nums">{formatReading(reading)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TemperatureTile({ reading }: { reading: SensorReading }) {
  const color = temperatureColor(reading.value);
  return (
    <div className="rounded-2xl border border-hare-border p-3">
      <p className="flex items-center gap-1.5 text-sm text-hare-muted truncate">
        <Thermometer size={14} style={{ color }} />
        {reading.label}
      </p>
      <p className="font-display font-bold text-2xl mt-1 tabular-nums" style={{ color }}>
        {formatReading(reading)}
      </p>
    </div>
  );
}

function Bar({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">{label}</span>
        <span className="text-hare-muted tabular-nums shrink-0">{text}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-hare-border/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand-gradient transition-[width] duration-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
