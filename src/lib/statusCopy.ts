import type { BackendStatus } from "../../electron/backend/types";

/**
 * The one place HARE decides what its own state is called.
 *
 * The main window and the second-screen panel each had their own wording for
 * the same five states — "No devices detected" in one, "Not connected" in the
 * other — and only one of them applied the correction below. Two screens
 * showing the same machine disagreeing about whether it's connected is worse
 * than either wording on its own.
 */
const STATUS_COPY: Record<BackendStatus, { label: string; dot: string }> = {
  starting: { label: "Starting up…", dot: "bg-glow-amber" },
  scanning: { label: "Scanning for gear…", dot: "bg-glow-amber" },
  connected: { label: "Connected", dot: "bg-glow-green" },
  disconnected: { label: "No devices detected", dot: "bg-hare-muted" },
  error: { label: "Connection issue", dot: "bg-glow-rose" },
};

/**
 * `connected` from the backend only means there's a live socket to OpenRGB —
 * it says nothing about whether OpenRGB can see any hardware. "Connected"
 * over an empty device list is the one reading someone will act on and the
 * one that is never true, so it's corrected here rather than at each caller.
 */
export function describeStatus(
  status: BackendStatus,
  deviceCount: number
): { label: string; dot: string; busy: boolean } {
  const copy =
    status === "connected" && deviceCount === 0 ? STATUS_COPY.disconnected : STATUS_COPY[status];
  return { ...copy, busy: status === "scanning" || status === "starting" };
}
