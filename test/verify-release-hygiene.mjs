// What a public release has to be true about itself.
//
// WHY THIS EXISTS
//
// Two different classes of mistake, both of which only show up after
// something has already been published and can't be taken back.
//
// The first is the footprint. HARE installs a kernel driver, writes to four
// places in the registry and creates a folder for another program — and the
// uninstaller's user-data removal silently did nothing for the entire life of
// the project, because a per-machine install runs the uninstaller with
// `SetShellVarContext all`, under which `$APPDATA` is C:\ProgramData rather
// than the user's Roaming folder. Every setting, saved look, log and installed
// module survived every uninstall, and the line that was supposed to remove
// them looked completely correct.
//
// The second is metadata: the wrong repository URL, a stale version, a licence
// obligation discharged by a link that doesn't discharge it.
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
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

console.log("Release hygiene...\n");

// --- Who made it, and where it lives ---------------------------------------
const REPO = "https://github.com/Ravitz-Computers/HARE";
const EMAIL = "avrumi@ravitzcomputers.com";
const SITE = "https://ravitzcomputers.com";

{
  check("the package names its author", pkg.author?.name === "Ravitz Computers");
  check("...with the address people can actually reach", pkg.author?.email === EMAIL);
  check("...and the company site", pkg.author?.url === SITE);
  check("it points at the repository", pkg.repository?.url?.startsWith(REPO));
  check("...and at where bugs go", pkg.bugs?.url === `${REPO}/issues`);
  check("it states its licence", pkg.license === "MIT");
  check(
    "it can't be published to npm by accident",
    pkg.private === true
  );

  const appInfo = read("src/lib/appInfo.ts");
  check("the app shows the same details", appInfo.includes(EMAIL) && appInfo.includes(SITE));
  check("...and the same repository", appInfo.includes(REPO));
  check(
    "the old repository URL is gone everywhere",
    !["README.md", "SIGNING.md", "src/lib/appInfo.ts", "LICENSE-NOTES.md"].some((f) =>
      /github\.com\/ravitzcomputers\/hare/i.test(read(f))
    )
  );
}

