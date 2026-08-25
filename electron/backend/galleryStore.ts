import { app } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isSavedLook } from "./types.js";
import type { SavedLook, SavedLookInput } from "./types.js";

/**
 * Persists the user's saved lighting looks (Settings → ... no, the Gallery
 * page) across restarts. Same flat-JSON-file-in-userData approach as
 * AppSettingsStore, for the same reason: an array of small objects doesn't
 * need a database.
 */
export class GalleryStore {
  private looks: SavedLook[] = [];
  private listeners = new Set<(looks: SavedLook[]) => void>();

  private get filePath(): string {
    return path.join(app.getPath("userData"), "hare-gallery.json");
  }

  async load(): Promise<SavedLook[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      this.looks = Array.isArray(parsed) ? parsed.filter(isSavedLook) : [];
    } catch {
      // First run, or a missing/corrupted file — start empty, same as
      // AppSettingsStore's approach to a missing settings file.
      this.looks = [];
    }
    return this.looks;
  }

  getAll(): SavedLook[] {
    return this.looks;
  }

  get(id: string): SavedLook | undefined {
    return this.looks.find((l) => l.id === id);
  }

  async save(input: SavedLookInput): Promise<SavedLook> {
    const look: SavedLook = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.looks = [look, ...this.looks];
    await this.persist();
    return look;
  }

  async delete(id: string): Promise<void> {
    this.looks = this.looks.filter((l) => l.id !== id);
    await this.persist();
  }

  /**
   * Adds looks from an import (a shared file, or a restored backup) without
   * clobbering anything already saved. Dedupes by id so re-importing the
   * same file twice — or restoring a backup that includes looks already
   * present, e.g. because it was exported from this same install — is a
   * no-op rather than creating duplicates.
   */
  async merge(incoming: SavedLook[]): Promise<SavedLook[]> {
    const existingIds = new Set(this.looks.map((l) => l.id));
    const fresh = incoming.filter(isSavedLook).filter((l) => !existingIds.has(l.id));
    if (fresh.length > 0) {
      this.looks = [...fresh, ...this.looks];
      await this.persist();
    }
    return fresh;
  }

  onChanged(cb: (looks: SavedLook[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private async persist(): Promise<void> {
    this.listeners.forEach((cb) => cb(this.looks));
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.looks, null, 2), "utf-8");
    } catch (err) {
      // Non-fatal, same tradeoff as AppSettingsStore: the in-memory gallery
      // still works for this session, it just won't survive a restart.
      console.warn("[HARE] Couldn't save the gallery to disk:", err);
    }
  }
}
