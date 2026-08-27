import { useState } from "react";
import { Power } from "lucide-react";
import { useHareStore } from "@/state/store";
import { EffectPreviewSwatch } from "@/components/EffectPreviewSwatch";
import type { EffectId, KLColor } from "../../../electron/backend/types";

const QUICK_EFFECTS: { id: EffectId; name: string; color: KLColor }[] = [
  { id: "rainbow-wave", name: "Rainbow", color: { r: 255, g: 46, b: 122 } },
  { id: "spectrum-cycle", name: "Color Cycle", color: { r: 139, g: 63, b: 251 } },
  { id: "breathing", name: "Breathing", color: { r: 255, g: 46, b: 122 } },
  { id: "comet", name: "Comet", color: { r: 34, g: 211, b: 238 } },
];

const QUICK_COLORS: { name: string; color: KLColor }[] = [
  { name: "Pink", color: { r: 255, g: 46, b: 122 } },
  { name: "Violet", color: { r: 139, g: 63, b: 251 } },
  { name: "Cyan", color: { r: 34, g: 211, b: 238 } },
  { name: "Green", color: { r: 61, g: 220, b: 151 } },
  { name: "Amber", color: { r: 255, g: 180, b: 87 } },
  { name: "White", color: { r: 255, g: 255, b: 255 } },
];

/** One-tap looks for everything at once, plus lights out. */
export function QuickControlsWidget() {
  const { syncAll, state } = useHareStore();
  const [busy, setBusy] = useState<string | null>(null);
  const disabled = state.devices.length === 0;

  const run = async (key: string, effectId: EffectId, color: KLColor) => {
    setBusy(key);
    try {
      await syncAll(effectId, color, { r: 0, g: 0, b: 0 }, 45, 100);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hr-card p-6 flex flex-col overflow-y-auto h-full">
      <h2 className="font-display font-semibold text-lg mb-4 shrink-0">Quick Controls</h2>

      <div className="grid grid-cols-2 gap-3">
        {QUICK_EFFECTS.map((e) => (
          <button
            key={e.id}
            disabled={disabled || busy !== null}
            onClick={() => void run(e.id, e.id, e.color)}
            className="rounded-2xl border border-hare-border p-4 text-left disabled:opacity-40"
          >
            <p className="font-medium">{e.name}</p>
            <EffectPreviewSwatch effectId={e.id} color={e.color} dots={8} className="mt-2" />
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-6 gap-2">
        {QUICK_COLORS.map((c) => (
          <button
            key={c.name}
            aria-label={c.name}
            disabled={disabled || busy !== null}
            onClick={() => void run(c.name, "static", c.color)}
            className="aspect-square rounded-2xl disabled:opacity-40"
            style={{
              backgroundColor: `rgb(${c.color.r}, ${c.color.g}, ${c.color.b})`,
              // The inset hairline is what keeps a white swatch visible on a
              // light background; the outer glow is the swatch's own color.
              boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.18), 0 0 16px -2px rgba(${c.color.r}, ${c.color.g}, ${c.color.b}, 0.6)`,
            }}
          />
        ))}
      </div>

      <button
        disabled={disabled || busy !== null}
        onClick={() => void run("off", "static", { r: 0, g: 0, b: 0 })}
        className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl border border-hare-border py-4 font-medium text-hare-muted disabled:opacity-40"
      >
        <Power size={18} />
        Lights Out
      </button>
    </div>
  );
}
