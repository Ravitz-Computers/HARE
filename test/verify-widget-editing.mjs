// The second screen: arranging it, locking it, and what's behind it.
//
// WHY THIS EXISTS
//
// Three of these shipped looking finished and were not reachable:
//
//   1. **Resize did nothing.** The size control was a popover *inside* the
//      layout preview, and that preview has `overflow-hidden` on it. In a
//      one-cell widget the panel was about ninety pixels wide with half of it
//      clipped off the edge. The code was correct; the button could not be
//      pressed.
//   2. **The dropdowns inside it may never have opened at all.** A native
//      `<select>` inside a `draggable` element frequently refuses to open in
//      Chromium -- so even where the popover was visible, the control wasn't.
//   3. **"No background" showed a dark rectangle.** Making the *window*
//      transparent is half of it; the document still paints. `body` carries an
//      opaque colour and two radial gradients, so the screen looked exactly as
//      it had before.
//
// Every one of those is invisible to a test that only checks the state
// changed. So these check the shape of the thing a person has to reach.
import { existsSync, readFileSync } from "node:fs";

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

console.log("Arranging the second screen...\n");

const controls = read("src/components/WidgetControls.tsx");
const canvas = read("src/components/WidgetCanvas.tsx");
const screen = read("src/dashboard/DashboardScreen.tsx");

// --- The controls can actually be operated ---------------------------------
{
  check("size and colour live in one shared component", controls.includes("export function WidgetControls"));
  check(
    "the size control is a stepper, not a native select inside a draggable",
    // Anchored to the line start so the comment explaining *why* there is
    // no select doesn't count as one.
    controls.includes("function Stepper") && !/^\s*<select/m.test(controls)
  );
  check(
    "...covering the full width of the grid",
    controls.includes("max={DASHBOARD_COLUMNS}") && controls.includes("max={MAX_WIDGET_ROWS}")
  );
  check("...with a touch-sized variant for the second screen", controls.includes('size?: "normal" | "touch"'));
}

// --- ...and are not inside the box that clips them -------------------------
{
  const previewEnd = canvas.indexOf("{/* Outside the frame above");
  const usage = canvas.indexOf("<WidgetControls");
  check("the preview still clips its contents, as a miniature must", canvas.includes("overflow-hidden rounded-2xl border"));
  check("but the controls render outside it", previewEnd > 0 && usage > previewEnd);
  check(
    "...and nothing is left inside it that has to be reached",
    !/absolute[^"]*top-9[^"]*z-20/.test(canvas)
  );
}

// --- Editing on the screen itself ------------------------------------------
{
  check("the second screen has an edit mode", screen.includes("setEditing"));
  check("...which is off until asked for, so a glance can't disturb anything", /useState\(false\)/.test(screen));
  check("...lets a widget be dragged to a new place", screen.includes("reorderPlacements"));
  check("...and opens the same controls, at touch size", screen.includes('size="touch"'));
  check(
    "changes are saved rather than held locally, so both windows agree",
    /saveWidgets[\s\S]{0,200}setAppSettings/.test(screen)
  );
  check(
    "a widget's own buttons can't fire while the layout is being rearranged",
    screen.includes("absolute inset-0 rounded-2xl bg-hare-bg/25")
  );
}

// --- The lock --------------------------------------------------------------
// A touch panel is often somewhere anyone can reach.
{
  check("the layout can be locked", read("electron/backend/types.ts").includes("locked: boolean"));
  check(
    "...and a locked screen can't be edited even if edit mode was already on",
    /const canEdit = editing && !locked/.test(screen)
  );
  check("...the screen says it's locked rather than just refusing", screen.includes("Locked"));
  check(
    "...and the switch is in HARE's own window, so the screen can't unlock itself",
    read("src/pages/WidgetEngine.tsx").includes("Lock the layout") && !screen.includes("locked: !")
  );
  check(
    "a saved file that predates the lock is read as unlocked",
    read("electron/backend/dashboardLayout.ts").includes('typeof raw.locked === "boolean"')
  );
}

// --- "No background" actually shows the desktop ----------------------------
{
  check(
    "the window itself is created transparent",
    read("electron/backend/dashboardWindow.ts").includes("transparent,")
  );
  check(
    "...and the page stops painting over it, which is the half that was missing",
    read("src/index.css").includes("html.hr-transparent")
  );
  check(
    "...covering body and the React root, not just html",
    /html\.hr-transparent body[\s\S]{0,60}#root/.test(read("src/index.css"))
  );
  check("...applied from the background setting", screen.includes('classList.toggle("hr-transparent"'));
}

