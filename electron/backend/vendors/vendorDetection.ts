import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VENDOR_DEFINITIONS } from "./vendorDefinitions.js";
import type { VendorId } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Lists currently-running process image names on Windows via `tasklist`
 * (a built-in Windows command — no new dependency). Returns an empty set
 * on any non-Windows platform or if the command fails for any reason
 * (never throws) — detection degrading to "nothing detected" is always
 * the safe failure mode here, never a crash.
 */
export async function listWindowsProcessNames(): Promise<Set<string>> {
  if (process.platform !== "win32") return new Set();
  try {
    // /FO CSV /NH = CSV output, no header row — the first quoted column is
    // the image name, e.g. "iCUE.exe","1234","Console","1","123,456 K".
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
      windowsHide: true,
      timeout: 5000,
    });
    const names = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^"([^"]+)"/.exec(line);
      if (match) names.add(match[1].toLowerCase());
    }
    return names;
  } catch (err) {
    console.warn("[HARE] Couldn't list running processes for vendor detection:", err);
    return new Set();
  }
}

/** Which of VENDOR_DEFINITIONS' vendors currently have a matching process running. */
export async function detectRunningVendors(): Promise<Record<VendorId, boolean>> {
  const running = await listWindowsProcessNames();
  const result = {} as Record<VendorId, boolean>;
  for (const vendor of VENDOR_DEFINITIONS) {
    result[vendor.id] = vendor.processNames.some((name) => running.has(name.toLowerCase()));
  }
  return result;
}
