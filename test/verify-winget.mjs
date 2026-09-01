// Publishing to the Windows Package Manager, checked without publishing.
//
// WHY THIS EXISTS
//
// A winget submission fails in somebody else's pipeline, hours later, on a
// pull request with your name on it. There is no local run that catches it,
// because the three things that go wrong all look fine on the machine that
// built the package:
//
//   1. **The hash is of the wrong file.** A local `release/` build and the
//      published asset are different bytes -- timestamps differ, and the
//      signature differs once signing is on. Hashing the local one passes
//      every check here and fails validation there.
//   2. **The installer isn't silent.** `winget install` runs setup with no
//      window. HARE's setup launches two child installers, and either of them
//      putting up its own window means an install that never finishes with
//      nobody there to click anything.
//   3. **The scope is wrong.** HARE installs into Program Files for the whole
//      machine. A manifest that doesn't say so makes winget offer it to a
//      standard user, where it cannot work.
//
// So this reads the generator rather than a generated manifest: the manifests
// are produced per release and are not in the repository, but the code that
// produces them is.
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

console.log("winget publishing...\n");

const SCRIPT = "scripts/winget-publish.mjs";
const source = existsSync(SCRIPT) ? readFileSync(SCRIPT, "utf8") : "";
check("the publishing script exists", source.length > 0);

/** Comments explain the reasoning; only the code decides what gets published. */
const code = source
  .split(/\r?\n/)
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join("\n");

// --- 1. The hash comes from the published bytes ---------------------------
{
  check(
    "the installer is fetched over the network to be hashed",
    /fetch\(\s*url/.test(code) && code.includes("createHash(\"sha256\")")
  );
  check(
    "...from the release URL, never a local build",
    !/release[/\\]HARE-Setup/.test(code) && !/readFileSync\([^)]*release/.test(code)
  );
  check(
    "...and a URL that isn't there stops the run rather than shipping an empty hash",
    /res\.ok/.test(code) && /fail\(/.test(code)
  );
  check(
    "...as does a file too small to be a complete installer",
    /bytes\.length\s*<\s*50_000_000/.test(code)
  );
}

// --- 2. The installer runs unattended --------------------------------------
{
  check("the manifest declares the silent switch", /Silent:\s*\/S/.test(code));
  check("...and the one winget uses when it shows progress", /SilentWithProgress:\s*\/S/.test(code));
  check(
    "...and lists silent among the modes it supports",
    /InstallModes:[\s\S]{0,120}silent/.test(code)
  );

  // The manifest promising `/S` is worthless if setup then puts a child
  // installer's window on screen. These two live in the NSIS script, and this
  // is the only place that ties them to the promise made here.
  const nsh = existsSync("build/installer.nsh") ? readFileSync("build/installer.nsh", "utf8") : "";
  check(
    "a silent setup installs the Visual C++ runtime silently too",
    nsh.includes("IfSilent redist_quiet redist_visible") &&
      nsh.includes("/install /quiet /norestart")
  );
  check(
    "...and installs the driver silently too, with its publisher's own switch",
    nsh.includes(`ExecWait '"$1" -install -silent'`)
  );
  // The description is what someone reads before typing `winget install`. It
  // said for two versions that the driver was skipped and had to be installed
  // by hand; leaving that in after fixing it is its own kind of wrong.
  check(
    "...and the package description doesn't still say the driver is skipped",
    !/deliberately skips|unattended install .{0,40}skips/.test(source)
  );
}

// --- 3. What winget offers it as ------------------------------------------
{
  check("it is offered as a machine-wide install", /^Scope:\s*machine$/m.test(code));
  check(
    "...matching how the installer is actually built",
    existsSync("electron-builder.yml") &&
      /^\s*perMachine:\s*true\s*$/m.test(readFileSync("electron-builder.yml", "utf8"))
  );
  check("it is declared as the NSIS installer it is", /InstallerType:\s*nullsoft/.test(code));
  check("...for x64, which is the only thing HARE is built for", /Architecture:\s*x64/.test(code));
  check(
    "...on the Windows versions HARE supports",
    /MinimumOSVersion:\s*10\.0\.\d+/.test(code)
  );
}

// --- The three files winget wants, and one identity ------------------------
{
  check(
    "all three manifests are generated",
    /ManifestType:\s*version/.test(code) &&
      /ManifestType:\s*installer/.test(code) &&
      /ManifestType:\s*defaultLocale/.test(code)
  );
  const schemas = [...code.matchAll(/ManifestVersion:\s*\$\{MANIFEST_SCHEMA\}/g)];
  check("...all on one schema version, from one constant", schemas.length === 3);

  const ids = [...code.matchAll(/PackageIdentifier:\s*\$\{IDENTIFIER\}/g)];
  check("...all naming the same package, from one constant", ids.length === 3);
  check(
    "the identifier is Publisher.Package, which winget requires",
    /IDENTIFIER\s*=\s*process\.env\.HARE_WINGET_ID\s*\?\?\s*"[A-Za-z0-9-]+\.[A-Za-z0-9-]+"/.test(code)
  );
  check(
    "...and can be changed without editing the script, since a reviewer may ask for the longer form",
    code.includes("process.env.HARE_WINGET_ID")
  );

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  check(
    "the version comes from package.json rather than being typed",
    /value\("version",\s*pkg\.version\)/.test(code)
  );
  check(
    "the publisher comes from package.json rather than being typed",
    /Publisher:\s*\$\{pkg\.author\.name\}/.test(code) && pkg.author?.name === "Ravitz Computers"
  );
  check(
    "the licence in the manifest matches the one in the repository",
    /^License:\s*MIT$/m.test(code) && existsSync("LICENSE")
  );
}

// --- Submitting ------------------------------------------------------------
{
  check(
    "nothing is submitted unless --submit is passed",
    /if \(!submit\)/.test(code) && /submitWithWingetCreate\(\)/.test(code)
  );
  check("--dry-run stops before that too", /if \(dryRun\)/.test(code));
  check(
    "a missing token is reported before the download rather than after it",
    /HARE_WINGET_TOKEN/.test(code) && code.indexOf("checkPrerequisites()") < code.indexOf("hashPublishedInstaller(installerUrl)")
  );
  check(
    "...and says which kind of token, since a fine-grained one cannot fork winget-pkgs",
    /classic PAT with public_repo/.test(code)
  );
  check(
    "a missing wingetcreate is explained rather than crashing",
    /wingetcreate isn't installed/.test(source) && /winget install Microsoft\.WingetCreate/.test(source)
  );
  check(
    "generated manifests are not committed",
    existsSync(".gitignore") && readFileSync(".gitignore", "utf8").includes("winget/generated")
  );
  check("how to publish is written down", existsSync("winget/README.md"));
  check(
    "...and reachable from package.json",
    JSON.parse(readFileSync("package.json", "utf8")).scripts.winget === "node scripts/winget-publish.mjs"
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_WINGET_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_WINGET_CHECKS_PASSED");
