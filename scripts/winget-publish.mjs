#!/usr/bin/env node
// Publishes HARE to the Windows Package Manager.
//
//   npm run winget -- --version 1.0.0-beta.2
//   npm run winget -- --version 1.0.0-beta.2 --submit
//   npm run winget -- --dry-run
//
// WHAT THIS DOES
//
// Builds the three manifest files winget wants (version, installer, locale),
// fills them in from package.json and the GitHub release, computes the
// installer's SHA-256 from the real published bytes, and -- with --submit --
// hands them to `wingetcreate` to open a pull request against
// microsoft/winget-pkgs.
//
// WHY IT IS A SCRIPT AND NOT A DOCUMENT
//
// Three of the fields below are wrong by default and wrong in ways nobody
// notices until a stranger's unattended install misbehaves:
//
//   - **The silent switch.** winget installs with no window. HARE's installer
//     is a wizard, so it needs `/S`, and the manifest has to say so or winget
//     shows the wizard to somebody who typed `winget install` and walked away.
//   - **The hash.** It must be of the exact bytes on the release page, not of
//     a local build. A hash of the wrong file passes validation locally and
//     fails in the pipeline hours later.
//   - **The scope.** HARE installs per-machine. Saying otherwise makes winget
//     offer it to a standard user, where it cannot work.
//
// Each of those is derived here rather than typed.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/**
 * The package identifier in the community repository.
 *
 * `Publisher.Package`. Reviewers expect the publisher half to be recognisable
 * as the publisher, and "RC" is an abbreviation only Ravitz Computers would
 * read that way -- see winget/README.md, which says what to do if a reviewer
 * asks for the longer form.
 */
const IDENTIFIER = process.env.HARE_WINGET_ID ?? "RC.HareRGB";

/** Where the installer is published. GitHub release assets are a stable URL, which winget requires. */
const REPO = "Ravitz-Computers/HARE";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const version = value("version", pkg.version);
const dryRun = flag("dry-run");
const submit = flag("submit");
const outDir = path.join(root, "winget", "generated", version);

/** The tag a release is published under. `v` + the version, which is what the release workflow uses. */
const tag = value("tag", `v${version}`);
const installerName = `HARE-Setup-${version}.exe`;
const installerUrl =
  value("url") ?? `https://github.com/${REPO}/releases/download/${tag}/${installerName}`;

function fail(message, ...rest) {
  console.error("");
  console.error(`  ${message}`);
  for (const line of rest) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

/**
 * The hash winget will check, taken from the bytes that are actually
 * published.
 *
 * Deliberately not from `release/` on this machine. A local build is a
 * different file -- different timestamps, and a different signature once
 * signing is on -- so a hash taken from it passes every check here and fails
 * in Microsoft's pipeline hours later, on a pull request with your name on it.
 */
async function hashPublishedInstaller(url) {
  console.log(`  Downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    fail(
      `The installer isn't at that URL (HTTP ${res.status}).`,
      "winget needs a published release, not a draft -- its validation downloads this file.",
      `Check that ${tag} exists at https://github.com/${REPO}/releases and that ${installerName} is attached to it.`
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 50_000_000) {
    fail(
      `That file is only ${(bytes.length / 1_048_576).toFixed(1)} MB.`,
      "A complete HARE installer carries OpenRGB, the Visual C++ runtime and the driver, and is far larger.",
      "Something was left out of the build -- see scripts/verify-bundle.mjs."
    );
  }
  return {
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    bytes: bytes.length,
  };
}

/** Every manifest carries the same schema version, and it has to be a real one. */
const MANIFEST_SCHEMA = "1.6.0";

function versionManifest() {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${MANIFEST_SCHEMA}.schema.json
PackageIdentifier: ${IDENTIFIER}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${MANIFEST_SCHEMA}
`;
}

function installerManifest(sha256) {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${MANIFEST_SCHEMA}.schema.json
PackageIdentifier: ${IDENTIFIER}
PackageVersion: ${version}
MinimumOSVersion: 10.0.17763.0
InstallerType: nullsoft
# HARE installs into Program Files for every account on the PC, and asks for
# administrator rights once while it does. Saying anything else here makes
# winget offer it to a standard user, where it cannot work.
Scope: machine
InstallModes:
  - interactive
  - silent
  - silentWithProgress
InstallerSwitches:
  # The installer is a wizard, not a one-click. Without these winget puts that
  # wizard in front of somebody who typed \`winget install\` and walked away.
  Silent: /S
  SilentWithProgress: /S
# The uninstaller is registered by the installer itself, so winget finds it
# through Add/Remove Programs rather than needing a product code here.
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: ${installerUrl}
    InstallerSha256: ${sha256}
ManifestType: installer
ManifestVersion: ${MANIFEST_SCHEMA}
`;
}

function localeManifest() {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${MANIFEST_SCHEMA}.schema.json
PackageIdentifier: ${IDENTIFIER}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: ${pkg.author.name}
PublisherUrl: ${pkg.author.url}
PublisherSupportUrl: https://github.com/${REPO}/issues
PackageName: HARE
PackageUrl: https://github.com/${REPO}
License: MIT
LicenseUrl: https://github.com/${REPO}/blob/main/LICENSE
Copyright: Copyright (c) Ravitz Computers
CopyrightUrl: https://github.com/${REPO}/blob/main/LICENSE
ShortDescription: One app for every RGB light in your PC.
Description: |-
  HARE (Hardware Adaptive RGB Engine) controls the RGB lighting on your
  keyboard, mouse, motherboard, memory, fans and cooler from one place,
  instead of four vendor apps that each want to own your machine.

  It drives OpenRGB, which speaks the native protocol for well over a
  thousand RGB products, and ships it inside the installer along with the
  Visual C++ runtime it needs -- so there is nothing else to download.

  Effects run across every device at once or stack as layers on one. Looks
  can be saved, applied anywhere and shared as files. A spare monitor becomes
  a touch control panel, and a cooler's screen can show a live temperature.

  Note: motherboard and memory lighting needs the PawnIO driver, which an
  unattended install deliberately skips. Install it from Settings > Hardware
  after the first launch -- one click, one prompt.
Moniker: hare
Tags:
  - rgb
  - lighting
  - openrgb
  - led
  - gaming
  - pc
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/${tag}
Documentations:
  - DocumentLabel: What works and what doesn't
    DocumentUrl: https://github.com/${REPO}/blob/main/docs/STATUS.md
ManifestType: defaultLocale
ManifestVersion: ${MANIFEST_SCHEMA}
`;
}

function checkPrerequisites() {
  const problems = [];
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    problems.push(`"${version}" isn't a version winget will accept.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9][A-Za-z0-9.-]*$/.test(IDENTIFIER)) {
    problems.push(`"${IDENTIFIER}" isn't a valid PackageIdentifier -- it must be Publisher.Package.`);
  }
  if (submit && !process.env.HARE_WINGET_TOKEN && !process.env.GITHUB_TOKEN) {
    problems.push(
      "Submitting needs a GitHub token in HARE_WINGET_TOKEN (a classic PAT with public_repo)."
    );
  }
  if (problems.length) fail("Can't publish to winget yet:", ...problems);
}

