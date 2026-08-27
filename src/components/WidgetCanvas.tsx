import { useState } from "react";
import { GripVertical, SlidersHorizontal } from "lucide-react";
import {
  DASHBOARD_COLUMNS,
  type DashboardBackground,
  type DashboardWidgetPlacement,
} from "../../electron/backend/types";
import { reorderPlacements } from "../../electron/backend/dashboardLayout";
import { WidgetFrame } from "@/dashboard/DashboardScreen";
import { accentStyle, backgroundStyle, cardsNeedGlass } from "@/dashboard/dashboardStyle";
import { WidgetControls, widgetName } from "./WidgetControls";

/**
 * A scale model of the second screen that you arrange by hand.
 *
 * It draws the real widgets, at the real sizes, over the real background --
 * scaled down. Drag one onto another to move it; click one to select it, and
 * its controls appear underneath.
 *
 * Underneath, specifically. They used to be a popover inside this miniature,
 * which has `overflow-hidden` on it, so in a one-cell widget the panel was
 * about ninety pixels wide with half of it clipped off the edge. Resizing
 * appeared to do nothing because the control could not be reached.
 *
 * Everything applies immediately: the second screen is live while this is
 * open, so there is nothing to save and no way for the two to disagree.
 */
export function WidgetCanvas({
  placements,
  background,
  onChange,
}: {
  placements: DashboardWidgetPlacement[];
  background: DashboardBackground;
  onChange: (next: DashboardWidgetPlacement[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const drop = (target: number) => {
    if (dragging === null) return;
    onChange(reorderPlacements(placements, dragging, target));
    setDragging(null);
    setOver(null);
  };

  const replace = (index: number, placement: DashboardWidgetPlacement) => {
    const next = [...placements];
    next[index] = placement;
    onChange(next);
  };

  const remove = (index: number) => {
    setSelected(null);
    onChange(placements.filter((_, i) => i !== index));
  };

  if (placements.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-hare-border p-10 text-center">
        <p className="text-sm text-hare-muted">Nothing on the screen yet. Add a widget below.</p>
      </div>
    );
  }

  const glass = cardsNeedGlass(background);
  const selectedIndex = placements.findIndex((p) => p.id === selected);

  return (
    <div>
      <div
        style={{ aspectRatio: "16 / 9", ...backgroundStyle(background) }}
        className={`overflow-hidden rounded-2xl border border-hare-border p-3 ${
          background.kind === "app" ? "bg-hare-bg" : ""
        } ${glass ? "hr-dashboard-glass" : ""}`}
      >
        <div
          className="grid h-full gap-2 [grid-auto-rows:minmax(0,1fr)]"
          style={{ gridTemplateColumns: `repeat(${DASHBOARD_COLUMNS}, minmax(0, 1fr))` }}
        >
          {placements.map((placement, index) => (
            <div
              key={placement.id}
              draggable
              onDragStart={() => setDragging(index)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(index);
              }}
              onClick={() => setSelected(selected === placement.id ? null : placement.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(selected === placement.id ? null : placement.id);
                }
              }}
              aria-pressed={selected === placement.id}
              aria-label={`${widgetName(placement.id)}, ${placement.w} by ${placement.h}`}
              style={{
                gridColumn: `span ${placement.w}`,
                gridRow: `span ${placement.h}`,
                ...accentStyle(placement),
              }}
              className={`hr-widget group relative min-h-0 min-w-0 cursor-grab rounded-2xl transition-opacity active:cursor-grabbing [&>*]:h-full ${
                dragging === index ? "opacity-50" : ""
              }`}
            >
              {/* The real widget, drawn small. `zoom` scales everything inside,
                  including the container queries the clock sizes itself with,
                  so this is what appears on the monitor rather than an
                  approximation of it. */}
              <div
                className="pointer-events-none h-full w-full overflow-hidden rounded-2xl"
                style={{ zoom: 0.42 }}
                aria-hidden
              >
                <div style={{ height: `${100 / 0.42}%`, width: `${100 / 0.42}%` }}>
                  <WidgetFrame id={placement.id} />
                </div>
              </div>

              {over === index && dragging !== null && dragging !== index && (
                <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-glow-violet bg-glow-violet/20" />
              )}

              {selected === placement.id && (
                <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-glow-pink" />
              )}

              <span className="pointer-events-none absolute left-1.5 top-1.5 flex min-w-0 items-center gap-1 rounded-md bg-hare-bg/85 px-1.5 py-0.5 text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <GripVertical size={11} className="shrink-0 text-hare-muted" />
                <span className="truncate">{widgetName(placement.id)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Outside the frame above, where there is room to actually use them. */}
      {selectedIndex >= 0 ? (
        <div className="mt-3 rounded-2xl border border-hare-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <SlidersHorizontal size={15} className="text-glow-violet" />
              {widgetName(placements[selectedIndex].id)}
            </p>
            <button onClick={() => setSelected(null)} className="text-xs text-hare-muted hover:text-hare-text">
              Done
            </button>
          </div>
          <WidgetControls
            placement={placements[selectedIndex]}
            onChange={(next) => replace(selectedIndex, next)}
            onRemove={() => remove(selectedIndex)}
          />
        </div>
      ) : (
        <p className="mt-2.5 text-xs text-hare-muted">
          Drag to rearrange. Click a widget to change its size and colour.
        </p>
      )}
    </div>
  );
}
