import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
  cpSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import extractZip from "extract-zip";
import { downloadVerified, type PinnedArtifact } from "./verifiedDownload.js";
import { APPROVED_OPENRGB_BUILDS } from "./generated/openrgbBuilds.js";
import type { DeviceDbStatus } from "./types.js";

/**
 * OpenRGB doesn't ship a separate downloadable "device support" file — new
 * device compatibility ships as new OpenRGB releases. So "keep the device
 * database up to date" for HARE means: know which OpenRGB build is
 * currently bundled, check Codeberg (where the OpenRGB project publishes
 * releases) for a newer one, and — since the whole point of HARE is that
 * the user never has to think about this — download and swap it in
 * automatically when one's available.
 *
 * This mirrors the logic in scripts/build.ps1's Resolve-OpenRgb function,
 * but runs from inside the packaged app at startup/on-demand instead of
 * only once during the initial build.
 */

const RELEASES_API_URL = "https://codeberg.org/api/v1/repos/OpenRGB/OpenRGB/releases/latest";

/**
 * The OpenRGB builds HARE is willing to install.
 *
 * Generated, never hand-written — see scripts/openrgb-manifest.mjs. Every
 * entry's digest is computed from the real downloaded bytes at build time,
 * because a hash someone has to remember to update by hand is a security
 * check that silently rots. An empty list is a safe state: it means automatic
 * OpenRGB updates are unavailable in this build, not that verification is off.
 *
 * The update API is used only to *notice* that a newer version exists.
 * Installing it still requires an entry here, so nothing the API says can
 * decide which bytes get executed.
 */

/** Looks up an approved build by the version tag the API reported. */
function approvedBuildFor(version: string | null): PinnedArtifact | null {
  if (!version) return null;
  return APPROVED_OPENRGB_BUILDS.find((b) => b.version === version) ?? null;
}

/**
 * Only the version tag is read from the API response. The download URL and
 * asset list are deliberately not modelled: HARE resolves what to install
 * from APPROVED_BUILDS, so nothing the API says can influence which bytes
 * get executed.
 */
interface CodebergRelease {
  tag_name: string;
}

export interface DeviceDatabaseOptions {
  /** Directory containing (or that should contain) OpenRGB.exe — vendor/openrgb in dev, resources/openrgb when packaged. */
  openRgbDir: string;
}

/**
 * extract-zip (the library used below) has an unpatched "Zip Slip"-style
 * vulnerability (GHSA-jmr9-qjv8-65gv / CVE-2026-56876, no fixed release
 * exists as of extract-zip@2.0.1, the current latest): a malicious zip can
 * contain a symlink entry whose target escapes the extraction directory
 * (e.g. "../../../../etc/passwd" or, on Windows, an absolute path), and the
 * library creates that symlink without checking. This app only ever
 * extracts a specific pinned OpenRGB release fetched over HTTPS from
 * Codeberg (see RELEASES_API_URL/PINNED_FALLBACK above) -- not
 * user-supplied zips -- so the realistic threat is a compromise of that
 * upstream release artifact, not an arbitrary-zip attacker. Still, since
 * the library itself won't be fixed, this is the recommended
 * application-level mitigation for the vulnerability class: after
 * extraction, walk every entry and reject the whole update if any symlink's
 * resolved real path lands outside extractDir. Cheap, and closes the
 * exploitable path-traversal regardless of what's inside the zip.
 */
export function assertNoSymlinkEscapes(extractDir: string): void {
  const realExtractDir = realpathSync(extractDir);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const lst = lstatSync(full);
      if (lst.isSymbolicLink()) {
        const resolved = realpathSync(full);
        const relative = path.relative(realExtractDir, resolved);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new Error(
            `Refusing to apply this OpenRGB update: it contains a symlink ("${entry}") pointing outside the extracted update (${resolved}). This looks like a corrupted or tampered download, not a real OpenRGB release.`
          );
        }
      } else if (lst.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(realExtractDir);
}

function findFileRecursive(dir: string, filename: string): string | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const found = findFileRecursive(full, filename);
      if (found) return found;
    } else if (entry.toLowerCase() === filename.toLowerCase()) {
      return full;
    }
  }
  return null;
}

/** Copies every entry inside srcDir into destDir (creating destDir if needed), overwriting anything already there. */
function copyDirContentsInto(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    cpSync(path.join(srcDir, entry), path.join(destDir, entry), { recursive: true, force: true });
  }
}

/**
 * Tracks and updates the bundled OpenRGB build so HARE's device support
 * stays current without the user ever having to think about it. Safe to
 * use even when OpenRGB isn't installed yet, or on non-Windows platforms
 * (auto-update is Windows-only, matching the rest of HARE's v0.1 scope) —
 * it just reports that automatic updates aren't available there.
 */
export class DeviceDatabase {
  private status: DeviceDbStatus;
  private listeners = new Set<(status: DeviceDbStatus) => void>();
  /** The version tag the API last reported. Deliberately NOT a URL — HARE resolves what to download from APPROVED_BUILDS, never from the API response. */
  private latestVersionTag: string | null = null;

