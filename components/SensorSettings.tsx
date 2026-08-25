import { useEffect, useState } from "react";
import { Activity, Check, Download, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useHareStore } from "@/state/store";

/**
 * Settings → Hardware → System Sensors.
 *
 * Shows which sources are reporting and what each missing one needs. The
 * point of the list is that "no temperatures" is never a dead end — every
 * row that isn't working says what would make it work.
 */
export function SensorSettings() {
  const { sensors, watchSensors, refreshSensors, pawnIo, refreshPawnIo, installPawnIo } = useHareStore();
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Watching here as well as on the dashboard means the panel shows live
  // numbers while it's open, and stops the moment it isn't.
  useEffect(() => {
    void watchSensors(true);
    void refreshPawnIo();
    return () => {
      void watchSensors(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setBusy(true);
    try {
      await Promise.all([refreshSensors(), refreshPawnIo()]);
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setMessage(null);
    try {
      const result = await installPawnIo();
      setMessage(result.ok ? "Installed. Restart your PC to finish." : result.message);
    } finally {
      setInstalling(false);
    }
  };

  const working = sensors.sources.filter((s) => s.available);

  return (
    <section className="hr-card p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Activity size={17} className="text-glow-violet" />
          <h2 className="font-display font-semibold">System Sensors</h2>
        </div>
        <button
          onClick={() => void handleRefresh()}
          disabled={busy}
          className="hr-btn-sm"
        >
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          Check again
        </button>
      </div>
      <p className="text-xs text-hare-muted mb-4">
        Temperatures, load and fan speeds — used by the Thermal effect and the second-screen dashboard.
        {working.length > 0 && ` ${sensors.readings.length} sensors from ${working.length} source${working.length === 1 ? "" : "s"}.`}
      </p>

      <div className="space-y-2">
        {sensors.sources.map((source) => (
          <div
            key={source.id}
            className="flex items-start gap-2.5 rounded-xl border border-hare-border p-3.5 text-sm"
          >
            {source.available ? (
              <Check size={15} className="mt-0.5 shrink-0 text-glow-green" />
            ) : (
              <X size={15} className="mt-0.5 shrink-0 text-hare-muted" />
            )}
            <div className="min-w-0">
              <p className="font-medium">{source.name}</p>
              <p className="text-xs text-hare-muted mt-0.5">{source.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-hare-border p-3.5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck size={15} className={pawnIo.installed ? "text-glow-green" : "text-glow-amber"} />
          PawnIO driver
        </p>
        <p className="text-xs text-hare-muted mt-1">{pawnIo.detail}</p>
        {pawnIo.installed && !pawnIo.running && (
          <p className="mt-2 rounded-lg border border-glow-amber/30 bg-glow-amber/10 p-2 text-xs text-hare-muted">
            It's installed but not running, so it isn't doing anything yet. A restart usually starts it.
          </p>
        )}
        {!pawnIo.installed && (
          <>
            <p className="text-xs text-hare-muted mt-2">
              A small signed driver that reaches the bus your motherboard and RAM lighting live on —
              Windows doesn't let ordinary programs touch it. It ships with HARE, installs once, and asks
              for administrator rights while it does. It also unlocks CPU temperature and fan speeds.
            </p>
            {pawnIo.canInstall ? (
              <button
                onClick={() => void handleInstall()}
                disabled={installing}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-hare-border px-3 py-2 text-xs font-medium text-hare-muted hover:text-hare-text hover:border-glow-violet/40 transition-colors disabled:opacity-60"
              >
                <Download size={13} className={installing ? "animate-pulse" : ""} />
                {installing ? "Installing…" : "Install PawnIO"}
              </button>
            ) : (
              <p className="text-xs text-hare-muted mt-2">
                This build of HARE doesn't carry it — it's available from pawnio.eu.
              </p>
            )}
          </>
        )}
        {message && <p className="mt-2 text-xs text-glow-violet">{message}</p>}
      </div>
    </section>
  );
}