// --- Starting with Windows -------------------------------------------------
{
  const defaults = read("electron/backend/appSettings.ts");
  check("HARE starts with Windows by default", /launchOnStartup: true/.test(defaults));
  check("...into the tray, so nothing appears at logon", /startMinimized: true/.test(defaults));

  const main = read("electron/main.ts");
  check(
    "the Run entry carries a flag, since Electron can't tell who started it on Windows",
    main.includes("STARTED_BY_WINDOWS_FLAG") && main.includes("args: [STARTED_BY_WINDOWS_FLAG]")
  );
  check(
    "...so opening HARE yourself still shows a window",
    /startedByWindows && appSettings\.get\(\)\.startMinimized/.test(main)
  );
  check(
    "the setting is only offered when it can do something",
    /appSettings\.launchOnStartup && \([\s\S]{0,1500}startMinimized/.test(read("src/pages/Settings.tsx"))
  );
}

// --- The second screen's taskbar button ------------------------------------
// It shared HARE's icon and HARE's taskbar button, so a frameless fullscreen
// window read as a dialog somebody had left open.
{
  const win = read("electron/backend/dashboardWindow.ts");
  check("the second screen gets its own taskbar identity", win.includes("setAppDetails"));
  check("...under its own app id, which is what separates the button", win.includes("com.ravitzcomputers.hare.dashboard"));
  check("...with a name of its own", win.includes("HARE Widget Screen"));
  check(
    "...and its own badge, drawn from a different pose",
    read("scripts/build-art.mjs").includes('pose("hare-logo-2"') && existsSync("build/dashboard-icon.ico")
  );
  check(
    "...which actually ships, or the button would be blank",
    read("electron-builder.yml").includes("build/dashboard-icon.ico")
  );
  check(
    "...and is what the window is given",
    read("electron/main.ts").includes("iconPath: dashboardIconPath")
  );
}

// --- A screen nobody has configured yet -----------------------------------
//
// Settings for a screen are only written once something is chosen, so until
// then there is no entry at all — which is the state every screen is in the
// first time its panel is opened. One read of that entry without a question
// mark threw during render, and because a render throw happens in the
// renderer rather than the main process, the result was a panel replaced by
// an error card with nothing in the diagnostic log to explain it. It was
// reported twice, as "the tab won't open" and then as "the screen doesn't
// allow any control".
{
  const panel = read("src/components/ScreenControls.tsx");

  // Every read has to be optional. A bare `gauge.` is the exact shape of the
  // bug, so it is banned outright rather than argued about case by case.
  // Comments are stripped first: the note explaining this bug names the bad
  // form on purpose, and a check that its own documentation trips is a check
  // that gets deleted.
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const bare = [...code.matchAll(/(?<![?\w])gauge\.[a-zA-Z]/g)].map((m) => m[0]);
  check(
    `every read of a screen's settings survives there being none (${bare.length} bare)`,
    bare.length === 0
  );

  // The same trap one level down: the settings object itself.
  const store = read("src/state/store.ts");
  check(
    "the settings object always exists, even before anything is saved",
    /screenGauges:\s*\{\}/.test(store) || /screenGauges:\s*EMPTY/.test(store)
  );

  // The containment that turned this from "the tab is gone" into "this one
  // screen says what happened". Worth keeping either way.
  check(
    "and one screen's panel failing can't take the tab with it",
    /inline/.test(read("src/pages/WidgetEngine.tsx")) &&
      /ErrorBoundary/.test(read("src/pages/WidgetEngine.tsx"))
  );
}

// --- The way in to a background picture ------------------------------------
//
// The switch for the background layer was disabled until a picture existed,
// and the control for choosing one only rendered once the layer was on. So the
// switch said "choose one below" and there was nothing below, and there was no
// way to add a picture at all. Reported exactly that way.
{
  const panel = read("src/components/ScreenControls.tsx");
  const picker = panel.slice(panel.indexOf("backgroundRef.current?.click()"));

  check(
    "the picture chooser is not hidden behind the layer it fills",
    !/\{backgroundOn && \([\s\S]{0,200}backgroundRef\.current/.test(panel)
  );
  check(
    "...and choosing one turns the layer on, so it is one step not two",
    /background: canvas\.toDataURL\("image\/jpeg", 0\.9\), backgroundEnabled: true/.test(panel)
  );
  check("...and a chosen picture can be taken off again", /Remove/.test(picker));
}

// --- Setting every channel at once -----------------------------------------
//
// A fan controller's channels usually carry the same fans, so the same number
// goes in eight times with a device re-read between each. By hand that is
// about a minute of clicking, and the thing people do instead is leave every
// channel at its maximum.
{
  const editor = read("src/components/ZoneSizeEditor.tsx");
  check("every channel can be set to one number at once", /function SetAll/.test(editor));
  check(
    "...offering only a number every channel will accept",
    /Math\.max\(\.\.\.zones\.map\(\(z\) => z\.ledsMin/.test(editor) &&
      /Math\.min\(\.\.\.zones\.map\(\(z\) => z\.ledsMax/.test(editor)
  );
  check(
    "...applied one at a time, since each one re-reads the controller",
    /for \(const zone of zones\) \{[\s\S]{0,200}await resizeZone/.test(editor)
  );
  check("...and only shown when there is more than one to set", /resizable\.length > 1 && <SetAll/.test(editor));
}

// --- A screen that cannot be drawn on is left alone ------------------------
//
// The redraw runs every five seconds for as long as HARE is open. On a cooler
// that refuses every write, that is a full open-query-write cycle over USB
// forever, and forty lines of log a minute saying the same thing.
{
  const loop = read("src/lib/useScreenGauges.ts");
  check(
    "a screen that keeps failing is eventually left alone",
    /GIVE_UP_AFTER/.test(loop) && /if \(givenUp\.has\(key\)\) continue;/.test(loop)
  );
  check(
    "...counting refusals that come back as a result, not only thrown errors",
    /result\.ok === false\) throw new Error/.test(loop)
  );
  check("...and a successful draw clears the count", /failures\.delete\(key\)/.test(loop));
  check(
    "...with the decision outside the component, so a re-render can't resume it",
    loop.indexOf("const givenUp = new Map") < loop.indexOf("export function useScreenGauges")
  );
}


console.log("");
if (failures > 0) {
  console.error(`ALL_WIDGET_EDITING_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_WIDGET_EDITING_CHECKS_PASSED");
