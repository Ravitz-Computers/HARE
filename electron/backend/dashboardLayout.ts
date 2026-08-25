import {
  DASHBOARD_COLUMNS,
  DASHBOARD_WIDGETS,
  DEFAULT_DASHBOARD_BACKGROUND,
  DEFAULT_DASHBOARD_SETTINGS,
  type DashboardBackground,
  type WidgetSpanH,
  type WidgetSpanW,
  type DashboardSettings,
  type DashboardWidgetId,
  type DashboardWidgetPlacement,
  type KLDisplayInfo,
} from "./types.js";

/**
 * The decisions behind the second-screen dashboard, kept apart from the
 * window that acts on them.
 *
 * Nothing here imports Electron, which is what lets it be tested directly.
 * The parts that matter are exactly the parts that only misbehave on a
 * machine that isn't the one it was written on: a monitor that has been
 * unplugged since the setting was saved, and a settings file written by a
 * different version of HARE.
 */

/** The minimum of an Electron Display this module needs. */
export interface DisplayLike {
  id: number;
  label?: string;
  size: { width: number; height: number };
}

/**
 * Which display the dashboard should use.
 *
 * Windows re-numbers displays when monitors are unplugged, so a saved id can
 * name a screen that no longer exists. Rather than failing, this falls
 * through: the requested display, else the first screen that isn't the main
 * one, else the main one. The last case means a single-monitor machine still
 * gets a window rather than silently nothing.
 */
export function resolveDashboardDisplayId<T extends DisplayLike>(
  displays: T[],
  primaryId: number,
  requestedId?: number | null
): number | null {
  if (displays.length === 0) return null;
  const requested = requestedId != null ? displays.find((d) => d.id === requestedId) : undefined;
  if (requested) return requested.id;
  const secondary = displays.find((d) => d.id !== primaryId);
  if (secondary) return secondary.id;
  return displays.find((d) => d.id === primaryId)?.id ?? displays[0].id;
}

/**
 * A display as something a person can pick from a list. Electron rarely gets
 * a real monitor name out of Windows, so the fallback is a position and a
 * resolution — both things someone can check against what's in front of them.
 */
export function describeDisplay(display: DisplayLike, index: number, primaryId: number): KLDisplayInfo {
  return {
    id: display.id,
    label: display.label || `Display ${index + 1} (${display.size.width}×${display.size.height})`,
    width: display.size.width,
    height: display.size.height,
    isPrimary: display.id === primaryId,
  };
}

const KNOWN_WIDGETS = new Set<string>(DASHBOARD_WIDGETS.map((w) => w.id));

/**
 * Rebuilds the dashboard settings block from whatever was on disk.
 *
 * Settings are merged shallowly onto defaults, so a file written before this
 * feature existed has no dashboard key at all, and a half-written one can be
 * missing any field. Widget ids are filtered against the current list too, so
 * a widget dropped in a later version can't linger in a saved layout and
 * render as a blank card.
 */
/** A size a widget is actually allowed to be. */
function clampWidth(value: unknown): WidgetSpanW {
  const n = Math.round(Number(value));
  if (n >= 1 && n <= DASHBOARD_COLUMNS) return n as WidgetSpanW;
  return 1;
}

function clampHeight(value: unknown): WidgetSpanH {
  const n = Math.round(Number(value));
  if (n >= 1 && n <= MAX_WIDGET_ROWS) return n as WidgetSpanH;
  return 1;
}

/** How tall a widget may be. Beyond three rows nothing fits on a small panel. */
export const MAX_WIDGET_ROWS = 3;

/**
 * A colour a widget may be tinted, or null.
 *
 * Only `#rrggbb` is accepted. These strings reach a stylesheet, and the one
 * place a settings file becomes something the interface executes is exactly
 * the place to be strict about it.
 */
function cleanAccent(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}

/** Reads a saved background, replacing anything malformed with HARE's own. */
export function normalizeBackground(value: unknown): DashboardBackground {
  const raw = value as Partial<{ kind: string; color: string; image: string; fit: string; dim: number }> | null;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DASHBOARD_BACKGROUND };
  if (raw.kind === "none") return { kind: "none" };
  if (raw.kind === "color") {
    const color = cleanAccent(raw.color);
    return color ? { kind: "color", color } : { ...DEFAULT_DASHBOARD_BACKGROUND };
  }
  if (raw.kind === "image") {
    // Only a data URL for an image. A settings file is not a place from which
    // the dashboard should be fetching anything.
    const image = typeof raw.image === "string" ? raw.image : "";
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(image)) return { ...DEFAULT_DASHBOARD_BACKGROUND };
    const dim = typeof raw.dim === "number" && raw.dim >= 0 && raw.dim <= 90 ? Math.round(raw.dim) : 35;
    return { kind: "image", image, fit: raw.fit === "contain" ? "contain" : "cover", dim };
  }
  return { ...DEFAULT_DASHBOARD_BACKGROUND };
}

