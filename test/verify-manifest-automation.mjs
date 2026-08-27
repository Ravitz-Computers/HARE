// Guards the property that makes the download-verification system trustworthy
// over time: **no digest is ever written by a human.**
//
// The verified-download layer is only as good as the hashes it checks against.
// The tempting shortcut — paste a hash into the source — creates a step
// someone must remember on every release, forever. When they forget, the
// failure isn't loud: it's a stale hash that breaks updates, or worse, a
// placeholder that makes a disabled check look like an enabled one.
//
// So the hashes are generated from the real bytes at build time, and these
// checks make sure it stays that way. They are static analysis of the repo
// rather than behavioural tests, because the thing being protected is a
// property of how the code is maintained, not of what it does at runtime.
import { readFileSync, existsSync } from "node:fs";
import { APPROVED_OPENRGB_BUILDS } from "../dist-electron/backend/generated/openrgbBuilds.js";
import { APPROVED_MODULES } from "../dist-electron/backend/generated/moduleBuilds.js";
import { APPROVED_PAWNIO_BUILDS } from "../dist-electron/backend/generated/pawnIoBuild.js";

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

console.log("Manifest automation...\n");

const manifestSrc = read("electron/backend/generated/openrgbBuilds.ts");
const dbSrc = read("electron/backend/deviceDatabase.ts");
const pkg = JSON.parse(read("package.json"));

// --- The manifest is generated, and says so ---------------------------------
{
  check("a generated manifest exists", manifestSrc.length > 0);
  check("it is marked as generated so nobody edits it by hand", /GENERATED FILE\s*(—|--)\s*DO NOT EDIT/i.test(manifestSrc));
  check("it names the script that produces it", manifestSrc.includes("scripts/openrgb-manifest.mjs"));
  check("the generator exists", existsSync("scripts/openrgb-manifest.mjs"));
}

// --- Regeneration is wired into the build, not left to memory --------------
// This is the check that actually enforces "automated". Without it, the
// generator is just a script someone could forget to run.
{
  check(
    "every build regenerates the manifest",
    (pkg.scripts["build:electron"] ?? "").includes("openrgb:manifest")
  );
  check("there is a one-command way to approve a newer OpenRGB", !!pkg.scripts["openrgb:sync"]);
  check("there is a CI-friendly check mode", !!pkg.scripts["openrgb:check"]);
}

