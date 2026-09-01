import { useEffect, useState } from "react";
import { Check, Lock, Pencil, X } from "lucide-react";
import { useHareStore } from "@/state/store";
import { getHareApi } from "@/lib/hareApi";
import { Logo } from "@/components/Logo";
import { VinnyFlourish } from "@/components/VinnyFlourish";
import { DASHBOARD_COLUMNS, type DashboardWidgetId } from "../../electron/backend/types";
import { accentStyle, backgroundStyle, cardsNeedGlass } from "./dashboardStyle";
import { WidgetControls, widgetName } from "@/components/WidgetControls";
import { reorderPlacements } from "../../electron/backend/dashboardLayout";
import type { DashboardWidgetPlacement } from "../../electron/backend/types";
import { ClockWidget } from "./widgets/ClockWidget";
import { LightingWidget } from "./widgets/LightingWidget";
import { QuickControlsWidget } from "./widgets/QuickControlsWidget";
import { LooksWidget } from "./widgets/LooksWidget";
import { AmbientWidget } from "./widgets/AmbientWidget";
import { StatusWidget } from "./widgets/StatusWidget";
import { SensorsWidget } from "./widgets/SensorsWidget";

/**
 * The second screen itself.
 *
 * This is the same renderer bundle as the main window, entered through a
 * `#dashboard` hash (see src/main.tsx), so it shares the store and gets the
 * same live device state with no separate sync path.
 *
 * What appears here, and how big each piece is, is arranged in the Widget
 * Engine tab of the main window — this just draws the saved layout. Sizing
 * comes from column and row spans rather than pixels, so one arrangement
 * works on a 4K monitor and on a small case panel.
 */
