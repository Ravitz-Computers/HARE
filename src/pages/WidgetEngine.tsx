import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Monitor, MonitorX, Plus, RefreshCw } from "lucide-react";
import { useHareStore } from "@/state/store";
import { WidgetCanvas } from "../components/WidgetCanvas";
import { BackgroundPicker } from "../components/BackgroundPicker";
import { ScreenControls } from "../components/ScreenControls";
import {
  DASHBOARD_WIDGETS,
  type DashboardBackground,
  type DashboardWidgetPlacement,
} from "../../electron/backend/types";

/**
 * The Widget Engine: everything HARE can draw on that isn't a light.
 *
 * A spare monitor becomes a touch panel showing your lighting, the time, and
 * whatever else you put on it; an AIO cooler's screen takes an image or a GIF.
 * Both are features rather than settings, which is why they live on their own
 * tab instead of being buried in Settings.
 */
export function WidgetEngine() {
  const {
    appSettings,
    setAppSettings,
    monitors,
    refreshMonitors,
    openDashboard,
    closeDashboard,
    displayDevices,
    displayDevicesLoading,
    refreshDisplayDevices,
  } = useHareStore();
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const dash = appSettings.dashboard;

  useEffect(() => {
    void refreshMonitors();
    void refreshDisplayDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hidden = new Set(dash.hiddenDisplayIds);
  // The primary display is excluded because the dashboard would cover the
  // screen you're using to set it up.
  const candidates = monitors.filter((m) => !m.isPrimary);
  const others = candidates.filter((m) => !hidden.has(m.id));
  const hiddenMonitors = candidates.filter((m) => hidden.has(m.id));
  const chosen = dash.displayId ?? others[0]?.id ?? null;

  const setHidden = (displayId: number, hide: boolean) => {
    const next = hide
      ? [...dash.hiddenDisplayIds, displayId]
      : dash.hiddenDisplayIds.filter((id) => id !== displayId);
    void setAppSettings({ dashboard: { ...dash, hiddenDisplayIds: [...new Set(next)] } });
    // Hiding the monitor the dashboard is currently on would leave it showing
    // somewhere the user has just said they don't want it.
    if (hide && dash.enabled && chosen === displayId) void closeDashboard();
  };
  const used = new Set(dash.widgets.map((w) => w.id));
  const available = DASHBOARD_WIDGETS.filter((w) => !used.has(w.id));

  const saveWidgets = (widgets: DashboardWidgetPlacement[]) =>
    setAppSettings({ dashboard: { ...dash, widgets } });

  /**
   * Removing the background makes the window itself transparent, which
   * Electron can only decide when the window is created — so an open screen
   * is closed and reopened for that one change.
   */
  const saveBackground = async (background: DashboardBackground) => {
    const transparencyChanged = (dash.background.kind === "none") !== (background.kind === "none");
    await setAppSettings({ dashboard: { ...dash, background } });
    if (transparencyChanged && dash.enabled) {
      await closeDashboard();
      await openDashboard(chosen);
    }
  };

  const addWidget = (id: DashboardWidgetPlacement["id"]) =>
    void saveWidgets([...dash.widgets, { id, w: 1, h: 1 }]);

  const show = async (displayId: number | null) => {
    setBusy(true);
    try {
      await openDashboard(displayId);
    } finally {
      setBusy(false);
    }
  };

  const hide = async () => {
    setBusy(true);
    try {
      await closeDashboard();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Widget Engine</h1>
        <p className="text-hare-muted text-sm mt-1">
          Turn a spare monitor into a control panel, and put images on your cooler's screen.
        </p>
      </div>

      <div className="space-y-6">
        <section className="hr-card p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Monitor size={17} className="text-glow-violet" />
              <h2 className="font-display font-semibold">Second Screen</h2>
            </div>
            <button
              onClick={() => void refreshMonitors()}
              className="flex items-center gap-1.5 text-xs text-hare-muted hover:text-hare-text transition-colors"
            >
              <RefreshCw size={12} />
              Recheck
            </button>
          </div>
          <p className="text-xs text-hare-muted mb-4">
            Fills a monitor — including a case screen plugged into your graphics card — with this
            layout. Drag to rearrange. Hover a widget for its size, colour and remove buttons.
            Changes show up straight away.
          </p>

          <WidgetCanvas
            placements={dash.widgets}
            background={dash.background}
            onChange={(next) => void saveWidgets(next)}
          />

          <div className="mt-4">
            <BackgroundPicker value={dash.background} onChange={(next) => void saveBackground(next)} />
          </div>

          {/*
            The second screen can be rearranged from the screen itself, which
            is the point of a touch panel — right up until it's somewhere
            anyone can reach. Locking is set here, never there, so the screen
            can't unlock itself.
          */}
          <div className="mt-3 flex items-start justify-between gap-4 rounded-xl border border-hare-border p-3.5">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Lock size={15} className={dash.locked ? "text-glow-amber" : "text-hare-muted"} />
                Lock the layout
              </p>
              <p className="mt-1 text-xs text-hare-muted">
                Stops the second screen being rearranged by touch. You can still change it here.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={dash.locked}
              aria-label="Lock the second screen's layout"
              onClick={() => void setAppSettings({ dashboard: { ...dash, locked: !dash.locked } })}
              title={dash.locked ? "Locked - click to unlock" : "Unlocked - click to lock"}
              className={`h-6 w-6 shrink-0 rounded-full border-2 transition-colors ${
                dash.locked
                  ? "border-glow-amber bg-glow-amber shadow-[0_0_10px_0_rgba(255,200,87,0.5)]"
                  : "border-hare-border bg-transparent hover:border-hare-muted"
              }`}
            />
          </div>

          {available.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-hare-muted mb-2">Add a widget</p>
              <div className="flex flex-wrap gap-2">
                {available.map((widget) => (
                  <button
                    key={widget.id}
                    onClick={() => addWidget(widget.id)}
                    title={widget.description}
                    className="flex items-center gap-1.5 rounded-lg border border-hare-border px-2.5 py-1.5 text-xs font-medium text-hare-muted hover:text-hare-text hover:border-glow-violet/40 transition-colors"
                  >
                    <Plus size={12} />
                    {widget.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-hare-border">
            {monitors.length <= 1 ? (
              <p className="flex items-center gap-2 text-sm text-hare-muted">
                <MonitorX size={15} />
                Only one monitor detected — connect another to use this.
              </p>
            ) : (
              <>
                <p className="text-xs text-hare-muted mb-2">Show it on</p>
                {others.length === 0 ? (
                  <p className="text-sm text-hare-muted">
                    Every other monitor is hidden. Show one below to use it.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {others.map((monitor) => {
                      const active = dash.enabled && chosen === monitor.id;
                      return (
                        <div
                          key={monitor.id}
                          className={`flex items-center gap-2 rounded-xl border transition-colors ${
                            active
                              ? "border-glow-green/60 bg-glow-green/10"
                              : "border-hare-border hover:border-glow-violet/40"
                          }`}
                        >
                          <button
                            disabled={busy}
                            onClick={() => void show(monitor.id)}
                            className="flex-1 flex items-center justify-between gap-3 p-4 text-left disabled:opacity-60"
                          >
                            <span className="text-sm font-medium">{monitor.label}</span>
                            <span className="text-xs text-hare-muted">
                              {active ? "Showing here" : "Show here"}
                            </span>
                          </button>
                          <button
                            onClick={() => setHidden(monitor.id, true)}
                            title="Hide this monitor"
                            aria-label={`Hide ${monitor.label}`}
                            className="shrink-0 p-4 text-hare-muted hover:text-hare-text transition-colors"
                          >
                            <EyeOff size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {hiddenMonitors.length > 0 && (
                  <div className="mt-3">
                    <button
                      onClick={() => setShowHidden((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-hare-muted hover:text-hare-text transition-colors"
                    >
                      <Eye size={12} />
                      {showHidden ? "Hide" : "Show"} {hiddenMonitors.length} hidden monitor
                      {hiddenMonitors.length === 1 ? "" : "s"}
                    </button>
                    {showHidden && (
                      <div className="mt-2 space-y-2">
                        {hiddenMonitors.map((monitor) => (
                          <div
                            key={monitor.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-hare-border p-3.5 opacity-70"
                          >
                            <span className="text-sm">{monitor.label}</span>
                            <button
                              onClick={() => setHidden(monitor.id, false)}
                              className="flex items-center gap-1.5 text-xs font-medium text-hare-muted hover:text-hare-text"
                            >
                              <Eye size={13} />
                              Unhide
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {dash.enabled && (
                  <button
                    onClick={() => void hide()}
                    disabled={busy}
                    className="mt-3 rounded-xl border border-hare-border px-3.5 py-2 text-sm font-medium text-hare-muted hover:text-hare-text transition-colors disabled:opacity-60"
                  >
                    Close it
                  </button>
                )}
              </>
            )}
          </div>
        </section>

        <section className="hr-card p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Monitor size={17} className="text-glow-violet" />
              <h2 className="font-display font-semibold">Cooler Screens</h2>
            </div>
            <button
              onClick={() => void refreshDisplayDevices()}
              disabled={displayDevicesLoading}
              className="flex items-center gap-1.5 text-xs text-hare-muted hover:text-hare-text disabled:opacity-50"
            >
              <RefreshCw size={12} className={displayDevicesLoading ? "animate-spin" : ""} />
              Recheck
            </button>
          </div>
          <p className="text-xs text-hare-muted mb-4">
            AIO coolers and small panels HARE drives over USB. Send a still image or a GIF, or put one
            back to stock. A case screen that plugs into your graphics card is a monitor as far as
            Windows is concerned — it appears in the list above, and can run the full dashboard.
          </p>
          {displayDevices.length === 0 ? (
            <p className="text-sm text-hare-muted">
              No cooler screen detected. This appears when one is plugged in.
            </p>
          ) : (
            <div className="space-y-4">
              {displayDevices.map((screen) => (
                <ScreenControls key={`${screen.vendorId}:${screen.productId}`} screen={screen} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
