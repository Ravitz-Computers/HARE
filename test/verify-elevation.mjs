// Verifies the elevated-helper command construction and the "don't launch a
// second OpenRGB" probe.
//
// WHY THIS IS WORTH TESTING
//
// Creating the scheduled task means quoting a Windows path — which routinely
// contains spaces — through three nested layers: a PowerShell single-quoted
// literal, inside a PowerShell array argument, inside schtasks' own `/TR`
// parameter, which is itself a quoted command line. Every layer has different
// escaping rules, and getting one wrong doesn't throw. It produces a task
// that registers successfully and then silently fails to launch anything, or
// worse, launches something other than what was intended.
//
// The elevation itself can't be tested here — there is no Windows, no UAC and
// no Task Scheduler in this environment. What can be tested is everything up
// to the moment of elevation: the exact argument vector, and the decision
// logic around it.
import {
  ElevationHelper,
  buildElevatedRunArgs,
  buildElevatedScriptArgs,
  buildTaskScript,
  buildRemoveScript,
  OPENRGB_TASK_NAME,
} from "../dist-electron/backend/elevationHelper.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const withPlatform = (platform, run) => {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  return Promise.resolve(run()).finally(() => Object.defineProperty(process, "platform", real));
};

console.log("Elevated OpenRGB helper...\n");