/**
 * Reads a saved widget list, whatever shape it's in.
 *
 * Layouts used to be a plain list of widget ids with the grid deciding every
 * size. They now carry a size each, so a settings file written by the earlier
 * build arrives as an array of strings. Rather than discarding it — which
 * would silently reset someone's arrangement — each id is given the default
 * size it would have had.
 */
export function normalizeWidgetPlacements(value: unknown): DashboardWidgetPlacement[] {
  if (!Array.isArray(value)) return DEFAULT_DASHBOARD_SETTINGS.widgets.map((w) => ({ ...w }));

  const defaults = new Map(DEFAULT_DASHBOARD_SETTINGS.widgets.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const out: DashboardWidgetPlacement[] = [];

  for (const entry of value) {
    const id = typeof entry === "string" ? entry : (entry as DashboardWidgetPlacement)?.id;
    // A widget this build no longer has would render as a blank card.
    if (typeof id !== "string" || !KNOWN_WIDGETS.has(id) || seen.has(id)) continue;
    seen.add(id);

    if (typeof entry === "string") {
      const fallback = defaults.get(id as DashboardWidgetId);
      out.push({ id: id as DashboardWidgetId, w: fallback?.w ?? 1, h: fallback?.h ?? 1, accent: null });
    } else {
      const placement = entry as Partial<DashboardWidgetPlacement>;
      out.push({
        id: id as DashboardWidgetId,
        w: clampWidth(placement.w),
        h: clampHeight(placement.h),
        accent: cleanAccent(placement.accent),
      });
    }
  }
  return out;
}

export function normalizeDashboardSettings(value: unknown): DashboardSettings {
  const raw = (value ?? {}) as Partial<DashboardSettings>;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_DASHBOARD_SETTINGS.enabled,
    displayId: typeof raw.displayId === "number" ? raw.displayId : null,
    widgets: normalizeWidgetPlacements(raw.widgets),
    // Ids only, deduplicated: anything else in there is a settings file that
    // has been edited by hand or written by a different version.
    hiddenDisplayIds: Array.isArray(raw.hiddenDisplayIds)
      ? [...new Set(raw.hiddenDisplayIds.filter((id): id is number => typeof id === "number"))]
      : [],
    clock24h: typeof raw.clock24h === "boolean" ? raw.clock24h : DEFAULT_DASHBOARD_SETTINGS.clock24h,
    locked: typeof raw.locked === "boolean" ? raw.locked : DEFAULT_DASHBOARD_SETTINGS.locked,
    background: normalizeBackground(raw.background),
  };
}

/** Moves a widget from one position to another, which is what a drag in the preview does. */
export function reorderPlacements(
  placements: DashboardWidgetPlacement[],
  from: number,
  to: number
): DashboardWidgetPlacement[] {
  if (from === to || from < 0 || from >= placements.length) return placements;
  const next = [...placements];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

/**
 * The next size in the cycle: one cell, wide, then large.
 *
 * A cycle rather than a drag handle on purpose — the preview is a scaled-down
 * mock of a screen that may be four times its size, and a pixel-accurate
 * resize there is fiddly with a mouse and impossible with a finger.
 */
export function nextSpan(placement: DashboardWidgetPlacement): DashboardWidgetPlacement {
  if (placement.w === 1 && placement.h === 1) return { ...placement, w: 2, h: 1 };
  if (placement.w === 2 && placement.h === 1) return { ...placement, w: 2, h: 2 };
  return { ...placement, w: 1, h: 1 };
}

/** Sets a widget's size directly, which is what the width and height controls do. */
export function withSpan(
  placement: DashboardWidgetPlacement,
  w: unknown,
  h: unknown
): DashboardWidgetPlacement {
  return { ...placement, w: clampWidth(w), h: clampHeight(h) };
}

/** Sets a widget's accent, or clears it back to HARE's own. */
export function withAccent(
  placement: DashboardWidgetPlacement,
  accent: string | null
): DashboardWidgetPlacement {
  return { ...placement, accent: cleanAccent(accent) };
}
