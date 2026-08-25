#!/usr/bin/env node
// Generates the list of OpenRGB builds HARE is allowed to install, with a
// real SHA-256 for each, computed from the actual bytes.
//
// WHY THIS SCRIPT EXISTS
//
// HARE downloads OpenRGB and then executes it, so it must only ever install
// bytes it can verify. That means every approved build needs a pinned digest.
//
// The obvious way to do that — write the hash into the source by hand — is a
// trap: it is a step someone has to remember on every release, forever, and
// the failure mode when they forget is either a broken updater or, far worse,
// a placeholder that quietly disables the check. So no hash is ever written
// by a human. This script computes them from the real artifact, and the build
// runs it.
//
// The safe default is absence: a build with no verified digest simply isn't
// in the manifest, and anything not in the manifest is never installed. There
// are no placeholders anywhere in this system, because a placeholder is a
// disabled security check that looks like an enabled one.
//
// USAGE
//
//   node scripts/openrgb-manifest.mjs            # regenerate from the cache
//   node scripts/openrgb-manifest.mjs --sync     # also fetch the latest release
//   node scripts/openrgb-manifest.mjs --check    # verify, don't write (CI)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(root, "scripts", "openrgb-builds.json");
const OUTPUT_PATH = path.join(root, "electron", "backend", "generated", "openrgbBuilds.ts");
const CACHE_DIR = path.join(root, "vendor", "openrgb-cache");

const RELEASES_API = "https://codeberg.org/api/v1/repos/OpenRGB/OpenRGB/releases/latest";

/** Mirrors ALLOWED_DOWNLOAD_HOSTS in electron/backend/verifiedDownload.ts. Kept in step by test/verify-download-integrity.mjs. */
const ALLOWED_HOSTS = ["codeberg.org", "gitlab.com", "github.com", "objects.githubusercontent.com"];

const args = process.argv.slice(2);
const SYNC = args.includes("--sync");
const CHECK_ONLY = args.includes("--check");

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return { builds: [] };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    console.error(`Couldn't read ${path.relative(root, CONFIG_PATH)}: ${err.message}`);
    process.exit(1);
  }
}

function assertAllowedHost(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`not HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`host not on HARE's allowlist: ${parsed.hostname}`);
  }
}

/** Downloads to the cache if it isn't already there, and returns its bytes. */
async function fetchArtifact(url) {
  assertAllowedHost(url);
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".zip");

  if (existsSync(cachePath)) {
    return { bytes: readFileSync(cachePath), cached: true };
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(cachePath, bytes);
  return { bytes, cached: false };
}

/** Asks the API what the newest release is, and adds it to the config if it isn't already there. */
async function syncLatest(config) {
  process.stdout.write("Checking for a newer OpenRGB release… ");
  let release;
  try {
    const res = await fetch(RELEASES_API, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    release = await res.json();
  } catch (err) {
    console.log(`unavailable (${err.message}).`);
    console.log("  Keeping the builds already approved. Nothing was changed.");
    return config;
  }

  const version = release.tag_name;
  const asset = (release.assets ?? []).find((a) => /windows_64.*\.zip$/i.test(a.name));
  if (!asset) {
    console.log(`no Windows 64-bit asset on ${version}.`);
    return config;
  }
  if (config.builds.some((b) => b.version === version)) {
    console.log(`${version} is already approved.`);
    return config;
  }

  // The URL from the API is only ever a *candidate*. It's checked against the
  // allowlist here, and whatever it returns is hashed from the real bytes —
  // the API never gets to decide what HARE will install, only to suggest a
  // version worth looking at.
  try {
    assertAllowedHost(asset.browser_download_url);
  } catch (err) {
    console.log(`refused: ${err.message}`);
    return config;
  }

  console.log(`found ${version}.`);
  config.builds.push({ version, url: asset.browser_download_url });
  return config;
}

async function main() {
  const config = readConfig();
  if (SYNC) await syncLatest(config);

  if (config.builds.length === 0) {
    console.log("No OpenRGB builds are configured.");
    console.log("  HARE will ship with automatic OpenRGB updates disabled, which is safe:");
    console.log("  nothing unverified can be installed. Run with --sync to approve the latest.");
  }

  const approved = [];
  const failures = [];

  for (const build of config.builds) {
    process.stdout.write(`  ${build.version} … `);
    try {
      const { bytes, cached } = await fetchArtifact(build.url);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      approved.push({ version: build.version, url: build.url, sha256, bytes: bytes.length });
      console.log(`${sha256.slice(0, 16)}… (${bytes.length} bytes)${cached ? " [cached]" : ""}`);
    } catch (err) {
      // Not fatal. An unverifiable build is simply left out, which means HARE
      // will refuse to install it — the safe outcome. Failing the whole build
      // here would mean an offline machine can't compile at all.
      console.log(`could not verify (${err.message}) — excluded`);
      failures.push({ version: build.version, reason: err.message });
    }
  }

  const generated = renderModule(approved, failures);

  if (CHECK_ONLY) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
    if (current !== generated) {
      console.error("\nThe generated OpenRGB manifest is out of date. Run: npm run openrgb:manifest");
      process.exit(1);
    }
    console.log("\nManifest is up to date.");
    return;
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`\nWrote ${path.relative(root, OUTPUT_PATH)} — ${approved.length} approved build(s).`);
  if (failures.length > 0) {
    console.log(`${failures.length} could not be verified and were excluded. They will not be installed.`);
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function renderModule(approved, failures) {
  const stamp = failures.length
    ? ` * Excluded because they could not be verified when this was generated:\n${failures
        .map((f) => ` *   - ${f.version}: ${f.reason}`)
        .join("\n")}\n *\n`
    : "";
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Produced by scripts/openrgb-manifest.mjs, which computes every digest below
// from the real downloaded bytes. Hashes are never written by a person: that
// would be a step someone has to remember on every release, and the failure
// mode when they forget is a check that looks enabled but isn't.
//
// Regenerate with:  npm run openrgb:manifest
// Approve a newer OpenRGB with:  npm run openrgb:sync
//
${stamp} * Anything not listed here is never installed, whatever the update API says
 * about it. An empty list therefore means "no automatic OpenRGB updates",
 * which is a safe state rather than a broken one.
import type { PinnedArtifact } from "../verifiedDownload.js";

export const APPROVED_OPENRGB_BUILDS: PinnedArtifact[] = ${JSON.stringify(approved, null, 2)};
`.replace("//\n * Anything", "//\n// Anything").replace(/^ \* /gm, "// ").replace(/^ \*$/gm, "//");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