export function DashboardScreen() {
  const { ready, init, appSettings, setAppSettings, effectFlourish } = useHareStore();
  /**
   * Rearranging happens here, on the screen itself.
   *
   * This is a touch panel, usually within arm's reach, and having to walk back
   * to the PC to move a widget two inches to the left was the wrong shape for
   * it. Edit mode is off until asked for, so a normal glance at the screen
   * can't disturb anything, and it can be locked from HARE's own window for a
   * panel anyone can reach.
   */
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dashboard owns a whole monitor, so it paints edge to edge rather
  // than sitting on the app's usual page background.
  useEffect(() => {
    document.body.classList.add("hr-dashboard-body");
    return () => document.body.classList.remove("hr-dashboard-body");
  }, []);

  // Clearing the page's own background is what actually makes "None" show the
  // desktop. The window being transparent does nothing on its own while the
  // document is still painting over it.
  const transparent = appSettings.dashboard.background.kind === "none";
  useEffect(() => {
    document.documentElement.classList.toggle("hr-transparent", transparent);
    return () => document.documentElement.classList.remove("hr-transparent");
  }, [transparent]);

  if (!ready) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-hare-bg">
        <div className="h-10 w-10 rounded-full border-2 border-glow-pink border-t-transparent animate-spin" />
      </div>
    );
  }

  const placements = appSettings.dashboard.widgets;
  const background = appSettings.dashboard.background;
  const glass = cardsNeedGlass(background);
  const locked = appSettings.dashboard.locked;
  // A screen that was locked while someone had it open shouldn't stay
  // editable just because they got there first.
  const canEdit = editing && !locked;
  const selectedIndex = placements.findIndex((p) => p.id === selected);

  const close = async () => {
    const api = await getHareApi();
    await api.closeDashboard();
  };

  const saveWidgets = (widgets: DashboardWidgetPlacement[]) =>
    setAppSettings({ dashboard: { ...appSettings.dashboard, widgets } });

  const replace = (index: number, placement: DashboardWidgetPlacement) => {
    const next = [...placements];
    next[index] = placement;
    void saveWidgets(next);
  };

  const remove = (index: number) => {
    setSelected(null);
    void saveWidgets(placements.filter((_, i) => i !== index));
  };

  return (
    <div
      style={backgroundStyle(background)}
      className={`h-screen w-screen overflow-hidden flex flex-col text-hare-text ${
        background.kind === "app" ? "bg-hare-bg" : ""
      } ${glass ? "hr-dashboard-glass" : ""}`}
    >
      <header className="flex items-center justify-between px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <span className="font-display font-semibold text-lg tracking-tight">Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          {locked ? (
            <span
              className="flex items-center gap-2 rounded-2xl border border-hare-border px-4 py-3 text-sm text-hare-muted"
              title="Unlock this from HARE, under Widgets &amp; Screens"
            >
              <Lock size={16} />
              Locked
            </span>
          ) : (
            <button
              onClick={() => {
                setEditing((v) => !v);
                setSelected(null);
              }}
              aria-pressed={editing}
              className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                editing
                  ? "border-glow-pink/60 bg-glow-pink/15 text-glow-pink"
                  : "border-hare-border text-hare-muted"
              }`}
            >
              {editing ? <Check size={16} /> : <Pencil size={16} />}
              {editing ? "Done" : "Edit"}
            </button>
          )}
          <button
            onClick={() => void close()}
            aria-label="Close the dashboard"
            className="rounded-2xl border border-hare-border px-4 py-3 text-hare-muted"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {placements.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-hare-muted">
          <p className="text-lg">Add widgets from the Widgets &amp; Screens tab in HARE.</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          <div
            className="grid gap-4 h-full [grid-auto-rows:minmax(11rem,1fr)]"
            style={{ gridTemplateColumns: `repeat(${DASHBOARD_COLUMNS}, minmax(0, 1fr))` }}
          >
            {placements.map((placement, index) => (
              <div
                key={placement.id}
                draggable={canEdit}
                onDragStart={() => setDragging(index)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => canEdit && e.preventDefault()}
                onDrop={(e) => {
                  if (!canEdit || dragging === null) return;
                  e.preventDefault();
                  void saveWidgets(reorderPlacements(placements, dragging, index));
                  setDragging(null);
                }}
                onClick={() => {
                  if (!canEdit) return;
                  setSelected(selected === placement.id ? null : placement.id);
                }}
                className={`hr-widget relative min-w-0 min-h-0 [&>*]:h-full ${
                  canEdit ? "cursor-grab active:cursor-grabbing" : ""
                } ${dragging === index ? "opacity-50" : ""}`}
                style={{
                  gridColumn: `span ${placement.w}`,
                  gridRow: `span ${placement.h}`,
                  ...accentStyle(placement),
                }}
              >
                <WidgetFrame id={placement.id} />
                {canEdit && (
                  <>
                    {/* Swallows taps so a widget's own buttons can't fire
                        while the layout is being rearranged. */}
                    <div className="absolute inset-0 rounded-2xl bg-hare-bg/25" />
                    <div
                      className={`pointer-events-none absolute inset-0 rounded-2xl border-2 ${
                        selected === placement.id ? "border-glow-pink" : "border-glow-violet/50"
                      }`}
                    />
                    <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-hare-bg/85 px-2.5 py-1 text-sm font-medium">
                      {widgetName(placement.id)} · {placement.w}x{placement.h}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* The controls, as a sheet along the bottom -- there is no room for a
          popover on a card that might be one cell wide, and this is a screen
          being prodded with a finger. */}
      {canEdit && selectedIndex >= 0 && (
        <div className="shrink-0 border-t border-hare-border bg-hare-panel/95 px-6 py-5 backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="font-display text-lg font-semibold">{widgetName(placements[selectedIndex].id)}</p>
            <button
              onClick={() => setSelected(null)}
              className="rounded-xl border border-hare-border px-4 py-2 text-sm text-hare-muted"
            >
              Done
            </button>
          </div>
          <WidgetControls
            size="touch"
            placement={placements[selectedIndex]}
            onChange={(next) => replace(selectedIndex, next)}
            onRemove={() => remove(selectedIndex)}
          />
        </div>
      )}

      {canEdit && selectedIndex < 0 && (
        <p className="shrink-0 border-t border-hare-border px-6 py-4 text-center text-sm text-hare-muted">
          Drag a widget to move it. Tap one to change its size and colour.
        </p>
      )}

      <VinnyFlourish trigger={effectFlourish} />
    </div>
  );
}

export function WidgetFrame({ id }: { id: DashboardWidgetId }) {
  switch (id) {
    case "clock":
      return <ClockWidget />;
    case "lighting":
      return <LightingWidget />;
    case "quick-controls":
      return <QuickControlsWidget />;
    case "looks":
      return <LooksWidget />;
    case "ambient":
      return <AmbientWidget />;
    case "sensors":
      return <SensorsWidget />;
    case "system":
      return <StatusWidget />;
    default:
      return null;
  }
}
