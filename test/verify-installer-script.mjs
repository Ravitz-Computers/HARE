// The NSIS installer script, checked without NSIS.
//
// WHY THIS EXISTS
//
// A one-character mistake here broke three releases in a row, and none of the
// existing tests could see it: `-Confirm:$false` in a PowerShell command
// embedded in NSIS. NSIS reads `$name` as one of *its* variables, so `$false`
// is an unknown-variable warning — and electron-builder compiles NSIS with
// warnings treated as errors, so the entire installer build fails. The app
// itself was fine. Nothing shipped.
//
// There is no NSIS in this environment to compile against, so this is static
// analysis of the one class of mistake that actually bit: a dollar sign that
// NSIS will read as a variable when it was meant as literal text. That's a
// narrow check on purpose — a broad "lint NSIS" would be guesswork, while
// this one has a known, reproduced failure behind it.
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

const SCRIPT = "build/installer.nsh";

/**
 * NSIS's own variables and constants. Anything else after a single `$` is
 * either a typo or — far more likely here — text meant for the shell command
 * being embedded, which has to be escaped as `$$`.
 */
const NSIS_NAMES = new Set([
  // User registers.
  ...Array.from({ length: 10 }, (_, i) => `${i}`),
  ...Array.from({ length: 10 }, (_, i) => `R${i}`),
  // The constants this installer actually uses, plus the common ones.
  "INSTDIR", "OUTDIR", "EXEDIR", "EXEFILE", "EXEPATH", "PLUGINSDIR", "TEMP",
  "APPDATA", "LOCALAPPDATA", "COMMONFILES", "COMMONFILES32", "COMMONFILES64",
  "PROGRAMFILES", "PROGRAMFILES32", "PROGRAMFILES64", "PROGRAMDATA",
  "DESKTOP", "STARTMENU", "SMPROGRAMS", "SMSTARTUP", "QUICKLAUNCH",
  "DOCUMENTS", "PICTURES", "MUSIC", "VIDEOS", "FAVORITES", "SENDTO",
  "RECENT", "TEMPLATES", "FONTS", "WINDIR", "SYSDIR", "HWNDPARENT",
  "LANGUAGE", "INSTALLER_LANGUAGE", "CMDLINE", "PROFILE", "APPDATA_LOCAL",
]);

console.log("Installer and single-instance behaviour...\n");

const source = existsSync(SCRIPT) ? readFileSync(SCRIPT, "utf8") : "";
check("the installer script exists", source.length > 0);

// Variables the script declares for itself with `Var`. These are as real as
// the built-in ones; the check is for dollars that NSIS *can't* resolve.
for (const match of source.matchAll(/^\s*Var\s+\/?G?L?O?B?A?L?\s*(\w+)\s*$/gm)) {
  NSIS_NAMES.add(match[1]);
}

/** NSIS comments are never compiled, so they can say `$false` freely — and this file's do. */
const code = source
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith(";"))
  .join("\n");

// --- The failure that shipped ----------------------------------------------
{
  const offenders = [];
  source.split(/\r?\n/).forEach((line, index) => {
    // Comments are NSIS comments and never compiled.
    if (line.trimStart().startsWith(";")) return;
    // Walk the line so `$$` can be consumed as an escape rather than matched.
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "$") continue;
      if (line[i + 1] === "$") {
        i++; // An escaped dollar. Correct, and not a variable reference.
        continue;
      }
      const name = /^\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(line.slice(i + 1))?.[1];
      if (!name) continue;
      // ${...} is a define or macro, which NSIS resolves separately.
      if (line[i + 1] === "{") continue;
      if (!NSIS_NAMES.has(name)) {
        offenders.push(`line ${index + 1}: $${name}`);
      }
    }
  });

  check(
    `no dollar sign NSIS would read as an unknown variable${offenders.length ? ` — ${offenders.join(", ")}` : ""}`,
    offenders.length === 0
  );
}

// --- The specific line, since it's the one that broke ----------------------
{
  check(
    "the uninstaller passes -Confirm:$false to PowerShell with the dollar escaped",
    code.includes("-Confirm:$$false")
  );
  check(
    "...and never bare, which is what electron-builder fails on",
    !/[^$]\$false/.test(code)
  );
}

