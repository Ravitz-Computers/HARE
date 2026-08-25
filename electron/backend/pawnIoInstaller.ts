import { app } from "electron";
import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import { downloadVerified } from "./verifiedDownload.js";
import { APPROVED_PAWNIO_BUILDS } from "./generated/pawnIoBuild.js";
import { runElevated } from "./elevationHelper.js";

/**
 * Installing the PawnIO driver, on the user's say-so.
 *
 * HARE does not make people go and find downloads themselves, so this fetches
 * the installer — but it is a **kernel driver**, which sets two hard rules
 * that the rest of this file exists to enforce:
 *
 * **Nothing unverified is ever run.** The installer comes through the same
 * pinned-digest path as everything else HARE downloads, against a hash
 * generated from the real published bytes at build time. If this build has no
 * verified entry, HARE says so and installs nothing — it never falls back to
 * "download it anyway".
 *
 * **The user sees what they're agreeing to.** The installer runs elevated,
 * visibly, with its own window and Windows' own UAC prompt. It is deliberately
 * not silent: a program quietly installing a ring-0 driver is exactly the
 * behaviour that makes RGB software untrustworthy.
 */

export type PawnIoInstallResult = { ok: true } | { ok: false; message: string };

/**
 * The copy shipped inside HARE, if this build has one.
 *
 * Bundling is the point: needing a kernel driver for motherboard lighting is
 * already an imposition, and making someone go and find it on a website turns
 * a working app into a scavenger hunt. The bundled copy was digest-verified at
 * build time, so nothing is trusted at runtime that wasn't checked at build.
 */
export function bundledInstallerPath(): string | null {
  if (process.platform !== "win32") return null;
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "pawnio", "PawnIO-Setup.exe")
    : path.join(app.getAppPath(), "vendor", "pawnio", "PawnIO-Setup.exe");
  return existsSync(candidate) ? candidate : null;
}

/** Whether HARE can install it — from the bundled copy, or a verified download. */
export function canInstallPawnIo(): boolean {
  if (process.platform !== "win32") return false;
  return bundledInstallerPath() !== null || APPROVED_PAWNIO_BUILDS.length > 0;
}

export async function installPawnIo(): Promise<PawnIoInstallResult> {
  if (process.platform !== "win32") {
    return { ok: false, message: "PawnIO is Windows-only." };
  }
  // The bundled copy first: no network, no wait, and already verified.
  const bundled = bundledInstallerPath();
  if (bundled) {
    console.log(`[HARE] Installing PawnIO from the copy bundled with HARE: ${bundled}`);
    return runElevated(bundled, []);
  }

  const build = APPROVED_PAWNIO_BUILDS[0];
  if (!build) {
    return {
      ok: false,
      message:
        "This build of HARE doesn't carry a verified PawnIO installer, so it can't install it for you. You can install it yourself from pawnio.eu.",
    };
  }

  const targetDir = path.join(app.getPath("temp"), "hare-pawnio");
  const targetPath = path.join(targetDir, `pawnio-${build.version}.exe`);
  try {
    await fs.mkdir(targetDir, { recursive: true });
    const download = await downloadVerified(build, targetPath);
    if (!download.ok) return download;

    // Visible and elevated: the user gets the installer's own window and one
    // UAC prompt, and can cancel either.
    const result = await runElevated(targetPath, []);
    if (!result.ok) return result;
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    // The installer is never kept: leaving a downloaded executable behind is
    // both clutter and a small liability.
    await fs.rm(targetPath, { force: true }).catch(() => {});
  }
}
