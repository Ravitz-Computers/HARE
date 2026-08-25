import { LayoutGrid, Sparkles, Settings as SettingsIcon, Images, MonitorSmartphone } from "lucide-react";
import { Logo } from "./Logo";
import { StatusPill } from "./StatusPill";
import type { BackendState } from "../../electron/backend/types";

export type Page = "dashboard" | "effects" | "gallery" | "widgets" | "settings";

const NAV: { id: Page; label: string; icon: typeof LayoutGrid }[] = [
  { id: "dashboard", label: "My Devices", icon: LayoutGrid },
  { id: "effects", label: "Effects", icon: Sparkles },
  { id: "gallery", label: "Gallery", icon: Images },
  { id: "widgets", label: "Widget Engine", icon: MonitorSmartphone },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar({
  page,
  onNavigate,
  state,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  state: BackendState;
}) {
  return (
    <aside className="w-64 shrink-0 h-full border-r border-hare-border flex flex-col bg-hare-panel/60">
      <div className="px-6 py-6">
        <Logo size={34} withWordmark />
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {NAV.map((item) => {
          const active = page === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand-gradient text-white shadow-glow"
                  : "text-hare-muted hover:text-hare-text hover:bg-hare-panel2"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-4 pb-5 pt-3 border-t border-hare-border">
        <StatusPill status={state.status} deviceCount={state.devices.length} />
        <p className="text-[11px] text-hare-muted/70 mt-3 px-1 leading-relaxed">
          HARE by Ravitz Computers
        </p>
      </div>
    </aside>
  );
}
