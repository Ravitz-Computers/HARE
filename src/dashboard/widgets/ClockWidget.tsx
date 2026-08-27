import { useEffect, useState } from "react";
import { useHareStore } from "@/state/store";

/**
 * A clock big enough to read from the other side of the room.
 *
 * The sizing is the whole problem here, and it used to be wrong. One
 * width-only container query drove the time, so "10:38 PM" — eight
 * characters, and the default — was about 12% wider than the card at every
 * size that mattered, and `overflow-hidden` quietly ate the "PM". A 2×2 card
 * drew exactly the same size type as a 1×1 one, so resizing the widget looked
 * like it did nothing.
 *
 * Now the time is measured against both axes: `min()` of a width term and a
 * height term, so it fills a wide card and still fits a short one, and the
 * width term accounts for how many characters are actually being drawn.
 * Everything else on the card scales from the same number.
 */
export function ClockWidget() {
  const clock24h = useHareStore((s) => s.appSettings.dashboard.clock24h);
  const dashboard = useHareStore((s) => s.appSettings.dashboard);
  const setAppSettings = useHareStore((s) => s.setAppSettings);
  const [now, setNow] = useState(() => new Date());

  // Ticks on the minute rather than every second: a wall clock with no
  // seconds hand is what this is, and one wake-up a minute is nothing.
  //
  // It also resyncs whenever the window becomes visible again. The second
  // monitor sleeps, and a hidden window's timers are throttled — without
  // this, a panel waking up shows the minute it fell asleep on.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const next = 60_000 - (Date.now() % 60_000) + 50;
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, next);
    };
    schedule();

    const resync = () => {
      setNow(new Date());
      clearTimeout(timer);
      schedule();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, []);

  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: !clock24h,
  });
  const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  /**
   * How wide the string is, in ems, at this font.
   *
   * Digits are tabular so they're all one width; the colon and the space are
   * narrower, and the AM/PM is what actually overflowed. Measuring it rather
   * than assuming is why "9:05" can be drawn much larger than "12:38 PM" in
   * the same card.
   */
  const ems =
    [...time].reduce((total, ch) => {
      if (ch >= "0" && ch <= "9") return total + 0.6;
      if (ch === ":") return total + 0.3;
      if (ch === " ") return total + 0.25;
      return total + 0.62;
    }, 0) + 0.15; // a little air, so nothing sits flush against the edge

  // The card is p-6 (24px each side), so the usable width is 100cqi minus
  // 3rem. Dividing by the string's width in ems gives the largest font that
  // fits across; the height term keeps it inside a short card, leaving room
  // for the date underneath.
  const fontSize = `min(calc((100cqi - 3rem) / ${ems.toFixed(2)}), 52cqb, 8rem)`;

  return (
    <button
      onClick={() => void setAppSettings({ dashboard: { ...dashboard, clock24h: !clock24h } })}
      title={clock24h ? "Showing a 24-hour clock — tap for 12-hour" : "Showing a 12-hour clock — tap for 24-hour"}
      aria-label={`${time}. ${date}. Tap to switch to ${clock24h ? "12" : "24"}-hour time.`}
      // Sized against the card's own box rather than the viewport's, in both
      // directions — `size` rather than `inline-size`, which is what makes
      // the cqb term above mean anything.
      style={{ containerType: "size" }}
      className="hr-card group relative flex h-full w-full flex-col justify-center overflow-hidden p-6 text-left transition-colors hover:border-glow-violet/40 focus-visible:border-glow-violet/60 focus-visible:outline-none"
    >
      <p
        className="font-display font-bold leading-none tabular-nums whitespace-nowrap"
        style={{ fontSize }}
      >
        {time}
      </p>
      <p
        className="mt-[0.08em] truncate text-hare-muted"
        style={{ fontSize: `min(calc((100cqi - 3rem) / ${(date.length * 0.52).toFixed(2)}), 11cqb, 1.5rem)` }}
      >
        {date}
      </p>
      {/* The one hint that this does anything. The card is a switch for the
          only setting the second screen has, and there is nowhere else to
          change it — without this it was an invisible control. */}
      <span className="pointer-events-none absolute right-3 top-3 rounded-full border border-hare-border bg-hare-panel2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-hare-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {clock24h ? "24h" : "12h"}
      </span>
    </button>
  );
}
