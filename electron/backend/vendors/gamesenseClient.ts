import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KLColor } from "../types.js";

/**
 * Client for SteelSeries GameSense — the local HTTP API inside SteelSeries GG.
 *
 * Structurally the same kind of integration as Razer Chroma, and for the same
 * reason it's the best-shaped one left to add: it's a documented local REST
 * API, driven with plain `fetch`, with no native binding, no DLL to locate and
 * nothing to compile. That also makes it fully testable against a stand-in
 * server rather than only against real hardware.
 *
 * Transcribed from SteelSeries' own SDK documentation
 * (github.com/SteelSeries/gamesense-sdk), not guessed:
 *
 *  - The port is **not** fixed. SteelSeries GG writes a `coreProps.json` on
 *    startup containing an `address` of the form `"host:port"`, and clients
 *    are expected to read it. Guessing a port would break the moment GG
 *    picked a different one.
 *  - A game registers itself, then binds a handler per device category, then
 *    fires events. Game and event names are restricted to uppercase A-Z,
 *    digits, hyphen and underscore.
 *  - Colour is a plain `{red, green, blue}` object — no packing, unlike
 *    Chroma's BGR integer or Aura's GBR. Worth stating explicitly, because
 *    every other vendor here packs differently and it's an easy place to
 *    apply the wrong transformation out of habit.
 *
 * Unverified against a real SteelSeries GG install (none available here): the
 * set of device categories a given machine will accept. Unsupported ones are
 * rejected individually by GG rather than failing the whole call, which is
 * why every category is bound and partial success is treated as success.
 */

const GAME = "HARE";
const EVENT = "COLOR";

/**
 * Device categories to drive. Capability-based names (`rgb-N-zone`) rather
 * than product names, which is what the SDK docs recommend: they match on
 * what a device can do instead of what it is, so new hardware is covered
 * without a list update.
 */
const DEVICE_TYPES = [
  "rgb-per-key-zones",
  "rgb-1-zone",
  "rgb-2-zone",
  "rgb-3-zone",
  "rgb-5-zone",
  "rgb-8-zone",
  "rgb-12-zone",
  "rgb-17-zone",
  "rgb-24-zone",
] as const;

/** Where SteelSeries GG publishes the address of its local server. */
function corePropsPath(): string {
  if (process.platform === "win32") {
    const programData = process.env.PROGRAMDATA ?? "C:\\ProgramData";
    return path.join(programData, "SteelSeries", "SteelSeries Engine 3", "coreProps.json");
  }
  return "/Library/Application Support/SteelSeries Engine 3/coreProps.json";
}

async function fetchJson(
  url: string,
  body: unknown,
  timeoutMs = 3000
): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export class GamesenseClient {
  private address: string | null = null;

  get isConnected(): boolean {
    return this.address !== null;
  }

  /**
   * Reads the address GG published and registers HARE with it.
   *
   * `coreProps.json` only exists while SteelSeries GG is installed, and its
   * contents only point anywhere useful while GG is running — so a missing or
   * unreachable file is the ordinary "not installed" case, not an error worth
   * alarming anyone about.
   */
  async connect(): Promise<{ ok: true } | { ok: false; message: string }> {
    let address: string;
    try {
      const raw = await readFile(corePropsPath(), "utf8");
      const parsed = JSON.parse(raw) as { address?: string };
      if (!parsed.address) throw new Error("no address");
      address = parsed.address;
    } catch {
      return {
        ok: false,
        message: "SteelSeries GG doesn't appear to be installed or running.",
      };
    }

    try {
      const res = await fetchJson(`http://${address}/game_metadata`, {
        game: GAME,
        game_display_name: "HARE",
        developer: "Ravitz Computers",
      });
      if (!res.ok) {
        return { ok: false, message: `SteelSeries GG refused the registration (HTTP ${res.status}).` };
      }
    } catch (err) {
      return {
        ok: false,
        message: `Couldn't reach SteelSeries GG: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    this.address = address;
    return { ok: true };
  }

  /**
   * Sets a solid colour across every SteelSeries device.
   *
   * GameSense has no "set this colour now" call. The colour lives inside a
   * *handler*, and events trigger handlers — so changing colour means
   * re-binding the handler and firing the event again. That's the documented
   * pattern for static colour, not a workaround.
   */
  async setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.address) return { ok: false, message: "Not connected to SteelSeries GG." };

    // Note the plain {red, green, blue} object: no bit-packing here, unlike
    // every other vendor module.
    const rgb = { red: clampByte(color.r), green: clampByte(color.g), blue: clampByte(color.b) };

    try {
      const bind = await fetchJson(`http://${this.address}/bind_game_event`, {
        game: GAME,
        event: EVENT,
        min_value: 0,
        max_value: 100,
        handlers: DEVICE_TYPES.map((deviceType) => ({
          "device-type": deviceType,
          zone: "all",
          mode: "color",
          color: rgb,
        })),
      });
      if (!bind.ok) {
        return { ok: false, message: `SteelSeries GG rejected the lighting request (HTTP ${bind.status}).` };
      }

      // Binding alone doesn't light anything — the event has to fire.
      const fire = await fetchJson(`http://${this.address}/game_event`, {
        game: GAME,
        event: EVENT,
        data: { value: 100 },
      });
      if (!fire.ok) {
        return { ok: false, message: `SteelSeries GG accepted the effect but not the trigger (HTTP ${fire.status}).` };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: `Couldn't reach SteelSeries GG: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Hands the lights back to SteelSeries' own software.
   *
   * `remove_game` rather than just going quiet: leaving HARE registered would
   * keep GG showing it as an active integration long after HARE had stopped
   * driving anything.
   */
  async disconnect(): Promise<void> {
    const address = this.address;
    this.address = null;
    if (!address) return;
    try {
      await fetchJson(`http://${address}/remove_game`, { game: GAME }, 1500);
    } catch {
      // Best effort — GG may already have exited, which is the common case.
    }
  }
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