// --- The version, and what it's called out loud ----------------------------
{
  check("the version is a real semver pre-release", /^\d+\.\d+\.\d+-beta\.\d+$/.test(pkg.version));
  const appInfo = read("src/lib/appInfo.ts");
  check(
    "...and it is not typed out a second time anywhere",
    appInfo.includes('export { APP_VERSION }') && !/APP_VERSION = "/.test(appInfo)
  );
  check("...with a spoken name derived from it", appInfo.includes("export function releaseName"));

  // The one that would embarrass: a changelog that doesn't mention the
  // version being released, or that still calls an older one the newest.
  const changelog = read("CHANGELOG.md");
  check(`the changelog covers ${pkg.version}`, changelog.includes(pkg.version));
  check(
    "...and that version is the entry at the top",
    (changelog.match(/^## .+$/m) ?? [""])[0].includes(pkg.version)
  );
  // Every place a person reads the version has to agree with package.json.
  for (const [file, needle] of [
    ["README.md", `HARE-Setup-${pkg.version}.exe`],
    ["docs/STATUS.md", pkg.version],
    ["SIGNING.md", `HARE-Setup-${pkg.version}.exe`],
  ]) {
    check(`${file} names ${pkg.version}`, read(file).includes(needle));
  }
}

// --- Files a public repository is expected to have --------------------------
{
  for (const file of [
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "THIRD-PARTY-NOTICES.md",
    "LICENSE-NOTES.md",
    ".github/workflows/release.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".gitattributes",
    ".editorconfig",
    ".nvmrc",
    "docs/STATUS.md",
  ]) {
    check(`${file} exists`, existsSync(file));
  }
  check(
    "the README doesn't point at an image that isn't there",
    !/!\[[^\]]*\]\(screenshots\//.test(read("README.md")) || existsSync("screenshots")
  );
  check(
    "the security policy says where to send something exploitable",
    read("SECURITY.md").includes(EMAIL)
  );
  // A beta that only lists what works is marketing. The README points at the
  // page that says what doesn't, and that page has to actually cover all
  // four categories rather than quietly becoming a feature list.
  check("the README links to the honest status page", read("README.md").includes("docs/STATUS.md"));
  const status = read("docs/STATUS.md");
  for (const heading of ["Proven on real hardware", "never confirmed", "Known-degraded", "Not built"]) {
    check(`...which covers "${heading}"`, status.includes(heading));
  }
  check(
    "...and says the installer isn't signed, since that's what people will hit first",
    /unsigned|SmartScreen/i.test(status)
  );
}

// --- SignPath's attribution, in SignPath's words ---------------------------
// Approved projects have to carry this line, and the wording is theirs, not
// ours. A paraphrase is not attribution.
{
  const readme = read("README.md");
  check(
    "the README carries SignPath's required attribution verbatim",
    readme.includes(
      "Free code signing provided by [SignPath.io](https://signpath.io/), certificate by\n[SignPath Foundation](https://signpath.org/)."
    )
  );
  const policy = read("docs/CODE-SIGNING-POLICY.md");
  check("...and links to a code signing policy that exists", readme.includes("docs/CODE-SIGNING-POLICY.md") && policy.length > 0);
  for (const [what, needle] of [
    ["who approves a signing request", "Avrumi Ravitz"],
    ["that the key never leaves SignPath's HSM", "hardware security module"],
    ["that every request is approved by hand", "approved by hand"],
    ["how a release is built", ".github/workflows/release.yml"],
    ["what a person can verify", "gh attestation verify"],
  ]) {
    check(`the policy states ${what}`, policy.includes(needle));
  }
  check(
    "...and that nothing is collected, since that's the other question people ask",
    /no telemetry/i.test(policy)
  );
}

// --- Nothing that shouldn't be published ------------------------------------
{
  const ignore = read(".gitignore");
  for (const [what, pattern] of [
    ["the fetched payloads under vendor/", "vendor/*"],
    ["build output", "release"],
    ["the private Node copy", "tools/"],
    ["logs", "*.log"],
  ]) {
    check(`${what} is never committed`, ignore.includes(pattern));
  }
  check(
    "...but the note explaining vendor/openrgb still is",
    ignore.includes("!vendor/openrgb/README.md") && existsSync("vendor/openrgb/README.md")
  );
  check(
    "no absolute path from whoever's machine this was written on",
    !/\/home\/claude/.test(read("scripts/screenshot.mjs"))
  );
}

// --- The GPL obligation is actually discharged ------------------------------
// A link to upstream is not one of the three things GPL-2.0 section 3
// accepts. HARE redistributes two GPL binaries inside a public installer.
{
  const notes = read("LICENSE-NOTES.md");
  check("there is a written offer of source", /section 3\(b\)/i.test(notes));
  check("...naming an address to write to", notes.includes(EMAIL));
  check("...and standing for three years", /three years/i.test(notes));

  const workflow = read(".github/workflows/release.yml");
  check(
    "the matching source archive is attached to the release, not just linked",
    workflow.includes("OpenRGB-source-") && workflow.includes("release/OpenRGB-source-*.zip")
  );
  check(
    "...for the version that was actually staged, not one someone typed",
    workflow.includes("vendor/openrgb/version.txt")
  );
  check(
    "the notices carry the offer too",
    read("THIRD-PARTY-NOTICES.md").includes("written offer in LICENSE-NOTES.md")
  );
}

// --- The workflow can actually produce an installer -------------------------
// It regenerated the OpenRGB *manifest* and then packaged, with vendor/openrgb
// still empty — so the build correctly refused and a tagged release produced
// nothing at all.
{
  const workflow = read(".github/workflows/release.yml");
  check("CI stages OpenRGB before packaging", workflow.includes("openrgb:stage"));
  check("...and the driver and runtime", workflow.includes("pawnio:manifest") && workflow.includes("redist:manifest"));
  check("...in that order, before the build", /openrgb:stage[\s\S]*package:win/.test(workflow));
  check("a checksum is published with the installer", workflow.includes("SHA256SUMS.txt"));

  const stage = read("scripts/stage-openrgb.mjs");
  check("staging refuses anything that doesn't match the pinned digest", stage.includes("does not match its pinned digest"));
  check("...and flattens it so OpenRGB.exe lands where the app looks", stage.includes("findExeDir"));
}

console.log("");
if (failures > 0) {
  console.error(`ALL_RELEASE_HYGIENE_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_RELEASE_HYGIENE_CHECKS_PASSED");
