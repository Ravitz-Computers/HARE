import { app } from "electron";
import { existsSync, mkdtempSync, rmSync, statSync, readdirSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import extractZip from "extract-zip";
import { downloadVerified } from "../verifiedDownload.js";
import { assertNoSymlinkEscapes } from "../deviceDatabase.js";
import { APPROVED_MODULES } from "../generated/moduleBuilds.js";
import { MODULE_DEFINITIONS, isBuiltInModule, moduleById, type ModuleId } from "./moduleRegistry.js";
import type { ModuleStatus } from "../types.js";

/**
 * Installs and removes the optional vendor modules.
 *
 * Modules are downloaded on demand rather than bundled, so a HARE install
 * stays small for the majority of people who need none of them. Everything a
 * module installs lives under one directory inside HARE's own data folder,
 * which is what makes "uninstall HARE and nothing is left behind" true
 * without any special-casing — the uninstaller removes that folder along with
 * everything else.
 *
 * Every download goes through the same verified path as OpenRGB itself: a
 * pinned SHA-256, an HTTPS host allowlist, and manual redirect following so
 * every hop is checked. Modules are native code that HARE will load into its
 * own process, so there is no version of this where an unverified download is
 * acceptable — if anything, the bar is higher here than for OpenRGB, which at
 * least runs as a separate process.
 *
 * As with OpenRGB, the digests are generated from the real bytes at build
 * time and never written by hand (see scripts/module-manifest.mjs). A module
 * with no verified entry simply can't be installed, which is the safe
 * outcome.
 */
export class ModuleManager {
  /** Everything modules install lives here, so removing HARE removes all of it. */
  private get root(): string {
    return path.join(app.getPath("userData"), "modules");
  }

  private dirFor(id: ModuleId): string {
    return path.join(this.root, id);
  }

  /** Where a module's code can be `require`d from, or null if it isn't installed. */
  resolveInstalled(id: ModuleId): string | null {
    const dir = this.dirFor(id);
    return existsSync(dir) ? dir : null;
  }

  isInstalled(id: ModuleId): boolean {
    return this.resolveInstalled(id) !== null;
  }

  /** Disk footprint of an installed module, so the UI can show what removing it would reclaim. */
  private sizeOnDisk(dir: string): number {
    let total = 0;
    const walk = (current: string) => {
      let entries: string[];
      try {
        entries = readdirSync(current);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) walk(full);
          else total += stat.size;
        } catch {
          // A file that vanished mid-walk just doesn't count.
        }
      }
    };
    walk(dir);
    return total;
  }

  getStatus(): ModuleStatus[] {
    return MODULE_DEFINITIONS.map((def) => {
      const builtIn = isBuiltInModule(def);
      const installed = builtIn || this.isInstalled(def.id);
      const approved = APPROVED_MODULES.find((m) => m.id === def.id) ?? null;
      const dir = this.resolveInstalled(def.id);
      return {
        id: def.id,
        name: def.name,
        summary: def.summary,
        worthItWhen: def.worthItWhen,
        overlapsOpenRgb: def.overlapsOpenRgb,
        requiresVendorApp: def.requiresVendorApp,
        installed,
        // A module with nothing to download is always available; one with a
        // download is only available if a verified build exists for it.
        available: builtIn || approved !== null,
        /** Nothing to install or remove — it ships with HARE. */
        builtIn,
        downloadBytes: approved?.bytes ?? null,
        installedBytes: dir ? this.sizeOnDisk(dir) : null,
      };
    });
  }

  /**
   * Downloads, verifies and unpacks a module.
   *
   * Extraction goes to a temporary directory first and is only moved into
   * place once it has passed the same symlink-escape guard used for OpenRGB
   * updates — a crafted archive must never be able to write outside the
   * module folder.
   */
  async install(id: ModuleId): Promise<{ ok: true } | { ok: false; message: string }> {
    const def = moduleById(id);
    if (!def) return { ok: false, message: "That module doesn't exist." };
    if (isBuiltInModule(def)) return { ok: true }; // nothing to fetch

    const approved = APPROVED_MODULES.find((m) => m.id === id);
    if (!approved) {
      return {
        ok: false,
        message: `${def.name} isn't available in this build — no verified download was published with it.`,
      };
    }

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), `hare-module-${id}-`));
    try {
      const zipPath = path.join(tmpDir, "module.zip");
      const extractDir = path.join(tmpDir, "extract");

      const download = await downloadVerified(approved, zipPath);
      if (!download.ok) return { ok: false, message: download.message };

      await extractZip(zipPath, { dir: extractDir });
      assertNoSymlinkEscapes(extractDir);

      const dest = this.dirFor(id);
      await rm(dest, { recursive: true, force: true });
      await mkdir(path.dirname(dest), { recursive: true });
      // Moved rather than copied so a half-extracted module can never be left
      // looking installed.
      const { rename, cp } = await import("node:fs/promises");
      try {
        await rename(extractDir, dest);
      } catch {
        // Different filesystems can't be renamed across; fall back to a copy.
        await cp(extractDir, dest, { recursive: true });
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : `Couldn't install ${def.name}.`,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** Removes a module completely. Built-in modules have nothing to remove. */
  async uninstall(id: ModuleId): Promise<{ ok: true } | { ok: false; message: string }> {
    const def = moduleById(id);
    if (!def) return { ok: false, message: "That module doesn't exist." };
    if (isBuiltInModule(def)) {
      return { ok: false, message: `${def.name} ships with HARE, so there's nothing to remove.` };
    }
    try {
      await rm(this.dirFor(id), { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Couldn't remove it." };
    }
  }

  /** Removes every installed module. Used by a full reset. */
  async uninstallAll(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}
