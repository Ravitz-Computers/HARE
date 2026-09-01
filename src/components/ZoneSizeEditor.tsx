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
 * Above this, the zone is a fan controller's channel rather than a
 * motherboard's ARGB header.
 *
 * The two need different words in front of them. A header takes a strip; a
 * channel takes a chain of fans whose LED counts add up, and someone who
 * doesn't know that sets a channel to 5, watches two-thirds of the first fan
 * light, and reasonably concludes the number means a position rather than a
 * quantity. It is the same control either way — only the sentence changes.
 *
 * Matches HUB_CHANNEL_MIN_MAX in backend/backendManager.ts, which uses the
 * same line to pick a starting length.
 */
const HUB_CHANNEL_MIN_MAX = 32;

function isHubChannel(zone: KLZone): boolean {
  return (zone.ledsMax ?? 0) >= HUB_CHANNEL_MIN_MAX;
}

/**
 * Telling HARE how many LEDs are on an ARGB header or a fan channel.
 *
 * A motherboard cannot count the LEDs on a strip you plug into it, so these
 * zones report **zero** until someone says how long the strip is. Until then
 * every colour written to that header goes nowhere — the app looks like it's
 * working, and nothing lights up. That is exactly what happened on a real
 * ASUS board: HARE wrote to the two onboard LEDs, confirmed the write, and
 * left the header dark.
 *
 * A fan hub is the same control with a different failure: the channel does
 * report a length, just a much smaller one than the fans plugged into it, so
 * a colour lights part of the chain and stops. Nothing about that looks like
 * a setting, which is why the copy has to say what the number counts.
 *
 * OpenRGB's own window has this control, which is precisely why OpenRGB could
 * light a strip that HARE could not. The number is remembered, so it only has
 * to be set once.
 */
export function ZoneSizeEditor({ device }: { device: KLDevice }) {
  const resizable = device.zones.filter((zone) => zone.resizable);
  if (resizable.length === 0) return null;

  const anyEmpty = resizable.some((zone) => zone.ledCount === 0);
  const channels = resizable.every(isHubChannel);
  const emptyChannels = resizable.filter((zone) => isHubChannel(zone) && zone.ledCount === 0);

  return (
    <section className="hr-card p-6">
      <div className="flex items-center gap-2 mb-1">
        <Ruler size={17} className={anyEmpty ? "text-glow-amber" : "text-glow-violet"} />
        <h2 className="font-display font-semibold">
          {channels ? "Fan Channels" : "Addressable Headers"}
        </h2>
      </div>
      <p className="text-xs text-hare-muted mb-4">
        {channels
          ? "How many LEDs are on each channel. Fans daisy-chained together add up — three 16-LED fans on one channel is 48. HARE remembers this."
          : anyEmpty
            ? "Your board can't count the LEDs on a strip you plug in, so tell HARE how many there are. Until you do, this header has nothing to light."
            : "How many LEDs are on each strip. HARE remembers this."}
      </p>
      {emptyChannels.length > 0 && (
        <p className="mb-4 text-xs text-hare-muted">
          Don&apos;t know the counts? <FillAll device={device} zones={emptyChannels} /> lights
          everything on every empty channel. Set the real numbers when you have them.
        </p>
      )}
      {resizable.length > 1 && <SetAll device={device} zones={resizable} />}
      <div className="space-y-3">
        {resizable.map((zone) => (
          <ZoneRow key={zone.id} device={device} zone={zone} />
        ))}
      </div>
    </section>
  );
}

/**
 * Fills every empty channel to its maximum.
 *
 * A hub cannot count what is plugged into it, so HARE no longer picks a number
 * for a channel — but "nothing lights until you count LEDs on eight channels"
 * is a bad first minute with a new fan controller. This is that number, chosen
 * deliberately, in one click. It over-counts, which shows up as an effect
 * spread over more length than is really there; the fix is to type the real
 * number, and the row says so.
 */
function FillAll({ device, zones }: { device: KLDevice; zones: KLZone[] }) {
  const { resizeZone, run } = useHareStore();
  const [busy, setBusy] = useState(false);

  const fill = async () => {
    setBusy(true);
    try {
      await run(
        "Lighting every channel",
        async () => {
          for (const zone of zones) await resizeZone(device.id, zone.id, zone.ledsMax ?? 0);
        },
        `${zones.length} channel${zones.length === 1 ? "" : "s"} set to their maximum.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={() => void fill()}
      disabled={busy}
      className="font-medium text-glow-violet underline underline-offset-2 disabled:opacity-40"
    >
      {busy ? "Setting…" : "Light it all"}
    </button>
  );
}

/**
 * Sets every channel to the same number in one go.
 *
 * A fan controller's channels usually carry the same fans — three on each of
 * four, say — so the same number goes in eight times, one at a time, with a
 * device re-read between each. Doing that by hand takes about a minute and is
 * the sort of thing that makes someone give up on getting the counts right and
 * leave everything at the maximum.
 *
 * The range offered is the narrowest every channel accepts, so a number typed
 * here can never be refused by one of them.
 */
function SetAll({ device, zones }: { device: KLDevice; zones: KLZone[] }) {
  const { resizeZone, run } = useHareStore();
  const min = Math.max(...zones.map((z) => z.ledsMin ?? 0));
  const max = Math.min(...zones.map((z) => z.ledsMax ?? 512));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = Number(value);
  const valid = value !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  const apply = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await run(
        `Setting all ${zones.length}`,
        async () => {
          // One at a time, awaited. The controller is re-read after each
          // resize, and firing eight of these at once is how a device ends up
          // reporting a length nobody asked for.
          for (const zone of zones) {
            if (zone.ledCount === parsed) continue;
            await resizeZone(device.id, zone.id, parsed);
          }
        },
        `All ${zones.length} set to ${parsed} LEDs.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-hare-border bg-hare-panel2/40 p-3">
      <span className="text-xs text-hare-muted">Same on every one</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        placeholder={`${min}–${max}`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void apply();
        }}
        aria-label={`LEDs on every ${isHubChannel(zones[0]) ? "channel" : "header"}`}
        className="w-24 rounded-lg border border-hare-border bg-hare-panel2 px-2.5 py-1.5 text-sm tabular-nums"
      />
      <button
        onClick={() => void apply()}
        disabled={!valid || busy}
        className="rounded-lg border border-hare-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
      >
        {busy ? "Setting…" : "Set all"}
      </button>
    </div>
  );
}

function ZoneRow({ device, zone }: { device: KLDevice; zone: KLZone }) {
  const { resizeZone, run } = useHareStore();
  const min = zone.ledsMin ?? 0;
  const max = zone.ledsMax ?? 512;
  // An empty header starts at the common length rather than at zero, so the
  // fix is a click. A header that already has a length shows that instead.
  // An empty zone is pre-filled with something that lights: a strip's worth
  // for a board header, the whole channel for a hub. Either way it is only
  // what the box starts at — nothing is sent until Set is pressed.
  const suggestion = isHubChannel(zone) ? max : Math.max(min, Math.min(max, DEFAULT_HEADER_LEDS));
  const [value, setValue] = useState(String(zone.ledCount > 0 ? zone.ledCount : suggestion));
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
            {empty ? `Nothing set yet — try ${suggestion}` : `${zone.ledCount} LEDs`} · this{" "}
            {isHubChannel(zone) ? "channel" : "header"} takes {min}–{max}
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
