import { useState } from "react";
import { ChevronDown, Sliders, Paintbrush, ListTree } from "lucide-react";
import { ModeParamsEditor } from "./ModeParamsEditor";
import { LedPainter } from "./LedPainter";
import { RawDiagnostics } from "./RawDiagnostics";
import type { KLDevice } from "../../electron/backend/types";

const TABS = [
  { id: "params", label: "Mode Parameters", icon: Sliders },
  { id: "paint", label: "LED Painter", icon: Paintbrush },
  { id: "raw", label: "Raw Data", icon: ListTree },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Full native-mode parameter editing, per-LED painting, and a raw data dump — everything OpenRGB reports for this device. */
export function AdvancedMode({ device }: { device: KLDevice }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("params");

  return (
    <section className="hr-card p-6 mt-6">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <div className="text-left">
          <h2 className="font-display font-semibold mb-1">Advanced Mode</h2>
          <p className="text-xs text-hare-muted">Direct access to this device's full mode and LED data.</p>
        </div>
        <ChevronDown size={18} className={`text-hare-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-5 pt-5 border-t border-hare-border">
          <div className="flex flex-wrap gap-2 mb-5">
            {TABS.map(({ id, label, icon: TabIcon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                  tab === id
                    ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                    : "border-hare-border text-hare-muted hover:text-hare-text"
                }`}
              >
                <TabIcon size={13} />
                {label}
              </button>
            ))}
          </div>

          {tab === "params" && <ModeParamsEditor device={device} />}
          {tab === "paint" && <LedPainter device={device} />}
          {tab === "raw" && <RawDiagnostics device={device} />}
        </div>
      )}
    </section>
  );
}
