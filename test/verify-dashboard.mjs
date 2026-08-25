// The second-screen dashboard — the parts that can only go wrong on a
// machine that isn't the one this was written on.
//
// WHY THESE THINGS AND NOT THE WINDOW ITSELF
//
// Opening a BrowserWindow on a chosen monitor needs Electron and real
// monitors, neither of which exist here. But almost nothing about that call
// is where the bugs are — it's a fixed set of options. The decisions that
// *do* differ per machine are all pure functions, and they're what this
// covers:
//
//   - A saved monitor that has since been unplugged. Windows renumbers
//     displays when the set changes, so a stored id routinely names nothing.
//     The dashboard must still open somewhere rather than silently failing.
//   - A settings file from a different version of HARE, or a half-written
//     one. Every field has to survive a partial read.
//   - The renderer wiring: the hash route, the broadcast reaching every
//     window rather than only the main one, and the "close" that happens on
//     quit not being mistaken for the user switching the feature off.
import { readFileSync, existsSync } from "node:fs";
import {
  resolveDashboardDisplayId,
  describeDisplay,
  normalizeDashboardSettings,
  normalizeWidgetPlacements,
  reorderPlacements,
  nextSpan,
} from "../dist-electron/backend/dashboardLayout.js";
import { DASHBOARD_WIDGETS, DEFAULT_DASHBOARD_SETTINGS } from "../dist-electron/backend/types.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const display = (id, w = 1920, h = 1080, label = "") => ({ id, label, size: { width: w, height: h } });

console.log("Second-screen dashboard...\n");

// --- Picking a monitor ------------------------------------------------------
{
  const primary = display(1);
  const second = display(2, 1280, 800);
  const third = display(3, 1024, 600);
  const all = [primary, second, third];

  check(
    "uses the monitor the user picked",
    resolveDashboardDisplayId(all, 1, 3) === 3
  );
  check(
    "with nothing picked, uses the first screen that isn't the main one",
    resolveDashboardDisplayId(all, 1, null) === 2
  );
  check(
    "a saved monitor that's been unplugged falls back to another one, not to nothing",
    resolveDashboardDisplayId(all, 1, 99) === 2
  );
  check(
    "on a single-monitor machine it still resolves to the main screen",
    resolveDashboardDisplayId([primary], 1, null) === 1
  );
  check(
    "...and to the main screen even when a stale id is saved",
    resolveDashboardDisplayId([primary], 1, 42) === 1
  );
  check(
    "no displays at all resolves to nothing rather than throwing",
    resolveDashboardDisplayId([], 1, 2) === null
  );
  check(
    "the primary can be picked deliberately",
    resolveDashboardDisplayId(all, 1, 1) === 1
  );
}

// --- Labelling monitors -----------------------------------------------------
{
  const named = describeDisplay(display(7, 2560, 1440, "DELL U2718Q"), 0, 1);
  check("a monitor's own name is used when Windows provides one", named.label === "DELL U2718Q");
  check("...and it's correctly marked as not the primary", named.isPrimary === false);

  const unnamed = describeDisplay(display(8, 1280, 800), 2, 8);
  check(
    "an unnamed monitor is labelled by position and resolution, both checkable by eye",
    unnamed.label === "Display 3 (1280×800)"
  );
  check("...and the primary is flagged", unnamed.isPrimary === true);
  check("size is carried through", unnamed.width === 1280 && unnamed.height === 800);
}

// --- Settings that survive an older or damaged file --------------------------
{
  const fromNothing = normalizeDashboardSettings(undefined);
  check(
    "a settings file with no dashboard section at all produces working defaults",
    fromNothing.enabled === false &&
      fromNothing.displayId === null &&
      fromNothing.widgets.length === DEFAULT_DASHBOARD_SETTINGS.widgets.length &&
      fromNothing.widgets.every((w) => typeof w.id === "string" && w.w >= 1)
  );

  const partial = normalizeDashboardSettings({ enabled: true });
  check(
    "a half-written section keeps its widgets rather than rendering an empty screen",
    partial.enabled === true && partial.widgets.length > 0
  );

  const junk = normalizeDashboardSettings({ enabled: "yes", displayId: "2", widgets: "clock", clock24h: 1 });
  check(
    "wrong types are replaced with defaults rather than reaching the UI",
    junk.enabled === false && junk.displayId === null && Array.isArray(junk.widgets) && junk.clock24h === false
  );

  const ids = (settings) => settings.widgets.map((w) => w.id).join();

  const stale = normalizeDashboardSettings({ widgets: ["clock", "widget-from-a-future-version", "system"] });
  check(
    "a widget this build doesn't have is dropped instead of rendering a blank card",
    ids(stale) === "clock,system"
  );

  const dupes = normalizeDashboardSettings({ widgets: ["clock", "clock", "system"] });
  check("a duplicated widget is collapsed", ids(dupes) === "clock,system");

  const empty = normalizeDashboardSettings({ widgets: [] });
  check("deliberately choosing no widgets is respected, not overridden", empty.widgets.length === 0);

  check(
    "every default widget is one this build actually has",
    DEFAULT_DASHBOARD_SETTINGS.widgets.every((placement) =>
      DASHBOARD_WIDGETS.some((w) => w.id === placement.id)
    )
  );
}