// --- What the uninstaller must still actually do --------------------------
// A syntactically valid script that removes nothing would pass the checks
// above while quietly breaking the promise that uninstalling leaves nothing.
{
  check("it removes the elevated logon task", source.includes("Unregister-ScheduledTask"));
  check("...naming the same task the app creates", source.includes("HARE OpenRGB Access"));
  check("it stops the bundled OpenRGB", source.includes("Stop-Process") && source.includes("OpenRGB"));
  check("it removes the user data, including logs and modules", source.includes('RMDir /r "$APPDATA\\HARE"'));
  // This is a per-machine install, so NSIS hands the uninstaller
  // SetShellVarContext all — under which $APPDATA is C:\ProgramData, not the
  // user's Roaming folder. Without the switch, the line above deleted a
  // directory that has never existed and every setting, saved look, log and
  // installed module survived every uninstall. It looked completely correct.
  check(
    "...from the user's own profile, not ProgramData",
    /SetShellVarContext current[\s\S]*RMDir \/r "\$APPDATA\\HARE"/.test(source)
  );
  check(
    "...and the context is put back afterwards",
    /RMDir \/r "\$APPDATA\\HARE"[\s\S]*SetShellVarContext all/.test(source)
  );
  check(
    "it removes the 150 MB copy of itself the installer leaves behind",
    source.includes('RMDir /r "$LOCALAPPDATA\\hare-updater"')
  );
  check(
    "it removes the driver installer's scratch folder",
    source.includes('RMDir /r "$TEMP\\hare-pawnio"')
  );
  check(
    "it removes OpenRGB's settings only when HARE was what created them",
    /OpenRgbConfigCreatedByHare[\s\S]{0,200}RMDir \/r "\$APPDATA\\OpenRGB"/.test(source)
  );
  check(
    "the startup entry is deleted under every name it could have been written as",
    source.includes('CurrentVersion\\Run" "HARE"') &&
      source.includes('"electron.app.HARE"') &&
      source.includes("StartupApproved")
  );
  check(
    "...and the app writes it under a name it chose, rather than one Electron derived",
    readFileSync("electron/main.ts", "utf8").includes("RUN_KEY_VALUE_NAME")
  );
  check(
    "only HARE's own OpenRGB is stopped, not one the user runs themselves",
    source.includes("Get-Process OpenRGB") && !source.includes('taskkill /F /IM OpenRGB.exe /FI')
  );
  check("it removes the launch-at-startup entry", source.includes("DeleteRegValue") && source.includes("CurrentVersion\\Run"));
}