  constructor(private opts: DeviceDatabaseOptions) {
    const installedVersion = this.readInstalledVersion();
    this.status = {
      installed: this.exeExists(),
      installedVersion,
      latestVersion: null,
      updateAvailable: false,
      checking: false,
      updating: false,
      lastCheckedAt: null,
      lastError: null,
      // Also false when this build shipped with no verified OpenRGB in its
      // manifest — there is then genuinely nothing HARE is willing to
      // install, and the UI should say so rather than offering a button that
      // always refuses.
      supportsAutoUpdate: process.platform === "win32" && APPROVED_OPENRGB_BUILDS.length > 0,
    };
  }

  getStatus(): DeviceDbStatus {
    return { ...this.status };
  }

  onStatusChanged(cb: (status: DeviceDbStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private patch(partial: Partial<DeviceDbStatus>) {
    this.status = { ...this.status, ...partial };
    this.listeners.forEach((cb) => cb(this.getStatus()));
  }

  private exePath(): string {
    return path.join(this.opts.openRgbDir, "OpenRGB.exe");
  }

  private versionFilePath(): string {
    return path.join(this.opts.openRgbDir, "version.txt");
  }

  private exeExists(): boolean {
    return existsSync(this.exePath());
  }

  private readInstalledVersion(): string | null {
    try {
      const raw = readFileSync(this.versionFilePath(), "utf8").trim();
      return raw.length > 0 ? raw : null;
    } catch {
      return null;
    }
  }

  /**
   * Asks Codeberg (where OpenRGB actually publishes releases) what the
   * latest Windows build is, and compares it to what's currently bundled.
   * Never throws — a failed check (no internet, API down) just leaves
   * HARE running with whatever OpenRGB build it already has, which is
   * always a safe fallback.
   */
  async checkForUpdate(): Promise<DeviceDbStatus> {
    this.patch({ checking: true, lastError: null });
    try {
      const res = await fetch(RELEASES_API_URL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Codeberg API returned HTTP ${res.status}`);
      const release = (await res.json()) as CodebergRelease;
      const latestVersion = release.tag_name;
      this.latestVersionTag = latestVersion;

      const installedVersion = this.readInstalledVersion();
      this.patch({
        installed: this.exeExists(),
        installedVersion,
        latestVersion,
        // Only "available" if we actually have something installed already to compare against —
        // a from-scratch install is handled by build.bat/build.ps1, not this update path.
        updateAvailable: this.exeExists() && installedVersion !== null && installedVersion !== latestVersion,
        checking: false,
        lastCheckedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.latestVersionTag = null;
      this.patch({
        checking: false,
        lastError: err instanceof Error ? err.message : "Couldn't reach the OpenRGB update server.",
        lastCheckedAt: new Date().toISOString(),
      });
    }
    return this.getStatus();
  }

  /**
   * Downloads and installs the newer OpenRGB build found by checkForUpdate(),
   * replacing what's in openRgbDir. Windows-only (matches HARE's v0.1
   * scope), and a no-op if there's nothing newer to apply.
   */
  async applyUpdate(): Promise<DeviceDbStatus> {
    if (process.platform !== "win32") {
      this.patch({ lastError: "Automatic OpenRGB updates are only supported on Windows right now." });
      return this.getStatus();
    }
    if (!this.status.updateAvailable) {
      return this.getStatus();
    }

    this.patch({ updating: true, lastError: null });
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "hare-openrgb-update-"));
    try {
      // Resolved from HARE's own approved list, never from the API response.
      // A newer version the API knows about but HARE hasn't verified simply
      // isn't installed — that's the intended, safe outcome.
      const artifact = approvedBuildFor(this.latestVersionTag);
      if (!artifact) {
        throw new Error(
          `OpenRGB ${this.latestVersionTag ?? "update"} isn't a build HARE has verified yet, so it wasn't installed.`
        );
      }
      const zipPath = path.join(tmpDir, "openrgb.zip");
      const extractDir = path.join(tmpDir, "extract");

      const download = await downloadVerified(artifact, zipPath);
      if (!download.ok) throw new Error(download.message);

      await extractZip(zipPath, { dir: extractDir });
      assertNoSymlinkEscapes(extractDir);

      const exe = findFileRecursive(extractDir, "OpenRGB.exe");
      if (!exe) throw new Error("Downloaded the update but couldn't find OpenRGB.exe inside it.");

      copyDirContentsInto(path.dirname(exe), this.opts.openRgbDir);
      const newVersion = this.status.latestVersion ?? this.status.installedVersion ?? "";
      writeFileSync(this.versionFilePath(), newVersion, "utf8");

      this.patch({
        updating: false,
        installed: true,
        installedVersion: newVersion,
        updateAvailable: false,
      });
    } catch (err) {
      this.patch({
        updating: false,
        lastError: err instanceof Error ? err.message : "Updating OpenRGB failed.",
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return this.getStatus();
  }

  /** Convenience used at startup and by the manual "Discover" action: check, and silently apply if there's something newer. */
  async checkAndAutoApply(): Promise<DeviceDbStatus> {
    await this.checkForUpdate();
    if (this.status.updateAvailable && this.status.supportsAutoUpdate) {
      await this.applyUpdate();
    }
    return this.getStatus();
  }
}
