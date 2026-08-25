import { useEffect, useState } from "react";
import { Check, Cpu, ShieldCheck } from "lucide-react";
import { useHareStore } from "@/state/store";

/**
 * The one permission HARE ever asks for, asked once.
 *
 * Motherboard, RAM and some GPU lighting is reached over a bus that only a
 * program with administrator rights can touch. HARE itself deliberately runs
 * unelevated — it starts with Windows, and an app that demands a UAC prompt
 * at every boot is an app people turn off. So instead it registers one
 * scheduled task that starts OpenRGB with the rights it needs at logon.
 *
 * That means exactly one prompt, once, and it survives restarts. Everything
 * plugged in over USB — keyboards, mice, coolers, fan hubs, strips — works
 * without any of this.
 *
 * Declining is a real answer. It's remembered, nothing asks again, and
 * Settings → Hardware is where someone changes their mind.
 */
export function HardwareAccessStep({ onDone }: { onDone: () => void }) {
  const { elevation, elevationBusy, setElevationEnabled, pawnIo, refreshPawnIo, installPawnIo, setAppSettings } =
    useHareStore();
  const [message, setMessage] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void refreshPawnIo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remember = () => setAppSettings({ hasAskedForHardwareAccess: true });

  const grant = async () => {
    setMessage(null);
    const result = await setElevationEnabled(true);
    await remember();
    if (!result.ok) setMessage(result.message);
  };

  const addDriver = async () => {
    setInstalling(true);
    setMessage(null);
    try {
      const result = await installPawnIo();
      if (!result.ok) setMessage(result.message);
    } finally {
      setInstalling(false);
    }
  };

  const skip = async () => {
    await remember();
    onDone();
  };

  return (
    <div className="text-left">
      <div className="flex justify-center mb-5">
        <span className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-brand-gradient shadow-glow">
          <ShieldCheck size={26} className="text-white" />
        </span>
      </div>
      <h1 className="font-display text-xl font-semibold text-center">One-time permission</h1>
      <p className="text-hare-muted text-sm mt-2 leading-relaxed text-center">
        Your motherboard and RAM lighting need Windows permission to reach. Grant it once and HARE
        remembers — it won't ask again, and it won't ask at startup.
      </p>

      <div className="mt-6 space-y-2.5">
        <div className="flex items-start gap-3 rounded-xl border border-hare-border p-3.5">
          <Cpu size={16} className={elevation.enabled ? "mt-0.5 text-glow-green" : "mt-0.5 text-hare-muted"} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Motherboard &amp; RAM lighting</p>
            <p className="text-xs text-hare-muted mt-0.5">
              {elevation.enabled
                ? "Granted. This survives restarts."
                : elevation.supported
                  ? "Windows will ask you to confirm once."
                  : "Only available on Windows."}
            </p>
          </div>
          {elevation.enabled ? (
            <Check size={16} className="mt-0.5 shrink-0 text-glow-green" />
          ) : (
            <button
              onClick={() => void grant()}
              disabled={elevationBusy || !elevation.supported}
              className="shrink-0 rounded-lg bg-brand-gradient px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {elevationBusy ? "Asking…" : "Grant"}
            </button>
          )}
        </div>

        {!pawnIo.installed && pawnIo.canInstall && (
          <div className="flex items-start gap-3 rounded-xl border border-hare-border p-3.5">
            <ShieldCheck size={16} className="mt-0.5 text-hare-muted" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">PawnIO driver</p>
              <p className="text-xs text-hare-muted mt-0.5">
                A small signed driver that lets HARE reach motherboard and RAM lighting. It ships with
                HARE — this just installs it. Also unlocks CPU temperature and fan speeds.
              </p>
            </div>
            <button
              onClick={() => void addDriver()}
              disabled={installing}
              className="shrink-0 rounded-lg border border-hare-border px-3 py-1.5 text-xs font-medium text-hare-muted hover:text-hare-text disabled:opacity-40"
            >
              {installing ? "Installing…" : "Install"}
            </button>
          </div>
        )}
      </div>

      {message && <p className="mt-3 text-xs text-glow-amber">{message}</p>}

      <div className="mt-6 flex gap-2">
        <button
          onClick={() => void skip()}
          className="flex-1 rounded-xl border border-hare-border py-3 text-sm font-medium text-hare-muted hover:text-hare-text transition-colors"
        >
          Not now
        </button>
        <button
          onClick={() => void (async () => {
            await remember();
            onDone();
          })()}
          className="flex-1 rounded-xl bg-brand-gradient py-3 text-sm font-medium text-white shadow-glow"
        >
          Done
        </button>
      </div>

      <p className="text-[11px] text-hare-muted/70 mt-3 text-center">
        Everything plugged in over USB works either way.
      </p>
    </div>
  );
}