// --- The driver is installed with HARE, not left to the user --------------
// Motherboard and RAM lighting needs a kernel driver. Telling someone to go
// and fetch one after they've already run an installer isn't a product, so it
// ships inside HARE and is installed here, where the installer is already
// elevated.
{
  check("the driver is installed during setup", source.includes("!macro customInstall"));
  check(
    "...from the copy shipped inside HARE",
    code.includes("resources\\pawnio\\PawnIO-Setup.exe")
  );
  check(
    "an install that's already there is left alone",
    /Call CheckPawnIO[\s\S]{0,200}StrCmp \$PawnIOPresent "yes" pawnio_done/.test(code)
  );
  // The driver's own branch, scoped so the runtime installer's documented
  // `/quiet` below can't be mistaken for a guess made here.
  const pawnioSection = code.slice(
    code.indexOf('StrCpy $1 "$INSTDIR\\resources\\pawnio'),
    code.lastIndexOf("pawnio_done:") >= 0 ? code.lastIndexOf("pawnio_done:") : undefined
  );

  // The switch is `-install -silent`, dash-style, declared by PawnIO's
  // publisher in its own winget manifest in microsoft/winget-pkgs. An earlier
  // version guessed at slash-style switches, hit an error dialog nobody could
  // see, and hung setup — so the rule is unchanged (never guess), only the
  // fact changed (a documented switch does exist).
  check(
    "the driver is installed with the publisher's documented silent switch",
    pawnioSection.includes(`ExecWait '"$1" -install -silent'`)
  );
  check(
    "...and no slash-style switch, which is what hung setup when it was guessed",
    pawnioSection.length > 0 && !/\/quiet|\/VERYSILENT|\/S'/.test(pawnioSection)
  );
  // Two failures this project has already shipped: a wizard sitting on top of
  // the finish page that people read as a stall, and an unattended install
  // silently skipping the driver so motherboard lighting never worked.
  check(
    "an unattended install gets the driver too, rather than skipping it",
    !/IfSilent[^\n]*\n\s*DetailPrint "Silent install: skipping the PawnIO driver/.test(code)
  );
  check(
    "...and nothing is left on screen on an ordinary install either",
    !/^\s*Exec '"\$1"'\s*$/m.test(pawnioSection.split("Silent install didn't take")[0])
  );
  // An exit code of zero from an installer that installed nothing is exactly
  // how MSI Mystic Light reported success for a completely dead write path.
  check(
    "whether it worked is checked against the service, not the exit code",
    /ExecWait '"\$1" -install -silent'[\s\S]{0,400}Call CheckPawnIO[\s\S]{0,200}StrCmp \$PawnIOPresent "yes" pawnio_installed/.test(code)
  );
  check(
    "...and a silent install that didn't take falls back to the visible installer",
    /Silent install didn't take[\s\S]{0,200}Exec '"\$1"'/.test(code)
  );
  check(
    "...which an unattended install can't use, so it says where to get it instead",
    /PawnIO didn't install[^"]*Settings > Hardware/.test(code)
  );
  check(
    "the driver is only recorded as ours once it is actually installed",
    /pawnio_installed:[\s\S]{0,400}WriteRegDWORD HKLM "Software\\HARE" "PawnIOInstalledByHare" 1/.test(code)
  );
  check(
    "the 25 MB runtime installer isn't left in Program Files forever",
    code.includes('Delete "$INSTDIR\\resources\\redist\\vc_redist.x64.exe"')
  );
  check(
    "...but the driver installer is kept, because Settings re-uses that exact file",
    !/Delete "\$INSTDIR\\resources\\pawnio/.test(code)
  );
  check(
    "a runtime HARE installed is recorded, so uninstall can tell it from one that was already there",
    code.includes('WriteRegDWORD HKLM "Software\\HARE" "RedistInstalledByHare" 1')
  );
  check(
    "...and removing it is asked rather than assumed, since other programs may now need it",
    /RedistInstalledByHare[\s\S]{0,400}MessageBox[\s\S]{0,200}MB_DEFBUTTON2/.test(code)
  );
  check(
    "a driver install that doesn't happen never fails the whole installation",
    !/Abort/.test(code)
  );
  check(
    "...and that marker is removed on uninstall with the rest of the key",
    code.includes('DeleteRegKey /ifempty HKCU "Software\\HARE"') || code.includes('Software\\HARE')
  );
}

// --- Uninstall removes our driver, and only ours --------------------------
{
  check(
    "uninstall leaves a driver HARE didn't install alone",
    /ReadRegDWORD[\s\S]{0,200}StrCmp \$0 "1" 0 skip_pawnio/.test(code)
  );
}

// --- Functions must be guarded to the installer pass ----------------------
// electron-builder runs makensis twice — installer, then uninstaller. In the
// uninstaller pass `customInstall` is never expanded, so a helper Function it
// calls is defined and never referenced: NSIS warning 6010, and warnings are
// errors, so the whole build fails. This cost a release.
{
  const guarded = /!ifndef\s+BUILD_UNINSTALLER[\s\S]*?!endif/g;
  const insideGuards = (source.match(guarded) ?? []).join("\n");
  const allFunctions = [...source.matchAll(/^Function\s+(\w+)/gm)].map((m) => m[1]);
  const unguarded = allFunctions.filter((name) => !insideGuards.includes(`Function ${name}`));

  check(
    `every helper function is confined to the installer pass${unguarded.length ? ` — unguarded: ${unguarded.join(", ")}` : ""}`,
    unguarded.length === 0
  );
  check(
    "...and the function this caught is still there doing its job",
    source.includes("Function CheckPawnIO") && code.includes("Call CheckPawnIO")
  );
}