// --- No hand-written digests anywhere --------------------------------------
{
  // A 64-hex literal in hand-maintained backend source would mean somebody
  // pasted a hash in. The generated file is the only place one belongs.
  const handWritten = [
    "electron/backend/deviceDatabase.ts",
    "electron/backend/verifiedDownload.ts",
  ].filter((f) => /["'][0-9a-f]{64}["']/i.test(read(f)));
  check(
    `no hand-written SHA-256 in the backend source${handWritten.length ? ` — found in ${handWritten.join(", ")}` : ""}`,
    handWritten.length === 0
  );

  // The specific trap: an all-zero placeholder reads as "verification is on"
  // while doing nothing. It must never exist anywhere.
  const zeros = "0".repeat(64);
  const placeholders = [
    "electron/backend/deviceDatabase.ts",
    "electron/backend/generated/openrgbBuilds.ts",
    "scripts/openrgb-builds.json",
  ].filter((f) => read(f).includes(zeros));
  check(
    `no placeholder digest anywhere${placeholders.length ? ` — found in ${placeholders.join(", ")}` : ""}`,
    placeholders.length === 0
  );
}

// --- The config a human does touch holds no digests ------------------------
// Approving a version is a real decision and stays human. Computing its hash
// is not, and must not be.
{
  const config = read("scripts/openrgb-builds.json");
  if (config) {
    const parsed = JSON.parse(config);
    check(
      "the human-edited config carries versions and URLs only, never digests",
      (parsed.builds ?? []).every((b) => !("sha256" in b) && !("bytes" in b))
    );
    check(
      "...and every configured URL is HTTPS",
      (parsed.builds ?? []).every((b) => String(b.url).startsWith("https://"))
    );
  }
}

// --- Every entry that IS in the manifest is fully specified ----------------
{
  check(
    "every approved build carries a real 64-hex digest",
    APPROVED_OPENRGB_BUILDS.every((b) => /^[0-9a-f]{64}$/.test(b.sha256))
  );
  check(
    "every approved build carries an exact byte length",
    APPROVED_OPENRGB_BUILDS.every((b) => Number.isInteger(b.bytes) && b.bytes > 0)
  );
  check(
    "no approved build uses a placeholder digest",
    APPROVED_OPENRGB_BUILDS.every((b) => b.sha256 !== "0".repeat(64))
  );
  console.log(`  (this build ships ${APPROVED_OPENRGB_BUILDS.length} approved OpenRGB build(s))`);
}

// --- An empty manifest is safe, not broken ---------------------------------
// A machine that can't reach the release host at build time produces an empty
// manifest. That must mean "no automatic updates", never "install anything".
{
  check(
    "auto-update is reported unavailable when nothing is verified",
    dbSrc.includes("APPROVED_OPENRGB_BUILDS.length > 0")
  );
  check(
    "an unapproved version is refused outright",
    dbSrc.includes("isn't a build HARE has verified yet")
  );
  check(
    "the updater resolves what to install from the manifest, not the API",
    dbSrc.includes("approvedBuildFor(this.latestVersionTag)") && !dbSrc.includes("browser_download_url")
  );
}

// --- Modules follow exactly the same rule ---------------------------------
// Modules are native code loaded into HARE's own process, so an unverified
// module download would be worse than an unverified OpenRGB one.
{
  const moduleManifest = read("electron/backend/generated/moduleBuilds.ts");
  check("a generated module manifest exists", moduleManifest.length > 0);
  check("it is marked as generated", /GENERATED FILE\s*(—|--)\s*DO NOT EDIT/i.test(moduleManifest));
  check("every build regenerates it too", (pkg.scripts["build:electron"] ?? "").includes("modules:manifest"));
  check("there is a CI check mode for it", !!pkg.scripts["modules:check"]);
  check(
    "every approved module carries a real digest",
    APPROVED_MODULES.every((m) => /^[0-9a-f]{64}$/.test(m.sha256))
  );
  check(
    "no module uses a placeholder digest",
    APPROVED_MODULES.every((m) => m.sha256 !== "0".repeat(64))
  );
  const modConfig = read("scripts/modules.json");
  if (modConfig) {
    const parsed = JSON.parse(modConfig);
    check(
      "the human-edited module config carries no digests",
      (parsed.modules ?? []).every((m) => !("sha256" in m))
    );
  }
  check(
    "modules install through the verified download path",
    read("electron/backend/modules/moduleManager.ts").includes("downloadVerified")
  );
  check(
    "module archives get the same symlink-escape guard as OpenRGB",
    read("electron/backend/modules/moduleManager.ts").includes("assertNoSymlinkEscapes")
  );
  console.log(`  (this build ships ${APPROVED_MODULES.length} downloadable module(s))`);
}

// --- The kernel driver installer follows the same rule, most of all -------
// This artifact installs a driver into ring 0. A hand-written or missing
// digest here would be the single most dangerous version of this mistake.
{
  const manifest = read("electron/backend/generated/pawnIoBuild.ts");
  check("a generated PawnIO manifest exists", manifest.length > 0);
  check("it is marked as generated", /GENERATED FILE\s*(—|--)\s*DO NOT EDIT/i.test(manifest));
  check("the generator exists", existsSync("scripts/pawnio-manifest.mjs"));
  check("every build regenerates it", (pkg.scripts["build:electron"] ?? "").includes("pawnio:manifest"));
  check("there is a CI check mode for it", !!pkg.scripts["pawnio:check"]);
  check(
    "every approved installer carries a real digest",
    APPROVED_PAWNIO_BUILDS.every((b) => /^[0-9a-f]{64}$/.test(b.sha256))
  );
  check(
    "no approved installer uses a placeholder digest",
    APPROVED_PAWNIO_BUILDS.every((b) => b.sha256 !== "0".repeat(64))
  );

  const config = read("scripts/pawnio.json");
  if (config) {
    const parsed = JSON.parse(config);
    check(
      "the human-edited config carries versions and URLs only",
      (parsed.builds ?? []).every((b) => !("sha256" in b) && !("bytes" in b))
    );
    check("...and every configured URL is HTTPS", (parsed.builds ?? []).every((b) => String(b.url).startsWith("https://")));
  }

  const installer = read("electron/backend/pawnIoInstaller.ts");
  check("the installer downloads through the verified path", installer.includes("downloadVerified"));
  check(
    "...but prefers the copy bundled with HARE, so nobody is sent to a website",
    installer.includes("bundledInstallerPath")
  );
  check(
    "the bundled copy ships in the installer",
    read("electron-builder.yml").includes("from: vendor/pawnio")
  );
  check(
    "the bundled copy is digest-verified at build time, not trusted at runtime",
    read("scripts/pawnio-manifest.mjs").includes("BUNDLE_DIR") &&
      /createHash\("sha256"\)[\s\S]{0,400}BUNDLE_DIR/.test(read("scripts/pawnio-manifest.mjs"))
  );
  check(
    "its version is resolved rather than hand-written",
    read("scripts/pawnio-manifest.mjs").includes("RELEASES_API") && !/"url":\s*"https/.test(read("scripts/pawnio.json"))
  );
  check(
    "redistributing it is acknowledged in the licensing notes",
    /HARE now ships the installer/.test(read("LICENSE-NOTES.md")) &&
      read("THIRD-PARTY-NOTICES.md").includes("PawnIO.Setup")
  );
  check(
    "an unverified build means no install, not an unchecked download",
    installer.includes("APPROVED_PAWNIO_BUILDS") && /doesn't carry a verified PawnIO installer/.test(installer)
  );
  check("it runs elevated and visibly rather than silently", installer.includes("runElevated"));
  check("the downloaded installer isn't left behind", installer.includes("fs.rm"));
  console.log(`  (this build ships ${APPROVED_PAWNIO_BUILDS.length} approved PawnIO installer(s))`);
}

// --- Every build is identifiable ------------------------------------------
// Every build called itself "HARE 0.1.0", so a diagnostic log couldn't say
// which code produced it — and one arrived showing a bug that had already
// been fixed, with no way to tell whether the fix was even in that build.
{
  const stamp = read("electron/backend/generated/buildStamp.ts");
  check("a build stamp is generated", stamp.length > 0);
  check("...and marked as generated", /GENERATED FILE\s*(—|--)\s*DO NOT EDIT/i.test(stamp));
  check("...from the source, not by hand", existsSync("scripts/build-stamp.mjs"));
  check("every build regenerates it", (pkg.scripts["build:electron"] ?? "").includes("build-stamp.mjs"));
  check("it is a real fingerprint", /BUILD_STAMP = "[0-9a-f]{8}"/.test(stamp));
  check(
    "the log records it, so a log can be traced to its build",
    read("electron/main.ts").includes("build ${BUILD_STAMP}")
  );
  check(
    "...and About shows it without needing logging on",
    read("src/pages/settingsHelp.tsx").includes("BUILD_STAMP")
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_MANIFEST_AUTOMATION_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_MANIFEST_AUTOMATION_CHECKS_PASSED");
