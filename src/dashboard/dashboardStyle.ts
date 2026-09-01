import type { CSSProperties } from "react";
import type { DashboardBackground, DashboardWidgetPlacement } from "../../electron/backend/types";

/**
 * How the second screen's background and each widget's accent become CSS.
 *
 * Kept apart from the components so the live screen and the editable preview
 * in Widgets & Screens can be drawn by the same code — the preview used to be
 * grey placeholder boxes, which meant every choice made there was a guess.
 */

/** The layers behind the widgets, as a style for the screen's outermost box. */
export function backgroundStyle(background: DashboardBackground): CSSProperties {
  switch (background.kind) {
    case "color":
      return { background: background.color };
    case "image":
      return {
        // The dim layer sits above the picture and below the cards, so a
        // bright photo doesn't swallow white text on a panel read from
        // across a room.
        backgroundImage: `linear-gradient(rgba(0,0,0,${background.dim / 100}), rgba(0,0,0,${
          background.dim / 100
        })), url(${background.image})`,
        backgroundSize: background.fit === "contain" ? "contain" : "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#000",
      };
    case "none":
      // Nothing at all. The window itself is transparent in this mode, so
      // what shows through is the desktop.
      return { background: "transparent" };
    default:
      return {};
  }
}

/**
 * A widget's accent, as custom properties its card reads.
 *
 * The colour tints the border and the heading rather than filling the card:
 * six cards each flooded with a different colour is unreadable, six cards
 * each edged in one is instantly sortable.
 */
export function accentStyle(placement: DashboardWidgetPlacement): CSSProperties {
  if (!placement.accent) return {};
  // Only custom properties. The card itself is a child component with its own
  // classes, so the colour is handed down and picked up by the `.hr-widget`
  // rules in index.css rather than fought over with inline styles.
  return {
    "--widget-accent": placement.accent,
    "--widget-accent-border": `color-mix(in srgb, ${placement.accent} 60%, transparent)`,
    "--widget-accent-glow": `0 18px 44px -30px ${placement.accent}`,
  } as CSSProperties;
}

/** Whether the cards should be glassy — they need to be when there's a picture behind them. */
export function cardsNeedGlass(background: DashboardBackground): boolean {
  return background.kind === "image" || background.kind === "none";
}
