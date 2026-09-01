// What the interface says back, and what it says at all.
//
// WHY THIS EXISTS
//
// The lighting bug that cost three releases was invisible for a long time for
// one reason: HARE said it worked. The Effects page set "Applied ✓" without
// waiting for the call, without checking it, and even with zero devices
// selected — so a completely dead write path looked identical to a working
// one, on screen and in the report that came back.
//
// So these are not style checks. Each one guards a specific way the interface
// could lie about the hardware, or leave someone stuck with no way forward:
// success claimed before the call returns, a failure swallowed, a busy flag
// that never clears, or a control that can't be reached at all.
import { readFileSync, existsSync } from "node:fs";

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

console.log("Feedback, failure and reach...\n");

// --- There is somewhere for an outcome to go -------------------------------
{
  const store = read("src/state/store.ts");
  check("the store carries messages the interface can show", store.includes("toasts: Toast[]"));
  check("...with one helper that reports both outcomes", /run:\s*\(/.test(store) && store.includes("notify("));
  check(
    "a failure is reported, not swallowed",
    /catch \(error\)[\s\S]{0,200}notify\("error"/.test(store)
  );
  check(
    "the IPC channel's own prefix is stripped before anyone reads it",
    store.includes("Error invoking remote method")
  );
  check("the messages are rendered somewhere", read("src/components/Toasts.tsx").length > 0);
  check("...and mounted in the app", read("src/App.tsx").includes("<Toasts />"));
  check(
    "...where a screen reader will announce them",
    read("src/components/Toasts.tsx").includes('aria-live="polite"')
  );
}

// --- The specific lie that shipped -----------------------------------------
{
  const effects = read("src/pages/Effects.tsx");
  check(
    "applying an effect waits for the call before claiming anything",
    /const ok = await run\(/.test(effects) && /if \(!ok\) return;/.test(effects)
  );
  check(
    "applying to nothing says so instead of reporting success",
    /ids\.length === 0[\s\S]{0,160}notify\("error"/.test(effects)
  );
  check(
    "the effect list is not asserted non-null — an unknown id must not take the window down",
    !/effects\.find\([^)]*\)!/.test(effects)
  );

  const dashboard = read("src/pages/Dashboard.tsx");
  check(
    "Sync All with no devices says so too",
    /state\.devices\.length === 0[\s\S]{0,160}notify\("error"/.test(dashboard)
  );
}

// --- A failed action must not brick its own button -------------------------
// A rejected promise between `setBusy(true)` and `setBusy(false)` leaves the
// control disabled for the rest of the session. Rescan is the one someone
// reaches for precisely when things are already going wrong.
{
  for (const [file, label] of [
    ["src/pages/Settings.tsx", "Settings"],
    ["src/pages/Dashboard.tsx", "the dashboard"],
  ]) {
    const src = read(file);
    check(
      `a failed rescan on ${label} still re-enables the button`,
      /const handleRescan = async \(\) => \{\s*set\w+\(true\);\s*try \{[\s\S]{0,400}?\} finally \{\s*set\w+\(false\);/.test(
        src
      )
    );
  }
}

// --- A crash shows something other than a white window ---------------------
{
  check("there is an error boundary", read("src/components/ErrorBoundary.tsx").includes("getDerivedStateFromError"));
  const entry = read("src/main.tsx");
  check("...wrapped around the whole app", entry.includes("<ErrorBoundary>"));
  check(
    "...and a rejection with nobody listening still reaches the log",
    entry.includes("unhandledrejection")
  );
}

// --- Controls that can be operated and named -------------------------------
{
  const settings = read("src/pages/Settings.tsx");
  check(
    "a toggle can't be built without saying what it controls",
    /label: string;/.test(settings) && settings.includes("aria-label={label}")
  );
  check(
    "...and every toggle passes one",
    (settings.match(/<Toggle\b/g) ?? []).length === (settings.match(/label="/g) ?? []).length ||
      !/<Toggle\s+(?!\s*label=)[^>]*on=/.test(settings)
  );

  const painter = read("src/components/LedPainter.tsx");
  check("each LED says which one it is", painter.includes("aria-label={`${zone.name}"));
  check("...and can be painted from the keyboard", /onKeyDown[\s\S]{0,240}paintOne/.test(painter));

  const gallery = read("src/pages/Gallery.tsx");
  check(
    "the apply-to list can be closed without applying anything",
    gallery.includes("setPickerOpen(false)") && gallery.includes('e.key === "Escape"')
  );
}

// --- Per-zone colour is per zone -------------------------------------------
// One shared colour behind every zone swatch meant setting the second zone
// visibly reset the first, and no swatch matched what the hardware showed.
{
  const detail = read("src/pages/DeviceDetail.tsx");
  check("each zone row owns its colour", detail.includes("function ZoneColorRow"));
  check(
    "...rather than writing back into the page's single colour",
    !/setZoneColor\(device\.id, zone\.id, c\);\s*\n?\s*\}\}\s*\n?\s*\/>/.test(
      detail.replace(/function ZoneColorRow[\s\S]*$/, "")
    )
  );
}

// --- One state, one wording ------------------------------------------------
{
  const copy = read("src/lib/statusCopy.ts");
  check("status wording lives in one place", copy.includes("export function describeStatus"));
  check(
    "...including the correction that connected-with-no-devices isn't connected",
    /deviceCount === 0/.test(copy)
  );
  for (const file of ["src/components/StatusPill.tsx", "src/dashboard/widgets/StatusWidget.tsx"]) {
    const src = read(file);
    // Calls it, not merely imports it — the import surviving a rewrite is
    // exactly how this would quietly come apart again.
    check(`${file.split("/").pop()} uses it`, /describeStatus\(/.test(src));
    check(
      `...and keeps no wording of its own`,
      !/STATUS_(COPY|LABEL)\s*[:=]/.test(src) &&
        !/(label|dot):\s*"/.test(src) &&
        !/"(Connected|Not connected|No devices detected|Starting up)/.test(src)
    );
  }
}

// --- Nothing on screen that leads nowhere ----------------------------------
{
  const dead = ["src/pages/Effects.tsx", "src/pages/DeviceDetail.tsx"].filter((f) =>
    read(f).includes("comingSoon")
  );
  check(
    `no "coming soon" scaffolding for a flag nothing ever sets${dead.length ? ` — ${dead.join(", ")}` : ""}`,
    dead.length === 0
  );
  check(
    "a vendor HARE can't drive says why",
    read("src/pages/Settings.tsx").includes("notControllableReason") &&
      read("electron/backend/vendors/vendorManager.ts").includes("notControllableReason")
  );
  check(
    "the hardware step offers one way on, not two identical ones",
    (read("src/components/HardwareAccessStep.tsx").match(/void skip\(\)/g) ?? []).length === 1
  );
}

// --- Help that points at controls which exist -------------------------------
{
  const help = read("src/pages/settingsHelp.tsx");
  check(
    "help doesn't send people to Settings for the second screen — it moved",
    !help.includes("Appearance → Second Screen")
  );
  check("...it names where it actually is", help.includes("Widgets &amp; Screens"));
  check(
    "...and Open OpenRGB is described where it actually lives",
    !/Diagnostic Log<\/b>, turn it on, then use <b>Open OpenRGB<\/b> in the\s*\n?\s*same panel/.test(help)
  );
}

// --- The welcome screen reflects the real scan ------------------------------
{
  const onboarding = read("src/pages/Onboarding.tsx");
  check(
    "the welcome screen waits for the scan, not a fixed timer",
    onboarding.includes('state.status === "scanning"')
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_FEEDBACK_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_FEEDBACK_CHECKS_PASSED");
