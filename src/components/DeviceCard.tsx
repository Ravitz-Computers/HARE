import { motion } from "framer-motion";
import { deviceIcon } from "./icons";
import { LedPreview } from "./LedPreview";
import { friendlyDeviceType } from "@/lib/deviceClassification";
import type { KLDevice } from "../../electron/backend/types";
import { AlertTriangle } from "lucide-react";
import { EFFECTS } from "../../electron/backend/types";

export function DeviceCard({ device, onOpen }: { device: KLDevice; onOpen: () => void }) {
  const Icon = deviceIcon(device);
  const effectName = device.activeEffectId
    ? EFFECTS.find((e) => e.id === device.activeEffectId)?.name
    : null;

  return (
    <motion.button
      onClick={onOpen}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      className="hr-card group text-left p-5 flex flex-col gap-4 hover:border-glow-pink/50 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-hare-panel2 border border-hare-border flex items-center justify-center text-glow-pink group-hover:shadow-glow transition-shadow">
            <Icon size={20} />
          </div>
          <div>
            <p className="font-display font-semibold text-sm leading-tight">{device.name}</p>
            <p className="text-xs text-hare-muted mt-0.5">
              {device.vendor} · {friendlyDeviceType(device)}
            </p>
          </div>
        </div>
      </div>

      {device.unresponsive && (
        <p className="flex items-start gap-1.5 rounded-lg border border-glow-amber/30 bg-glow-amber/10 p-2 text-[11px] text-hare-muted">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-glow-amber" />
          Took the colour but didn't change. See <b>Settings → Hardware → Lighting Not Changing?</b>
        </p>
      )}

      <LedPreview colors={device.colors} />

      <div className="flex items-center justify-between text-xs">
        <span className="text-hare-muted">
          {device.zones.length} zone{device.zones.length !== 1 ? "s" : ""} · {device.colors.length} LEDs
        </span>
        {effectName ? (
          <span className="rounded-full bg-glow-violet/15 text-glow-violet px-2.5 py-1 font-medium">
            {effectName}
          </span>
        ) : (
          <span className="rounded-full bg-hare-panel2 text-hare-muted px-2.5 py-1 font-medium">
            Static
          </span>
        )}
      </div>
    </motion.button>
  );
}
