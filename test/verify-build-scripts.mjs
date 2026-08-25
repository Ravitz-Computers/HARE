// The scripts Windows runs, checked before Windows runs them.
//
// WHY THIS EXISTS
//
// One em dash. `build.ps1` had exactly one non-ASCII character, inside a
// message string, and the whole build failed to parse on a real PC:
//
//   Unexpected token 'check' in expression or statement.
//   The string is missing the terminator: ".
//   The Try statement is missing its Catch or Finally block.
//
// PowerShell 5.1 — still the default on Windows 10 and 11 — reads a .ps1 as
// the system ANSI code page unless the file begins with a byte-order mark.
// A UTF-8 em dash is three bytes, which arrive as three mojibake characters,
// one of which ended the string early and took the rest of the file with it.
// Nothing in this project could see that: the file is valid UTF-8, valid
// PowerShell, and reads perfectly everywhere except the one place it runs.
//
// So: these files are ASCII-only, the PowerShell carries a BOM, and — where
// pwsh exists — the script is actually parsed rather than merely inspected.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

console.log("Build scripts...\n");

/** Every file Windows itself parses, rather than Node. */
const WINDOWS_SCRIPTS = ["scripts/build.ps1", "build.bat", "build/installer.nsh"];

/**
 * Everything whose output lands in build.log.
 *
 * A Windows console renders bytes by its own code page, not as UTF-8, so an
 * em dash printed by a Node script arrives in the transcript as a run of
 * mojibake. It doesn't break anything, but a build log full of `ΓÇö` reads as
 * a broken build, and this is the log people are asked to send when something
 * goes wrong.
 */
const BUILD_TIME_SCRIPTS = [
  "scripts/build-art.mjs",
  "scripts/build-preload.mjs",
  "scripts/build-stamp.mjs",
  "scripts/generate-notices.mjs",
  "scripts/module-manifest.mjs",
  "scripts/openrgb-manifest.mjs",
  "scripts/package-win.mjs",
  "scripts/pawnio-manifest.mjs",
  "scripts/redist-manifest.mjs",
  "scripts/signing.mjs",
  "scripts/stage-openrgb.mjs",
  "scripts/verify-bundle.mjs",
  "test/verify-builder-config.mjs",
];

// --- ASCII only -------------------------------------------------------------
for (const file of [...WINDOWS_SCRIPTS, ...BUILD_TIME_SCRIPTS]) {
  const bytes = readFileSync(file);
  // Node keeps a BOM as U+FEFF when decoding, and the BOM is the one
  // non-ASCII byte sequence that's meant to be there.
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const offenders = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const ch of line) {
      if (ch.charCodeAt(0) > 127) offenders.push(`line ${index + 1}: ${JSON.stringify(ch)}`);
    }
  });
  check(
    `${file} is ASCII only${offenders.length ? ` — ${offenders.slice(0, 5).join(", ")}` : ""}`,
    offenders.length === 0
  );
}

// --- The BOM that makes PowerShell read it as UTF-8 -------------------------
{
  const bytes = readFileSync("scripts/build.ps1");
  check(
    "build.ps1 starts with a UTF-8 BOM, so PowerShell 5.1 doesn't read it as ANSI",
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  );
}

// --- Actually parse it, where that's possible -------------------------------
// A syntax check beats any amount of pattern matching, and every machine that
// builds HARE has PowerShell by definition.
{
  let pwsh = null;
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
      pwsh = candidate;
      break;
    } catch {
      // Not on this machine; fall through to the next.
    }
  }

  if (!pwsh) {
    console.log("  --  no PowerShell here, so the parse check is skipped (it runs in CI on Windows)");
  } else {
    const script = `
      $errors = $null
      $tokens = $null
      [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path ${JSON.stringify(path.resolve("scripts/build.ps1"))}).Path,
        [ref]$tokens, [ref]$errors) | Out-Null
      if ($errors.Count -gt 0) {
        $errors | ForEach-Object { Write-Output "line $($_.Extent.StartLineNumber): $($_.Message)" }
        exit 1
      }
      exit 0
    `;
    let parsed = true;
    let detail = "";
    try {
      execFileSync(pwsh, ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      parsed = false;
      detail = ` — ${String(err.stdout ?? "").trim().split("\n")[0]}`;
    }
    check(`build.ps1 parses as PowerShell${detail}`, parsed);
  }
}

// --- The build still does what build.bat promises ---------------------------
{
  const ps = readFileSync("scripts/build.ps1", "utf8");
  check("it still produces an installer rather than only installing", ps.includes("Your installer is ready"));
  check("...and refuses one that's too small to hold the payloads", /\$installer\.Length -lt \d+MB/.test(ps));

  const bat = readFileSync("build.bat", "utf8");
  check("build.bat runs the script it says it does", bat.includes("scripts\\build.ps1"));
  check("...and points at the log when something fails", bat.includes("build.log"));
}

// --- A native module must not be able to stop the build --------------------
// `sharp` draws the icons and runs on every build. It's a native module with
// a postinstall step, so it can fail to install behind a proxy, on an
// unusual platform, or when a postinstall is blocked -- and the artwork it
// draws is already committed. Losing the ability to build HARE at all over an
// icon that is already correct would be absurd; shipping a stale icon
// silently would be worse.
{
  const art = readFileSync("scripts/build-art.mjs", "utf8");
  check("the artwork script imports sharp in a way it can recover from", art.includes('await import("sharp")'));
  check(
    "...continuing with the committed artwork when it's absent",
    /missing\.length === 0[\s\S]{0,400}process\.exit\(0\)/.test(art)
  );
  check(
    "...and failing when there is no committed artwork to fall back on",
    /missing\.length === 0[\s\S]{0,900}process\.exit\(1\)/.test(art)
  );
  check(
    "...saying so loudly rather than silently, since a stale icon would ship",
    /Couldn't load `sharp`/.test(art)
  );
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  check("sharp is declared, so a normal install has it", !!pkg.devDependencies?.sharp);
}

// --- The NSIS script's own escaping ----------------------------------------
// Covered in depth by verify-installer-script.mjs; this is just the file-level
// half — that nothing non-ASCII creeps into a file makensis also reads by
// code page.
{
  check("the NSIS include exists", existsSync("build/installer.nsh"));
}

console.log("");
if (failures > 0) {
  console.error(`ALL_BUILD_SCRIPT_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_BUILD_SCRIPT_CHECKS_PASSED");
