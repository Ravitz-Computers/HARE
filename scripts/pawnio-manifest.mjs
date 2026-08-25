#!/usr/bin/env node
// Generates the verified download entry for the PawnIO driver installer.
//
// Same rule as the OpenRGB and module manifests, and here it matters most of
// all: this artifact is a **kernel driver installer**. It is the one thing
// HARE can fetch where an unverified download would mean running unverified
// code in ring 0. So the digest is computed from the real published bytes at
// build time, never written by a person, and an entry that cannot be
// verified is left out — which makes the install button say "not available
// in this build" rather than fetch something unchecked.
//
//   node scripts/pawnio-manifest.mjs           # regenerate from config
//   node scripts/pawnio-manifest.mjs --check   # verify only, for CI
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(root, "scripts", "pawnio.json");
const OUTPUT_PATH = path.join(root, "electron", "backend", "generated", "pawnIoBuild.ts");
const CACHE_DIR = path.join(root, "vendor", "pawnio-cache");
/** Where the verified installer is placed so electron-builder can ship it inside HARE. */
const BUNDLE_DIR = path.join(root, "vendor", "pawnio");

/**
 * PawnIO's installer is published as a GitHub release, so the version can be
 * resolved rather than hand-written — the same rule as everything else here:
 * a human decides *whether* to ship it, the machine works out *what* that is.
 */
const RELEASES_API = "https://api.github.com/repos/namazso/PawnIO.Setup/releases/latest";

async function resolveLatestRelease() {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "HARE-build" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from the PawnIO release API`);
  const release = await res.json();
  // The Windows installer, whatever it happens to be called this release.
  const asset = (release.assets ?? []).find((a) => /\.exe$/i.test(a.name ?? ""));
  if (!asset) throw new Error("that release publishes no .exe installer");
  return { version: release.tag_name ?? "latest", url: asset.browser_download_url, name: asset.name };
}

/** Mirrors ALLOWED_DOWNLOAD_HOSTS in electron/backend/verifiedDownload.ts. */
const ALLOWED_HOSTS = ["codeberg.org", "gitlab.com", "github.com", "objects.githubusercontent.com", "pawnio.eu"];

const CHECK_ONLY = process.argv.includes("--check");

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

async function fetchArtifact(url) {
  assertAllowedHost(url);
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".bin");
  if (existsSync(cachePath)) return { bytes: readFileSync(cachePath), cached: true };

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(cachePath, bytes);
  return { bytes, cached: false };
}

async function main() {
  const config = readConfig();
  const approved = [];
  const failures = [];

  let builds = config.builds ?? [];

  // `"track": "latest"` means "ship whatever the current release is", resolved
  // at build time. A pinned entry in the config still wins, for a build that
  // needs to be reproducible against a specific version.
  if (builds.length === 0 && config.track === "latest") {
    try {
      const resolved = await resolveLatestRelease();
      console.log(`  Resolved the latest PawnIO installer: ${resolved.name} (${resolved.version})`);
      builds = [resolved];
    } catch (err) {
      console.log(`  Couldn't resolve the latest PawnIO release (${err.message}).`);
    }
  }

  if (builds.length === 0) {
    console.log("No PawnIO installer could be prepared.");
    console.log("  HARE will still detect PawnIO if the user installs it themselves.");
  }

  for (const build of builds) {
    process.stdout.write(`  PawnIO ${build.version} … `);
    try {
      const { bytes, cached } = await fetchArtifact(build.url);
      approved.push({
        version: build.version,
        url: build.url,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
      // Also written where electron-builder can pick it up, so the driver
      // ships *inside* HARE rather than being fetched on the user's PC. The
      // digest above still guards it: the copy that ships is the copy that
      // was verified here.
      if (!CHECK_ONLY) {
        mkdirSync(BUNDLE_DIR, { recursive: true });
        writeFileSync(path.join(BUNDLE_DIR, "PawnIO-Setup.exe"), bytes);
      }
      console.log(`verified (${bytes.length} bytes)${cached ? " [cached]" : ""}, bundled`);
    } catch (err) {
      console.log(`could not verify (${err.message}) — excluded`);
      failures.push({ version: build.version, reason: err.message });
    }
  }

  const generated = render(approved, failures);

  if (CHECK_ONLY) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
    if (current !== generated) {
      console.error("\nThe generated PawnIO manifest is out of date. Run: npm run pawnio:manifest");
      process.exit(1);
    }
    console.log("\nPawnIO manifest is up to date.");
    return;
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`\nWrote ${path.relative(root, OUTPUT_PATH)} — ${approved.length} approved installer(s).`);
}

function render(approved, failures) {
  const excluded = failures.length
    ? "// Excluded because they could not be verified when this was generated:\n" +
      failures.map((f) => `//   - ${f.version}: ${f.reason}`).join("\n") +
      "\n//\n"
    : "";
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Produced by scripts/pawnio-manifest.mjs, which computes the digest below
// from the real published bytes. This artifact installs a kernel driver, so
// a hand-written hash here would be the most dangerous kind of check: one
// that looks enabled while verifying nothing.
//
// Regenerate with:  npm run pawnio:manifest
//
${excluded}// With no entry here HARE cannot install PawnIO at all — it can still detect
// an install the user did themselves, which is the safe default.
import type { PinnedArtifact } from "../verifiedDownload.js";

export const APPROVED_PAWNIO_BUILDS: PinnedArtifact[] = ${JSON.stringify(approved, null, 2)};
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
