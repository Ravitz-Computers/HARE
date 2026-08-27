import { useState } from "react";
import { useHareStore } from "@/state/store";
import { EffectPreviewSwatch } from "@/components/EffectPreviewSwatch";

/** Saved looks from the Gallery, applied to every device with one tap. */
export function LooksWidget() {
  const { gallery, state, applyLook } = useHareStore();
  const [busy, setBusy] = useState<string | null>(null);

  const apply = async (lookId: string) => {
    setBusy(lookId);
    try {
      for (const device of state.devices) {
        await applyLook(lookId, device.id);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hr-card p-6 flex flex-col overflow-hidden h-full">
      <h2 className="font-display font-semibold text-lg mb-4 shrink-0">Saved Looks</h2>
      {gallery.length === 0 ? (
        <p className="text-hare-muted">Nothing saved yet. Save a look from the Gallery and it shows up here.</p>
      ) : (
        <div className="grid gap-3 overflow-y-auto pr-1 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] [grid-auto-rows:min-content]">
          {gallery.slice(0, 8).map((look) => (
            <button
              key={look.id}
              disabled={busy !== null || state.devices.length === 0}
              onClick={() => void apply(look.id)}
              className="rounded-2xl border border-hare-border p-4 text-left disabled:opacity-40"
            >
              <p className="font-medium truncate">{look.name}</p>
              <EffectPreviewSwatch
                effectId={look.effectId}
                color={look.color}
                secondaryColor={look.secondaryColor}
                speed={look.speed}
                dots={8}
                className="mt-2"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
