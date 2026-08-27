import { AlertTriangle, Cpu, Zap } from "lucide-react";
import { useHareStore } from "@/state/store";
import { describeStatus } from "@/lib/statusCopy";

/** Devices found, what HARE is doing, and anything currently in its way. */
export function StatusWidget() {
  const { state, conflicts } = useHareStore();
  const lit = state.devices.filter((d) => d.activeEffectId !== null).length;
  const status = describeStatus(state.status, state.devices.length);

  return (
    <div className="hr-card p-6 flex flex-col overflow-y-auto h-full">
      <h2 className="font-display font-semibold text-lg mb-4 shrink-0">Status</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-hare-border p-4">
          <p className="flex items-center gap-2 text-sm text-hare-muted">
            <Cpu size={15} />
            Devices
          </p>
          <p className="font-display font-bold text-3xl mt-1 tabular-nums">{state.devices.length}</p>
        </div>
        <div className="rounded-2xl border border-hare-border p-4">
          <p className="flex items-center gap-2 text-sm text-hare-muted">
            <Zap size={15} />
            Lit up
          </p>
          <p className="font-display font-bold text-3xl mt-1 tabular-nums">{lit}</p>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${status.dot}`} />
        {status.label}
      </p>

      {conflicts.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl border border-glow-amber/30 bg-glow-amber/10 p-3 text-sm text-hare-muted">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-glow-amber" />
          {conflicts.map((c) => c.name).join(", ")} {conflicts.length === 1 ? "is" : "are"} running and will
          stop HARE seeing some hardware.
        </p>
      )}
    </div>
  );
}
