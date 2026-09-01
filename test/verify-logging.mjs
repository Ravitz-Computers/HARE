// Diagnostic logging, and the three promises attached to it.
//
// The feature exists because HARE runs on hardware nobody here can test
// against, so the only useful evidence is what happened on the user's own PC.
// That makes the promises around it load-bearing:
//
//   1. Off by default — nothing is written until someone turns it on.
//   2. Never leaves the PC — there is no uploader, and the file says so.
//   3. Deleted after three days — not "usually", and not "the ones we
//      recognise as old" while a stray file lingers for a year.
//
// Retention is the part with real consequences in both directions: too
// aggressive and the evidence is gone before anyone reads it; too lax and a
// promise is quietly broken. It's a pure function for exactly that reason.
import {
  DiagnosticLogger,
  expiredLogFiles,
  logFileName,
  formatLine,
  describeArgs,
  LOG_RETENTION_DAYS,
} from "../dist-electron/backend/logger.js";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("Diagnostic logging...\n");

// --- Retention --------------------------------------------------------------
{
  const now = new Date("2026-08-24T12:00:00Z");
  const names = [
    "hare-2026-08-24.log", // today
    "hare-2026-08-23.log", // yesterday
    "hare-2026-08-22.log",
    "hare-2026-08-21.log", // exactly the cutoff
    "hare-2026-08-20.log", // older
    "hare-2026-01-01.log", // much older
  ];
  const expired = expiredLogFiles(names, now);

  check(`nothing inside the ${LOG_RETENTION_DAYS}-day window is deleted`, !expired.includes("hare-2026-08-24.log") && !expired.includes("hare-2026-08-22.log"));
  check("the cutoff day itself is kept, not deleted a day early", !expired.includes("hare-2026-08-21.log"));
  check("anything older goes", expired.includes("hare-2026-08-20.log") && expired.includes("hare-2026-01-01.log"));

  // The folder belongs to the user. Deleting things HARE didn't write would
  // be overreach, however old they look.
  const foreign = expiredLogFiles(
    ["notes.txt", "hare.log", "hare-2020-01-01.log.bak", "screenshot-2019-01-01.png"],
    now
  );
  check("files HARE didn't write are never touched", foreign.length === 0);

  // Crossing a month or a year is where date arithmetic usually goes wrong.
  check(
    "a month boundary is handled — two days old is kept",
    expiredLogFiles(["hare-2026-07-30.log"], new Date("2026-08-01T00:00:00Z")).length === 0
  );
  check(
    "...and a week old is deleted",
    expiredLogFiles(["hare-2026-07-25.log"], new Date("2026-08-01T00:00:00Z")).length === 1
  );
  check(
    "a year boundary is handled",
    expiredLogFiles(["hare-2025-12-25.log"], new Date("2026-01-02T00:00:00Z")).length === 1
  );
  check("today's file is named for today", logFileName(now) === "hare-2026-08-24.log");
}

// --- Line formatting --------------------------------------------------------
{
  const line = formatLine("warn", "OpenRGB went away", new Date("2026-08-24T13:45:07"));
  check("a line starts with the time, for matching against when it happened", line.startsWith("13:45:07"));
  check("...and names the level", line.includes("WARN"));
  check("...and carries the message", line.includes("OpenRGB went away"));

  check("strings pass through", describeArgs(["hello", "world"]) === "hello world");
  check("an Error becomes its name and message, not '[object Object]'", describeArgs([new Error("boom")]) === "Error: boom");
  check("objects are readable", describeArgs([{ a: 1 }]) === '{"a":1}');
  const circular = {};
  circular.self = circular;
  check("something unserialisable doesn't throw", typeof describeArgs([circular]) === "string");
}

