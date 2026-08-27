import { Minus, Plus, Trash2 } from "lucide-react";
import { DASHBOARD_COLUMNS, DASHBOARD_WIDGETS, type DashboardWidgetPlacement } from "../../electron/backend/types";
import { MAX_WIDGET_ROWS, withAccent, withSpan } from "../../electron/backend/dashboardLayout";

/**
 * The controls for one widget: how big it is, what colour it is, and getting
 * rid of it.
 *
 * Shared deliberately. These used to live in a popover inside the layout
 * preview, which is a 16:9 miniature with `overflow-hidden` on it — so in a
 * one-cell widget the panel was about ninety pixels wide and the half of it
 * that mattered was clipped off the edge. Resizing appeared not to work
 * because the control could not be reached, not because it did nothing.
 *
 * So the controls render wherever there is room for them: below the preview in
 * HARE's own window, and as a bottom sheet on the second screen. Same
 * component, same behaviour, one place to fix.
 */

/** The colours a widget can be tinted. Enough to tell six cards apart at a glance, few enough to pick from. */
export const ACCENTS: { value: string | null; label: string }[] = [
  { value: null, label: "Default" },
  { value: "#ff2e7a", label: "Pink" },
  { value: "#9b7cff", label: "Violet" },
  { value: "#3ddc97", label: "Green" },
  { value: "#5cc8ff", label: "Blue" },
  { value: "#ffc857", label: "Amber" },
  { value: "#ff8f3f", label: "Orange" },
  { value: "#ffffff", label: "White" },
];

export function widgetName(id: string): string {
  return DASHBOARD_WIDGETS.find((w) => w.id === id)?.name ?? id;
}

export function WidgetControls({
  placement,
  onChange,
  onRemove,
  /** `touch` is bigger throughout — the second screen is prodded with a finger. */
  size = "normal",
}: {
  placement: DashboardWidgetPlacement;
  onChange: (next: DashboardWidgetPlacement) => void;
  onRemove: () => void;
  size?: "normal" | "touch";
}) {
  const touch = size === "touch";
  const swatch = touch ? "h-10 w-10" : "h-7 w-7";

  return (
    <div className={touch ? "space-y-5" : "space-y-4"}>
      <div className={`flex flex-wrap items-center ${touch ? "gap-6" : "gap-5"}`}>
        <Stepper
          label="Wide"
          value={placement.w}
          max={DASHBOARD_COLUMNS}
          touch={touch}
          onChange={(w) => onChange(withSpan(placement, w, placement.h))}
        />
        <Stepper
          label="Tall"
          value={placement.h}
          max={MAX_WIDGET_ROWS}
          touch={touch}
          onChange={(h) => onChange(withSpan(placement, placement.w, h))}
        />
      </div>

      <div>
        <p className={`mb-2 font-medium uppercase tracking-wide text-hare-muted ${touch ? "text-sm" : "text-[10px]"}`}>
          Colour
        </p>
        <div className="flex flex-wrap gap-2.5">
          {ACCENTS.map((accent) => {
            const active = (placement.accent ?? null) === accent.value;
            return (
              <button
                key={accent.label}
                onClick={() => onChange(withAccent(placement, accent.value))}
                title={accent.label}
                aria-label={accent.label}
                aria-pressed={active}
                className={`${swatch} rounded-full border-2 transition-transform ${
                  active ? "scale-110 border-hare-text" : "border-hare-border hover:scale-105"
                }`}
                style={{
                  background:
                    accent.value ?? "linear-gradient(135deg, #ff2e7a 0%, #9b7cff 50%, #5cc8ff 100%)",
                }}
              />
            );
          })}
        </div>
      </div>

      <button
        onClick={onRemove}
        className={`flex items-center gap-2 rounded-xl border border-hare-border font-medium text-hare-muted transition-colors hover:border-glow-rose/40 hover:text-glow-rose ${
          touch ? "px-4 py-3 text-base" : "px-3 py-2 text-xs"
        }`}
      >
        <Trash2 size={touch ? 18 : 13} />
        Remove from the screen
      </button>
    </div>
  );
}

/**
 * Minus / number / plus.
 *
 * A stepper rather than a dropdown on purpose: a native `<select>` inside a
 * `draggable` element frequently refuses to open in Chromium, which is the
 * other half of why resizing looked broken. Two buttons cannot have that
 * problem, and they work with a finger.
 */
function Stepper({
  label,
  value,
  max,
  touch,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  touch: boolean;
  onChange: (value: number) => void;
}) {
  const button = touch ? "h-11 w-11 text-lg" : "h-7 w-7 text-sm";
  return (
    <div>
      <p className={`mb-2 font-medium uppercase tracking-wide text-hare-muted ${touch ? "text-sm" : "text-[10px]"}`}>
        {label}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(value - 1)}
          disabled={value <= 1}
          aria-label={`${label}: smaller`}
          className={`${button} flex items-center justify-center rounded-lg border border-hare-border text-hare-muted transition-colors hover:text-hare-text disabled:opacity-30`}
        >
          <Minus size={touch ? 18 : 13} />
        </button>
        <span
          className={`tabular-nums text-center font-medium ${touch ? "w-8 text-xl" : "w-5 text-sm"}`}
          aria-live="polite"
        >
          {value}
        </span>
        <button
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`${label}: bigger`}
          className={`${button} flex items-center justify-center rounded-lg border border-hare-border text-hare-muted transition-colors hover:text-hare-text disabled:opacity-30`}
        >
          <Plus size={touch ? 18 : 13} />
        </button>
      </div>
    </div>
  );
}
