import { useState } from "react";
import { AlertTriangle, Check, Download, Package, Trash2 } from "lucide-react";
import { useHareStore } from "@/state/store";

function formatBytes(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Add-on modules: what each one unlocks, what it costs, and — the part that
 * matters most — whether it overlaps with what OpenRGB already does.
 *
 * Most people need none of these. Their hardware is already driven directly
 * by OpenRGB with nothing installed, and adding a module that targets the
 * same devices means two programs fighting over one controller, which looks
 * like flickering rather than like a configuration mistake. So the overlap
 * warning is shown inline on the row rather than tucked behind a tooltip.
 */
export function ModuleList() {
  const { modules, moduleBusy, setModuleInstalled } = useHareStore();
  const [message, setMessage] = useState<Record<string, string>>({});

  if (modules.length === 0) {
    return <p className="text-xs text-hare-muted">No add-on modules are available in this build.</p>;
  }

  const handle = async (id: string, install: boolean) => {
    setMessage((prev) => ({ ...prev, [id]: "" }));
    const result = await setModuleInstalled(id, install);
    setMessage((prev) => ({
      ...prev,
      [id]: result.ok ? (install ? "Installed." : "Removed.") : result.message,
    }));
  };

  return (
    <div className="space-y-2.5">
      {modules.map((mod) => {
        const busy = moduleBusy === mod.id;
        const download = formatBytes(mod.downloadBytes);
        const onDisk = formatBytes(mod.installedBytes);
        return (
          <div key={mod.id} className="rounded-xl border border-hare-border p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Package size={14} className={mod.installed ? "text-glow-green" : "text-hare-muted"} />
                  {mod.name}
                  {mod.builtIn && (
                    <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-hare-border/60 text-hare-muted">
                      Included
                    </span>
                  )}
                </p>
                <p className="text-xs text-hare-muted mt-1">{mod.summary}</p>
                {mod.requiresVendorApp && (
                  <p className="text-[11px] text-hare-muted mt-1">Needs {mod.requiresVendorApp} installed.</p>
                )}
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {mod.installed && !mod.builtIn && (
                  <span className="text-[11px] text-hare-muted">{onDisk}</span>
                )}
                {/*
                  No button unless it can actually do something.
                  A permanently greyed-out Install reads as a feature that is
                  broken rather than one that isn't here yet — and this build
                  ships no module downloads at all, so that is every row.
                */}
                {!mod.builtIn && !mod.installed && !mod.available && (
                  <span className="whitespace-nowrap rounded-full bg-hare-border/60 px-2 py-0.5 text-[10px] font-medium text-hare-muted">
                    Not in this build
                  </span>
                )}
                {!mod.builtIn && (mod.installed || mod.available) && (
                  <button
                    onClick={() => void handle(mod.id, !mod.installed)}
                    disabled={busy}
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-hare-border px-2.5 py-1.5 text-xs font-medium text-hare-muted hover:text-hare-text hover:border-glow-violet/40 transition-colors disabled:opacity-40"
                  >
                    {busy ? (
                      "Working…"
                    ) : mod.installed ? (
                      <>
                        <Trash2 size={12} />
                        Remove
                      </>
                    ) : (
                      <>
                        <Download size={12} />
                        Install{download ? ` (${download})` : ""}
                      </>
                    )}
                  </button>
                )}
                {mod.builtIn && <Check size={14} className="text-glow-green" />}
              </div>
            </div>

            {mod.overlapsOpenRgb && (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-glow-amber/30 bg-glow-amber/10 p-2 text-[11px] text-hare-muted">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-glow-amber" />
                {mod.worthItWhen}
              </p>
            )}

            {message[mod.id] && <p className="mt-2 text-xs text-glow-violet">{message[mod.id]}</p>}
          </div>
        );
      })}
    </div>
  );
}
