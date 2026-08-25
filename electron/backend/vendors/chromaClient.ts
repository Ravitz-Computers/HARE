import type { KLColor } from "../types.js";

/**
 * Client for Razer's local Chroma SDK REST server — the one vendor in
 * VENDOR_DEFINITIONS with a genuine local HTTP API (documented at
 * assets.razerzone.com's REST init docs), callable with plain `fetch`,
 * no native bindings needed. Razer Synapse/Chroma must be installed and
 * running (see vendorDetection.ts) for any of this to succeed.
 *
 * Two things are explicitly NOT verified against a real installation in
 * this environment (no Windows machine, no Synapse to test against) and
 * should be double-checked on first real-world use:
 *  - The server port. The REST docs' examples and most community server
 *    reimplementations use 54235; at least one live user report describes
 *    the actual running port as 1337 instead, without a clear resolution.
 *    connect() tries both.
 *  - The exact effect-call body shape per device category. This uses the
 *    most commonly documented shape (a device-category endpoint + a
 *    CHROMA_STATIC effect with a BGR-packed color integer), matching what
 *    Razer's own docs and long-standing community wrappers (Colore,
 *    pychroma, chroma-python) use — but Razer could have changed specifics
 *    since. If this doesn't light anything up on a real Chroma install,
 *    that's the first thing to check.
 */
export class ChromaClient {
  private baseUri: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  get isConnected(): boolean {
    return this.baseUri !== null;
  }

  async connect(): Promise<{ ok: true } | { ok: false; message: string }> {
    for (const port of [54235, 1337]) {
      try {
        const res = await fetchWithTimeout(`http://localhost:${port}/razer/chromasdk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "HARE",
            description: "Hardware Adaptive RGB Engine — universal RGB control by Ravitz Computers",
            author: { name: "Ravitz Computers", contact: "https://ravitzcomputers.com" },
            device_supported: ["keyboard", "mouse", "headset", "mousepad", "keypad", "chromalink"],
            category: "application",
          }),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { uri?: string };
        if (!data.uri) continue;
        this.baseUri = data.uri;
        this.startHeartbeat();
        return { ok: true };
      } catch {
        // Try the next candidate port.
      }
    }
    return { ok: false, message: "Couldn't reach a Chroma SDK server on the usual ports (54235, 1337)." };
  }

  async setColor(color: KLColor): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.baseUri) return { ok: false, message: "Not connected to Chroma yet." };
    const packed = (color.b << 16) | (color.g << 8) | color.r; // Chroma's REST API packs color as 0x00BBGGRR
    const categories = ["keyboard", "mouse", "mousepad", "headset", "keypad"];
    const results = await Promise.allSettled(
      categories.map((category) =>
        fetchWithTimeout(`${this.baseUri}/${category}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ effect: "CHROMA_STATIC", param: { color: packed } }),
        })
      )
    );
    const anySucceeded = results.some((r) => r.status === "fulfilled" && r.value.ok);
    if (!anySucceeded) {
      return { ok: false, message: "Chroma didn't accept the color on any device category." };
    }
    return { ok: true };
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.baseUri) {
      try {
        await fetchWithTimeout(this.baseUri, { method: "DELETE" });
      } catch {
        // Best-effort — the session will simply time out on Razer's side if this fails.
      }
    }
    this.baseUri = null;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    // The Chroma SDK docs require a periodic heartbeat or the session
    // expires — every 1s is the commonly documented interval.
    this.heartbeatTimer = setInterval(() => {
      if (!this.baseUri) return;
      fetchWithTimeout(`${this.baseUri}/heartbeat`, { method: "PUT" }).catch(() => {
        // A missed heartbeat isn't fatal on its own; if the session really
        // did expire, the next setColor() call will fail and surface that.
      });
    }, 1000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 2000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
