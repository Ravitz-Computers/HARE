// The promise that HARE is one file.
//
// WHY THIS EXISTS
//
// "I download an executable and it installs nicely" is the whole bar, and
// HARE kept missing it in a specific way: the build produced an installer
// whether or not the things that installer is supposed to contain had
// actually been fetched. A failed download printed one grey line, the build
// carried on, and the .exe that came out installed perfectly and then found
// no hardware — which is indistinguishable, from the outside, from HARE
// being broken.
//
// So the guarantee isn't "the payloads are present" (nothing here can
// download them). It's that the build **cannot produce an installer without
// them**, and that the one file, once built, needs nothing else.
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

console.log("One installer, complete...\n");

// --- The gate exists and is wired into the packaging step ------------------
{
  const gate = read("scripts/verify-bundle.mjs");
  check("there is a check that the payloads are present", gate.length > 0);
  for (const [what, needle] of [
    ["OpenRGB", "vendor/openrgb/OpenRGB.exe"],
    ["the Visual C++ runtime", "vendor/redist/vc_redist.x64.exe"],
    ["the PawnIO driver", "vendor/pawnio/PawnIO-Setup.exe"],
    ["the licence texts", '"LICENSE"'],
  ]) {
    check(`...covering ${what}`, gate.includes(needle));
  }
  check(
    "...and it fails the build rather than warning",
    /process\.exit\(1\)/.test(gate) && !/allow-incomplete[\s\S]{0,80}default/.test(gate)
  );

  // Packaging is a script rather than a chain of npm commands, so the order
  // is asserted where the order actually lives.
  const packager = read("scripts/package-win.mjs");
  check(
    "package:win goes through that script rather than calling electron-builder directly",
    JSON.parse(readFileSync("package.json", "utf8")).scripts["package:win"].includes("package-win.mjs")
  );
  check(
    "packaging runs the check before electron-builder, not after",
    packager.indexOf('"verify:bundle"') > 0 &&
      packager.indexOf('"verify:bundle"') < packager.indexOf('"electron-builder"')
  );
  check(
    "publishing is never left to electron-builder's CI guesswork",
    packager.includes('"--publish", "never"')
  );
  check(
    "...and validates electron-builder's own config before the slow part",
    packager.indexOf('"test:builder-config"') > 0 &&
      packager.indexOf('"test:builder-config"') < packager.indexOf('"build"')
  );
  check(
    "...and a file that's present but wasn't verified still counts as missing",
    gate.includes("manifestHasEntry") && gate.includes("APPROVED_PAWNIO_BUILDS")
  );
}

// --- Everything ships inside the one file ----------------------------------
{
  const builder = read("electron-builder.yml");
  for (const [what, needle] of [
    ["OpenRGB", "from: vendor/openrgb"],
    ["the driver", "from: vendor/pawnio"],
    ["the runtime", "from: vendor/redist"],
    ["the licences", "from: licenses"],
  ]) {
    check(`${what} is packed into the installer`, builder.includes(needle));
  }
  check("one target: a Windows installer", /target:\s*nsis/.test(builder));
  check("...named so it's obvious what it is", builder.includes("HARE-Setup-${version}.${ext}"));
}

// --- The payloads are fetched by the build, not by the person --------------
{
  const ps = read("scripts/build.ps1");
  check("the build downloads OpenRGB itself", ps.includes("function Resolve-OpenRgb"));
  check("...the driver", ps.includes("function Resolve-PawnIo"));
  check("...and the runtime", ps.includes("function Resolve-Redist"));
  check(
    "downloads go through Windows' own HTTP stack, which is the one that works behind a proxy",
    ps.includes("Invoke-WebRequest") && ps.includes("function Get-Payload")
  );
  check(
    "a download that lands as an error page is rejected on size",
    ps.includes("MinimumBytes") && ps.includes("too small to be real")
  );

  for (const [what, script] of [
    ["the driver", "scripts/pawnio-manifest.mjs"],
    ["the runtime", "scripts/redist-manifest.mjs"],
  ]) {
    check(
      `${what} manifest hashes a copy the build already downloaded rather than fetching twice`,
      read(script).includes("function localBundle")
    );
  }
}

// --- The finished file is checked before anyone is told it's ready ---------
{
  const ps = read("scripts/build.ps1");
  check(
    "an installer too small to hold the payloads is treated as a failure",
    /\$installer\.Length -lt \d+MB/.test(ps)
  );
  check("the build says where the file is", ps.includes("Your installer is ready"));
  check(
    "...and doesn't silently install on the build machine",
    ps.includes("Install HARE on this PC now as well?")
  );
}

// --- The wizard reads like a product ---------------------------------------
{
  const nsh = read("build/installer.nsh");
  check("the installer pages are written, not left at the NSIS defaults", nsh.includes("!macro customHeader"));
  check("...the welcome page says what else is being installed", nsh.includes("MUI_WELCOMEPAGE_TEXT"));
  check("...the licence page explains the GPL parts", nsh.includes("MUI_LICENSEPAGE_TEXT_BOTTOM"));
  check("...the finish page says what to do next", nsh.includes("MUI_FINISHPAGE_TEXT"));
  check(
    "every redefinition is guarded, or a duplicate define fails the whole build",
    (nsh.match(/!ifdef MUI_/g) ?? []).length >= (nsh.match(/^\s*!define MUI_/gm) ?? []).length
  );
  check("it carries the Ravitz name", nsh.includes("BrandingText"));
}

// --- Uninstall removes the driver HARE installed ---------------------------
// The uninstaller has always read this marker. Nothing ever wrote it, so the
// branch it guards could never run.
{
  const nsh = read("build/installer.nsh");
  check(
    "installing the driver records that HARE was the one that did it",
    nsh.includes('WriteRegDWORD HKLM "Software\\HARE" "PawnIOInstalledByHare" 1')
  );
  check("...which is what the uninstaller checks", nsh.includes('ReadRegDWORD $0 HKLM "Software\\HARE" "PawnIOInstalledByHare"'));
}

console.log("");
if (failures > 0) {
  console.error(`ALL_SINGLE_INSTALLER_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_SINGLE_INSTALLER_CHECKS_PASSED");
