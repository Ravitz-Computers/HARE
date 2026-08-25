import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import type { PawnIoStatus } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Whether PawnIO is installed on this PC.
 *
 * WHY HARE CARES
 *
 * Motherboard, RAM and GPU lighting is reached over SMBus, which is a ring-0
 * operation. OpenRGB used to do that through WinRing0 — until Microsoft added
 * WinRing0 to the vulnerable-driver blocklist and Defender began flagging it
 * (CVE-2020-14979), which broke a long list of well-known tools. OpenRGB's
 * answer, from 1.0rc2 onwards, was to move to **PawnIO**: a signed,
 * open-source driver whose modules cover SMBus, Super I/O and CPU registers.
 *
 * So on a current build, PawnIO is what actually unlocks motherboard and RAM
 * lighting — the elevated OpenRGB task alone is no longer enough. HARE
 * detects it and says so, rather than leaving someone staring at a device
 * list that is missing half their PC with no explanation.
 *
 * It is also, usefully, the same driver that would unlock CPU package
 * temperature and case-fan RPM — the two things HARE's sensor sources can't
 * reach on their own. One install, both payoffs.
 *
 * HARE never installs it silently. It is a kernel driver; that is a decision
 * for the user, taken once, with a prompt they can read.
 */

export const PAWNIO_SERVICE_NAME = "PawnIO";

/** Where the official installer puts things, checked as a fallback when the service query says nothing. */
const INSTALL_PATHS = [
  "C:\\Program Files\\PawnIO\\PawnIOLib.dll",
  "C:\\Program Files\\PawnIO\\PawnIO.sys",
  "C:\\Windows\\System32\\PawnIOLib.dll",
];

/**
 * Reads `sc query` output.
 *
 * `sc` reports a missing service as a failure rather than as "not running",
 * so the absence of output is itself the common case and must not read as an
 * error. When the service does exist, its STATE line is what distinguishes
 * installed-and-running from installed-but-stopped — a stopped driver is why
 * lighting can disappear after an update without anything else changing.
 */
export function parseServiceState(stdout: string): { exists: boolean; running: boolean } {
  if (!/SERVICE_NAME/i.test(stdout)) return { exists: false, running: false };
  const state = /STATE\s*:\s*\d+\s+(\w+)/i.exec(stdout);
  return { exists: true, running: (state?.[1] ?? "").toUpperCase() === "RUNNING" };
}

/** Never throws — a detection failure means "can't tell", which is reported as not installed. */
export async function detectPawnIo(
  query: (service: string) => Promise<string> = defaultQuery,
  fileExists: (path: string) => boolean = existsSync
): Promise<PawnIoStatus> {
  if (process.platform !== "win32") {
    return { installed: false, running: false, detail: "Windows only." };
  }

  let state = { exists: false, running: false };
  try {
    state = parseServiceState(await query(PAWNIO_SERVICE_NAME));
  } catch {
    // Not installed, or `sc` refused to answer. Fall through to the files.
  }

  const onDisk = state.exists || INSTALL_PATHS.some((path) => fileExists(path));
  if (!onDisk) {
    return {
      installed: false,
      running: false,
      detail: "Not installed. Motherboard and RAM lighting, CPU temperature and fan speeds need it.",
    };
  }
  if (!state.running) {
    return {
      installed: true,
      running: false,
      detail: "Installed but not running. Restarting your PC usually starts it.",
    };
  }
  return { installed: true, running: true, detail: "Installed and running." };
}

async function defaultQuery(service: string): Promise<string> {
  const { stdout } = await execFileAsync("sc", ["query", service], { windowsHide: true, timeout: 4000 });
  return stdout;
}