async function main() {
  console.log("");
  console.log(`  Package:   ${IDENTIFIER}`);
  console.log(`  Version:   ${version}`);
  console.log(`  Installer: ${installerUrl}`);
  console.log("");

  checkPrerequisites();

  const { sha256, bytes } = await hashPublishedInstaller(installerUrl);
  console.log(`  SHA-256:   ${sha256}`);
  console.log(`  Size:      ${(bytes / 1_048_576).toFixed(1)} MB`);

  mkdirSync(outDir, { recursive: true });
  const files = {
    [`${IDENTIFIER}.yaml`]: versionManifest(),
    [`${IDENTIFIER}.installer.yaml`]: installerManifest(sha256),
    [`${IDENTIFIER}.locale.en-US.yaml`]: localeManifest(),
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(outDir, name), content, "utf8");
    console.log(`  Wrote      winget/generated/${version}/${name}`);
  }

  if (dryRun) {
    console.log("");
    console.log("  Dry run -- nothing was submitted. Validate them with:");
    console.log(`    winget validate --manifest ${path.relative(root, outDir)}`);
    console.log("");
    return;
  }

  if (!submit) {
    console.log("");
    console.log("  Manifests written. To check them on a Windows machine:");
    console.log(`    winget validate --manifest ${path.relative(root, outDir)}`);
    console.log(`    winget install --manifest ${path.relative(root, outDir)}`);
    console.log("");
    console.log("  Then run this again with --submit to open the pull request.");
    console.log("");
    return;
  }

  submitWithWingetCreate();
}

/**
 * Hands the manifests to wingetcreate, which opens the pull request.
 *
 * `wingetcreate` is Microsoft's own tool and is what the community repository
 * expects: it forks winget-pkgs for you, puts the files in the right place in
 * the tree, and opens the PR. Doing that by hand means getting a four-level
 * directory path exactly right for no benefit.
 */
function submitWithWingetCreate() {
  const token = process.env.HARE_WINGET_TOKEN ?? process.env.GITHUB_TOKEN;
  const exists = spawnSync("wingetcreate", ["--version"], { stdio: "ignore", shell: true });
  if (exists.status !== 0) {
    fail(
      "wingetcreate isn't installed on this machine.",
      "It only runs on Windows. Install it with:",
      "    winget install Microsoft.WingetCreate"
    );
  }

  // `submit` takes finished manifests and opens the pull request, for a brand
  // new package as readily as for a new version of an existing one. (The
  // winget-releaser Action, which would otherwise do this from CI, only
  // handles packages that are already in the repository -- see
  // winget/README.md.)
  const command = ["submit", outDir, "--token", token];
  console.log("");
  console.log("  Submitting to microsoft/winget-pkgs...");
  const result = spawnSync("wingetcreate", command, { stdio: "inherit", shell: true, cwd: root });
  if (result.status !== 0) {
    fail("wingetcreate couldn't submit the pull request. Its output is above.");
  }
  console.log("");
  console.log("  Submitted. Microsoft's validation pipeline will install HARE in a sandbox and");
  console.log("  comment on the pull request. An unsigned installer usually gets a manual review.");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
