import { useState } from "react";
import { Ruler } from "lucide-react";
import { useHareStore } from "@/state/store";
import type { KLDevice, KLZone } from "../../electron/backend/types";

/**
 * What an empty header is pre-filled with.
 *
 * Eight is the common case — a single ARGB fan, and the length most bundled
 * strips ship at — so the usual answer is one click rather than counting
 * LEDs with your head inside the case. It is only a starting number: anything
 * the board accepts can be typed over it, and getting it wrong costs nothing
 * but a second attempt.
 */
const DEFAULT_HEADER_LEDS = 8;

/**
 * Telling HARE how many LEDs are on an ARGB header.
 *
 * A motherboard cannot count the LEDs on a strip you plug into it, so these
 * zones report **zero** until someone says how long the strip is. Until then
 * every colour written to that header goes nowhere — the app looks like it's
 * working, and nothing lights up. That is exactly what happened on a real
 * ASUS board: HARE wrote to the two onboard LEDs, confirmed the write, and
 * left the header dark.
 *
 * OpenRGB's own window has this control, which is precisely why OpenRGB could
 * light a strip that HARE could not. The number is remembered, so it only has
 * to be set once.
 */
export function ZoneSizeEditor({ device }: { device: KLDevice }) {
  const resizable = device.zones.filter((zone) => zone.resizable);
  if (resizable.length === 0) return null;

  const anyEmpty = resizable.some((zone) => zone.ledCount === 0);

  return (
    <section className="hr-card p-6">
      <div className="flex items-center gap-2 mb-1">
        <Ruler size={17} className={anyEmpty ? "text-glow-amber" : "text-glow-violet"} />
        <h2 className="font-display font-semibold">Addressable Headers</h2>
      </div>
      <p className="text-xs text-hare-muted mb-4">
        {anyEmpty
          ? "Your board can't count the LEDs on a strip you plug in, so tell HARE how many there are. Until you do, this header has nothing to light."
          : "How many LEDs are on each strip. HARE remembers this."}
      </p>
      <div className="space-y-3">
        {resizable.map((zone) => (
          <ZoneRow key={zone.id} device={device} zone={zone} />
        ))}
      </div>
    </section>
  );
}

function ZoneRow({ device, zone }: { device: KLDevice; zone: KLZone }) {
  const { resizeZone, run } = useHareStore();
  const min = zone.ledsMin ?? 0;
  const max = zone.ledsMax ?? 512;
  // An empty header starts at the common length rather than at zero, so the
  // fix is a click. A header that already has a length shows that instead.
  const [value, setValue] = useState(
    String(zone.ledCount > 0 ? zone.ledCount : Math.max(min, Math.min(max, DEFAULT_HEADER_LEDS)))
  );
  const [busy, setBusy] = useState(false);
  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const changed = valid && parsed !== zone.ledCount;
  const empty = zone.ledCount === 0;

  const apply = async () => {
    if (!changed) return;
    setBusy(true);
    try {
      await run(
        `Setting ${zone.name}`,
        () => resizeZone(device.id, zone.id, parsed),
        `${zone.name} set to ${parsed} LEDs.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-xl border p-3.5 ${
        empty ? "border-glow-amber/40 bg-glow-amber/5" : "border-hare-border"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{zone.name}</p>
          <p className="text-xs text-hare-muted mt-0.5">
            {empty ? `Nothing set yet — try ${DEFAULT_HEADER_LEDS}` : `${zone.ledCount} LEDs`} · this
            header takes {min}–{max}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void apply();
            }}
            aria-label={`LEDs on ${zone.name}`}
            className="w-24 rounded-lg border border-hare-border bg-hare-panel2 px-2.5 py-1.5 text-sm tabular-nums"
          />
          <button
            onClick={() => void apply()}
            disabled={!changed || busy}
            className="rounded-lg bg-brand-gradient px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy ? "Setting…" : "Set"}
          </button>
        </div>
      </div>
      {!valid && (
        <p className="mt-2 text-xs text-glow-amber">Enter a number between {min} and {max}.</p>
      )}
    </div>
  );
}