// --- Layouts written by an older build ------------------------------------
// Widgets used to be a bare list of ids, with the grid choosing every size.
// They now carry a size each. A settings file from the earlier build must
// keep someone's arrangement rather than silently resetting it.
{
  const migrated = normalizeWidgetPlacements(["clock", "system"]);
  check("an old list of ids still produces a working layout", migrated.length === 2);
  check("...with a real size on each", migrated.every((w) => [1, 2].includes(w.w) && [1, 2].includes(w.h)));
  check("...and the wide default preserved for the clock", migrated[0].id === "clock" && migrated[0].w === 2);

  const sized = normalizeWidgetPlacements([{ id: "system", w: 2, h: 2 }]);
  check("a saved size is kept", sized[0].w === 2 && sized[0].h === 2);

  const absurd = normalizeWidgetPlacements([{ id: "system", w: 99, h: -4 }]);
  check("a size outside the grid is clamped rather than breaking the layout", absurd[0].w === 1 && absurd[0].h === 1);

  const junk = normalizeWidgetPlacements([{ w: 2 }, null, "clock", 42]);
  check("entries with no usable id are dropped", junk.length === 1 && junk[0].id === "clock");
}

// --- Rearranging from the preview ------------------------------------------
{
  const layout = [
    { id: "clock", w: 2, h: 1 },
    { id: "system", w: 1, h: 1 },
    { id: "looks", w: 1, h: 1 },
  ];
  check(
    "dragging a widget to the front moves it there",
    reorderPlacements(layout, 2, 0).map((w) => w.id).join() === "looks,clock,system"
  );
  check(
    "dragging to the end moves it there",
    reorderPlacements(layout, 0, 2).map((w) => w.id).join() === "system,looks,clock"
  );
  check("dropping a widget on itself changes nothing", reorderPlacements(layout, 1, 1) === layout);
  check("an out-of-range drag is ignored rather than dropping a widget", reorderPlacements(layout, 9, 0).length === 3);
  check(
    "reordering never loses or duplicates a widget",
    new Set(reorderPlacements(layout, 2, 0).map((w) => w.id)).size === 3
  );

  const small = { id: "system", w: 1, h: 1 };
  const wide = nextSpan(small);
  const large = nextSpan(wide);
  check("resizing goes one cell → wide → large", wide.w === 2 && wide.h === 1 && large.w === 2 && large.h === 2);
  check("...and cycles back to one cell", nextSpan(large).w === 1 && nextSpan(large).h === 1);
  check("resizing keeps the widget it was applied to", wide.id === "system");
}

// --- The wiring that makes the window show live data ------------------------
// Static checks: these are one-line properties that are easy to lose in a
// later edit and produce a dashboard that silently shows stale data.
{
  const mainSrc = read("electron/main.ts");

  check(
    "state is broadcast to every window, not just the main one",
    /function broadcast\(/.test(mainSrc) && mainSrc.includes("BrowserWindow.getAllWindows()")
  );
  check(
    "no broadcast still addresses mainWindow directly",
    !/mainWindow\.webContents\.send\(/.test(mainSrc)
  );
  check(
    "closing every window on quit isn't recorded as the user turning the dashboard off",
    mainSrc.includes("isQuitting") && /isQuitting\?: boolean }\)\.isQuitting\) return;/.test(mainSrc)
  );
  check(
    "the dashboard reopens on the monitor it was last on",
    mainSrc.includes("settings.dashboard.enabled") && mainSrc.includes("settings.dashboard.displayId")
  );
  check(
    "the dashboard window gets the same navigation guards as the main window",
    mainSrc.includes("applyGuards: applyNavigationGuards")
  );

  const windowSrc = read("electron/backend/dashboardWindow.ts");
  check(
    "it runs sandboxed with context isolation, same as the main window",
    windowSrc.includes("contextIsolation: true") &&
      windowSrc.includes("sandbox: true") &&
      windowSrc.includes("nodeIntegration: false")
  );
  check(
    "fullscreen is released before a move, or the window stays on its old monitor",
    /setFullScreen\(false\)[\s\S]*setBounds[\s\S]*setFullScreen\(true\)/.test(windowSrc)
  );

  const sidebarSrc = read("src/components/Sidebar.tsx");
  check(
    "the second screen is a feature with its own tab, not a setting",
    sidebarSrc.includes("Widget Engine") && read("src/pages/WidgetEngine.tsx").length > 0
  );
  check(
    "...and no longer appears in Settings",
    !existsSync("src/components/DashboardSettings.tsx")
  );
  check(
    "cooler screens moved out of Settings too",
    read("src/pages/WidgetEngine.tsx").includes("ScreenControls") && !read("src/pages/Settings.tsx").includes("ScreenControls")
  );
  check(
    "importing someone else's widget declines until it can be made safe",
    /can't add widgets from other people yet/.test(mainSrc)
  );
  // ...and there is no control for it in the interface at all. A panel whose
  // only possible answer is "no" is a promise on screen with nothing behind
  // it; the refusal above stays as a guard in case anything ever reaches for
  // the handler.
  check(
    "...and nothing in Settings offers it",
    !/Community Widgets/.test(read("src/pages/Settings.tsx")) &&
      !read("src/pages/Settings.tsx").includes("handleImportWidget")
  );

  const entrySrc = read("src/main.tsx");
  check(
    "the renderer routes #dashboard to the dashboard rather than the main app",
    entrySrc.includes("dashboard") && entrySrc.includes("DashboardScreen")
  );
}

// --- Drawing what's actually running ----------------------------------------
{
  const typesSrc = read("electron/backend/types.ts");
  const managerSrc = read("electron/backend/backendManager.ts");
  check(
    "a device carries the full look it's running, not just the effect's name",
    typesSrc.includes("activeAssignment")
  );
  check(
    "...set when an effect is applied",
    managerSrc.includes("device.activeAssignment = assignmentWithoutDeviceId(assignment)")
  );
  check(
    "...and cleared when the effect is",
    managerSrc.includes("device.activeAssignment = null")
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_DASHBOARD_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_DASHBOARD_CHECKS_PASSED");
