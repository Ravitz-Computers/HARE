import { describeStatus } from "@/lib/statusCopy";
import type { BackendStatus } from "../../electron/backend/types";

export function StatusPill({ status, deviceCount }: { status: BackendStatus; deviceCount: number }) {
  const copy = describeStatus(status, deviceCount);
  return (
    <div className="flex items-center gap-2 rounded-full bg-hare-panel2 border border-hare-border px-3 py-1.5 text-xs font-medium text-hare-muted">
      <span className={`h-2 w-2 rounded-full ${copy.dot} ${status === "scanning" ? "animate-pulseGlow" : ""}`} />
      <span className="text-hare-text">{copy.label}</span>
    </div>
  );
}
