import {
  DASHBOARD_WIDGETS,
  DEFAULT_DASHBOARD_SETTINGS,
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
function clampSpan(value: unknown): 1 | 2 {
  return value === 2 ? 2 : 1;
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
      out.push({ id: id as DashboardWidgetId, w: fallback?.w ?? 1, h: fallback?.h ?? 1 });
    } else {
      const placement = entry as Partial<DashboardWidgetPlacement>;
      out.push({ id: id as DashboardWidgetId, w: clampSpan(placement.w), h: clampSpan(placement.h) });
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