// --- Command construction ---------------------------------------------------
// THIS IS WHERE A REAL BUG SHIPPED.
//
// The first version built `schtasks /Create ... /TR "<exe>" --server` and
// handed it to PowerShell's -ArgumentList. The /TR value must contain double
// quotes, because the executable path contains spaces. PowerShell re-quotes
// native arguments on the way out and those inner quotes did not survive, so
// schtasks rejected the command — but the UAC prompt had already appeared and
// been accepted, so HARE told the user they had dismissed a prompt they had
// just approved. Wrong outcome, wrong explanation, no way to tell.
//
// The fix removes the nesting rather than escaping harder: the task is
// registered by a script file, and the only thing on a command line is a path.
{
  const script = buildTaskScript("C:\\Program Files\\HARE\\OpenRGB.exe", 6742, OPENRGB_TASK_NAME, "C:\\Temp\\r.txt");

  check("the program and its arguments are separate parameters, never one quoted string",
    script.includes("-Execute 'C:\\Program Files\\HARE\\OpenRGB.exe'") &&
    script.includes("-Argument '--server --server-port 6742'"));
  check("no double quotes anywhere — that was the whole bug", !script.includes('"'));
  check("it runs at logon", script.includes("New-ScheduledTaskTrigger -AtLogOn"));
  check("it asks for the highest privileges — the entire point", script.includes("-RunLevel Highest"));
  check("it overwrites an existing task rather than failing", script.includes("-Force"));
  check("the task is named exactly once", script.split(OPENRGB_TASK_NAME).length - 1 === 1);
  check("it survives running on battery", script.includes("-AllowStartIfOnBatteries"));
  check("...and isn't killed after Windows' default time limit", script.includes("ExecutionTimeLimit"));
  check("it writes its own outcome so HARE can report the real reason",
    script.includes("Set-Content") && script.includes("'ok'") && script.includes("'error: '"));
  check("a failure exits non-zero", /catch \{[\s\S]*exit 1/.test(script));
}

// --- Paths with an apostrophe in them --------------------------------------
// "C:\Users\O'Brien\..." is a real Windows path and would end a PowerShell
// literal early, running something other than what was intended.
{
  const script = buildTaskScript("C:\\Users\\O'Brien\\HARE\\OpenRGB.exe", 6742, OPENRGB_TASK_NAME, "C:\\r.txt");
  check("an apostrophe in the path is doubled", script.includes("O''Brien"));

  const args = buildElevatedScriptArgs("C:\\Users\\O'Brien\\AppData\\Local\\Temp\\hare.ps1");
  check("...and in the script path too", args.at(-1).includes("O''Brien"));
}

// --- Running the script elevated -------------------------------------------
{
  const args = buildElevatedScriptArgs("C:\\Temp\\hare-grant-access.ps1");
  const cmd = args.at(-1);
  check("elevates with -Verb RunAs — the single UAC prompt", cmd.includes("-Verb RunAs"));
  check("waits, so the result is knowable rather than assumed", cmd.includes("-Wait"));
  check("hides the console window it would otherwise flash up", cmd.includes("-WindowStyle Hidden"));
  check("runs the script by path with -File, not as an inline command", cmd.includes("'-File'"));
  check("bypasses execution policy, which blocks scripts by default on many PCs",
    cmd.includes("'-ExecutionPolicy','Bypass'"));
  check("the only quotes are PowerShell's own literals", !cmd.includes('\\"'));
}

// --- Removal ----------------------------------------------------------------
{
  const script = buildRemoveScript(OPENRGB_TASK_NAME, "C:\\r.txt");
  check("removal unregisters the task without prompting again", script.includes("Unregister-ScheduledTask") && script.includes("-Confirm:$false"));
  check("...and reports its outcome the same way", script.includes("'ok'"));
}

// --- Telling apart declined, failed, and worked ----------------------------
// The bug users actually saw was this distinction collapsing: an accepted
// prompt whose command then failed was reported as "you dismissed it".
{
  const fakeFiles = (result) => ({
    written: {},
    async write(path, contents) {
      this.written[path] = contents;
    },
    async read() {
      return result;
    },
    async remove() {},
    tempDir: () => "C:\\Temp",
  });

  await withPlatform("win32", async () => {
    // 1. Declined: Start-Process throws, so no result file and a failed command.
    const declined = new ElevationHelper(
      { async run() { return { code: 1, stdout: "", stderr: "" }; } },
      fakeFiles(null)
    );
    const a = await declined.enable("C:\\HARE\\OpenRGB.exe", 6742);
    check("a declined prompt says so", !a.ok && /declined/i.test(a.message));

    // 2. Accepted, but Windows refused — the case that used to lie.
    const failed = new ElevationHelper(
      { async run() { return { code: 1, stdout: "", stderr: "" }; } },
      fakeFiles("error: Access to the path is denied.")
    );
    const b = await failed.enable("C:\\HARE\\OpenRGB.exe", 6742);
    check("an accepted prompt that then failed reports the real reason", !b.ok && b.message.includes("Access to the path is denied"));
    check("...and never claims the user dismissed it", !/dismiss/i.test(b.message));

    // 3. Worked: the task query is what decides, not the exit code.
    const worked = new ElevationHelper(
      {
        async run(exe, args) {
          if (exe === "schtasks.exe" && args[0] === "/Query") return { code: 0, stdout: "", stderr: "" };
          return { code: 0, stdout: "", stderr: "" };
        },
      },
      fakeFiles("ok")
    );
    const c = await worked.enable("C:\\HARE\\OpenRGB.exe", 6742);
    check("a task that really exists is reported as success", c.ok === true);
  });
}

// --- The probe that stops a second OpenRGB ---------------------------------
// Whether the elevated task started it, or the user has OpenRGB open
// themselves, HARE must not spawn a competing copy — and must not later kill
// a server it didn't start.
{
  const net = await import("node:net");
  const { OpenRgbBackend } = await import("../dist-electron/backend/openrgbBackend.js");

  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(6799, "127.0.0.1", r));

  const backend = new OpenRgbBackend({ port: 6799, openRgbExePath: "/definitely/not/a/real/path" });
  const occupied = await backend.isServerAlreadyRunning.call(backend);
  check("detects an OpenRGB server that is already listening", occupied === true);
  await new Promise((r) => server.close(r));

  const free = await backend.isServerAlreadyRunning.call(backend);
  check("detects when the port is free", free === false);
}

// --- Running an installer elevated -----------------------------------------
// Same escaping problem as above, one layer shallower: a path with an
// apostrophe in it ("C:\\Users\\Sam's PC\\...") would otherwise end the
// PowerShell string early and run something other than what was intended.
{
  const args = buildElevatedRunArgs("C:\\Users\\Sam's PC\\pawnio.exe", ["/S"]);
  const cmd = args[args.length - 1];
  check("elevates with -Verb RunAs", cmd.includes("-Verb RunAs"));
  check("waits for the installer to finish", cmd.includes("-Wait"));
  check("does NOT hide the window — the user must see what they approved", !cmd.includes("-WindowStyle Hidden"));
  check("an apostrophe in the path is doubled, not left to end the string", cmd.includes("Sam''s PC"));
  check("arguments are passed through as a PowerShell array", cmd.includes("-ArgumentList @('/S')"));
  check("no arguments means no empty ArgumentList", !buildElevatedRunArgs("C:\\x.exe", []).join(" ").includes("ArgumentList"));
}

console.log("");
if (failures > 0) {
  console.error(`ALL_ELEVATION_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_ELEVATION_CHECKS_PASSED");