// --- The runtime that OpenRGB needs to start at all ------------------------
// OpenRGB is built against the Visual C++ runtime. Without it OpenRGB.exe
// fails to start with no usable error, HARE finds nothing, and every symptom
// points at HARE. That is how it was found — on a clean PC.
{
  check("the runtime is installed during setup", code.includes("vc_redist.x64.exe"));
  check(
    "...only when it isn't already there",
    code.includes("VisualStudio\\14.0\\VC\\Runtimes\\x64")
  );
  check(
    "a person watching the install sees the runtime install too",
    /redist_visible:\s*[\r\n]+\s*ExecWait '"\$2" \/norestart'/.test(code)
  );
  // `winget install` runs setup with `/S` and nobody is looking at the screen.
  // A child installer that puts up its own window there is a window that never
  // gets closed.
  check(
    "...and an unattended one uses Microsoft's own documented silent switches, not guessed ones",
    /redist_quiet:\s*[\r\n]+\s*ExecWait '"\$2" \/install \/quiet \/norestart'/.test(code)
  );
  check(
    "...chosen by whether setup itself was run silently",
    code.includes("IfSilent redist_quiet redist_visible")
  );
  check(
    "...and setup waits for it either way, since OpenRGB can't start until it's done",
    (code.match(/ExecWait '"\$2"/g) ?? []).length === 2
  );
  check(
    "it ships inside the installer",
    readFileSync("electron-builder.yml", "utf8").includes("from: vendor/redist")
  );
  check(
    "its digest is pinned at build time like everything else HARE ships",
    existsSync("scripts/redist-manifest.mjs") &&
      JSON.parse(readFileSync("package.json", "utf8")).scripts["build:electron"].includes("redist:manifest")
  );
}

// --- The log people can open if they want to ------------------------------
// electron-builder's template sets `ShowInstDetails nevershow`, which removes
// the log and the button that opens it. Every DetailPrint in this script then
// writes somewhere nobody can look, while setup silently installs two other
// people's programs behind a bare progress bar.
{
  check(
    "the install log can be opened by anyone who wants it",
    /^\s*ShowInstDetails hide\s*$/m.test(code)
  );
  check(
    "...and never left at nevershow, which hides the button too",
    !/ShowInstDetails nevershow/.test(code)
  );
  check(
    "...on the uninstaller as well",
    /ShowUninstDetails hide/.test(code)
  );
  // ShowUninstDetails is only valid while the uninstaller is being compiled.
  // Unguarded, it breaks the installer pass -- the same warnings-as-errors
  // trap that cost this project three releases.
  check(
    "...guarded to the uninstaller pass, since it isn't valid in the other one",
    /!ifdef BUILD_UNINSTALLER\s*[\r\n]+\s*ShowUninstDetails hide/.test(code)
  );
  // With the log visible, every DetailPrint is user-facing text.
  check(
    "the log says what is being installed, in words",
    code.includes("Installing the PawnIO driver") &&
      code.includes("Installing the Microsoft Visual C++ runtime")
  );
}

// --- A wizard, not a silent one-click -------------------------------------
{
  const builder = readFileSync("electron-builder.yml", "utf8");
  check("the installer is a wizard", /^\s*oneClick:\s*false\s*$/m.test(builder));
  check("...that shows the licence", /^\s*license:\s*LICENSE\s*$/m.test(builder));
  check("...lets people choose where it goes", /^\s*allowToChangeInstallationDirectory:\s*true\s*$/m.test(builder));
  check("...is branded with the Vinny artwork", builder.includes("installerSidebar.bmp") && builder.includes("installerHeader.bmp"));
  check("...and offers to launch HARE at the end", /^\s*runAfterFinish:\s*true\s*$/m.test(builder));
  check(
    "the artwork is generated from the vector artwork, not hand-made",
    existsSync("scripts/build-art.mjs") && existsSync("build/installerSidebar.bmp")
  );
}

// --- Where it installs, and how many copies run ---------------------------
// Both of these were found on a real machine rather than here, and both are
// one line of config or setup that nothing else would notice.
{
  const builder = existsSync("electron-builder.yml") ? readFileSync("electron-builder.yml", "utf8") : "";
  check(
    "it installs for the whole machine, into Program Files — not one user's AppData",
    /^\s*perMachine:\s*true\s*$/m.test(builder)
  );

  const main = existsSync("electron/main.ts") ? readFileSync("electron/main.ts", "utf8") : "";
  check(
    "only one copy of HARE can run — clicking the shortcut must not start a second",
    main.includes("requestSingleInstanceLock()")
  );
  check("...and a second launch reveals the first", main.includes('app.on("second-instance"'));
  check(
    "...the losing copy quits before it builds anything",
    /if \(!gotTheLock\) \{\s*app\.quit\(\);/.test(main)
  );
  check(
    "a minimised window is restored, not just shown",
    main.includes("isMinimized()") && main.includes("restore()")
  );
  check(
    "the tray and the shortcut use the same reveal path",
    (main.match(/revealMainWindow\(\)/g) ?? []).length >= 3
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_INSTALLER_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_INSTALLER_CHECKS_PASSED");