// --- Off by default, and silent when off ------------------------------------
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "hare-log-off-"));
  try {
    const logger = new DiagnosticLogger(dir);
    check("a fresh logger is off", logger.isEnabled === false);

    logger.write("warn", "this must not be written");
    await sleep(30);
    check("writing while off produces no file at all", readdirSync(dir).length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- On: it writes, says it stays local, and sweeps -------------------------
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "hare-log-on-"));
  try {
    // A file well past the window, to prove enabling sweeps.
    writeFileSync(path.join(dir, "hare-2020-01-01.log"), "ancient");
    writeFileSync(path.join(dir, "keep-me.txt"), "not ours");

    const logger = new DiagnosticLogger(dir);
    await logger.setEnabled(true);
    logger.write("warn", "a motherboard didn't change colour");
    await sleep(60);

    const files = readdirSync(dir);
    check("turning it on deletes logs past the window", !files.includes("hare-2020-01-01.log"));
    check("...and leaves files that aren't ours alone", files.includes("keep-me.txt"));

    const todays = files.find((f) => /^hare-\d{4}-\d{2}-\d{2}\.log$/.test(f));
    check("a log for today is created", !!todays);

    const contents = readFileSync(path.join(dir, todays), "utf8");
    check("the file states plainly that it never leaves the PC", /never|nowhere else/i.test(contents) && /telemetry/i.test(contents));
    check("...and says it deletes itself", /three days/i.test(contents));
    check("...and says how to turn it off", /Settings/i.test(contents));
    check("the message is in there", contents.includes("a motherboard didn't change colour"));

    // Console output is the useful detail HARE already produces.
    console.warn("captured warning for the log");
    await sleep(60);
    check(
      "the main process's own warnings are captured without any call site changing",
      readFileSync(path.join(dir, todays), "utf8").includes("captured warning for the log")
    );

    await logger.setEnabled(false);
    // Writes queued while it was still on legitimately still land, so the
    // baseline is taken once the queue has drained rather than immediately.
    await sleep(80);
    const before = readFileSync(path.join(dir, todays), "utf8").length;
    console.warn("this happened after logging was turned off");
    logger.write("warn", "and so did this");
    await sleep(60);
    check(
      "turning it off stops everything, including the console capture",
      readFileSync(path.join(dir, todays), "utf8").length === before
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- It can never be the reason something breaks ---------------------------
{
  const logger = new DiagnosticLogger("/definitely/not/a/writable/path/hare-logs");
  await logger.setEnabled(true);
  logger.write("error", "into the void");
  await sleep(40);
  check("an unwritable folder doesn't throw or crash anything", true);
  await logger.setEnabled(false);

  const swept = await new DiagnosticLogger("/definitely/not/a/real/path").sweep();
  check("sweeping a folder that isn't there is harmless", Array.isArray(swept) && swept.length === 0);
}

// --- It's genuinely opt-in in the app, not just in this file ---------------
{
  const settings = readFileSync("electron/backend/appSettings.ts", "utf8");
  check("the setting ships off", /diagnosticLogging:\s*false/.test(settings));
  const main = readFileSync("electron/main.ts", "utf8");
  check("logging starts from the saved setting, not unconditionally", main.includes("logger.setEnabled(settings.diagnosticLogging)"));
  check("the logs folder is under HARE's own data directory", main.includes('path.join(app.getPath("userData"), "logs")'));
  const uninstaller = readFileSync("build/installer.nsh", "utf8");
  check("uninstalling removes them with everything else", uninstaller.includes('RMDir /r "$APPDATA\\HARE"'));
}

// --- A log you turn on mid-problem must not be empty ----------------------
// The first version only wrote its setup summary at startup, so someone who
// hit a problem, turned logging on and reproduced it got a nearly blank file
// — which is exactly what happened. A diagnostic that only records what
// happened before you asked for it is not a diagnostic.
{
  const main = readFileSync("electron/main.ts", "utf8");
  check(
    "enabling logging writes the setup summary immediately",
    /diagnosticLogging !== undefined[\s\S]{0,320}logDiagnosticInventory\(\)/.test(main)
  );
  check("...as well as at startup", (main.match(/logDiagnosticInventory\(\)/g) ?? []).length >= 2);

  // The summary has to carry the things that actually explain "my lights
  // don't change".
  for (const [label, needle] of [
    ["what HARE is talking to", "Backend status"],
    ["whether the elevated task exists", "Elevated OpenRGB logon task"],
    ["whether the PawnIO driver is there", "PawnIO driver"],
    ["every device, with its zones", "zone(s)"],
    ["which modes accept per-LED colour", "accepts per-LED colour"],
    ["whether other RGB software is running", "conflicting RGB software"],
  ]) {
    check(`the summary records ${label}`, main.includes(needle));
  }

  const backend = readFileSync("electron/backend/openrgbBackend.ts", "utf8");
  check("a deliberate colour change is logged", backend.includes("Writing rgb("));
  check("...and what the device reported back", backend.includes("Read back rgb("));
  check(
    "...but effect frames are not, or the log would be unreadable",
    !/setLedColors\([\s\S]{0,300}Writing rgb\(/.test(backend)
  );
}

// --- The window's own faults reach the log too -----------------------------
//
// The logger captures the main process's console, which made the log look
// complete while being blind to the whole renderer. Anything React throws
// while rendering throws there, and none of it was landing in the file: one
// bug was reported twice, from two different symptoms, with an empty log
// behind both, because the message only ever went to a console nobody opened.
{
  const main = readFileSync("electron/main.ts", "utf8");
  check(
    "the window's console is piped into the diagnostic log",
    /webContents\.on\(\s*["']console-message["']/.test(main)
  );
  check(
    "...on every window, through the guards each one already gets",
    /captureRendererConsole\(win\)/.test(main) &&
      main.indexOf("captureRendererConsole(win)") < main.indexOf("function captureRendererConsole")
  );
  check(
    "...errors and warnings only, so per-frame chatter can't bury them",
    /if \(!isError && !isWarning\) return;/.test(main)
  );
  check(
    "...and both shapes of the event are handled, or it logs nothing at all",
    /legacyLevel/.test(main) && /level === "error"/.test(main) && /level === 3/.test(main)
  );
}


console.log("");
if (failures > 0) {
  console.error(`ALL_LOGGING_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_LOGGING_CHECKS_PASSED");
