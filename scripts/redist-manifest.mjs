#!/usr/bin/env node
// Generates the verified download entry for the Microsoft Visual C++
// runtime that OpenRGB needs in order to start at all.
//
// This is the gap that made HARE look completely broken on a clean PC:
// OpenRGB is built against the Visual C++ runtime, and without it OpenRGB.exe
// fails to start with no useful error at all. HARE bundled OpenRGB but not
// what OpenRGB needs to run.
//
// Same rule as every other artifact here: the digest is computed from the
// real published bytes at build time and never written by a person. Microsoft
// updates this file in place under a stable URL, so pinning a hash by hand
// would break on their schedule; regenerating at build time is what keeps it
// both current and verified.
//
//   node scripts/redist-manifest.mjs           # regenerate from config
//   node scripts/redist-manifest.mjs --check   # verify only, for CI
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(root, "scripts", "redist.json");
const OUTPUT_PATH = path.join(root, "electron", "backend", "generated", "redistBuild.ts");
const CACHE_DIR = path.join(root, "vendor", "redist-cache");
/** Where the verified installer is placed so electron-builder can ship it inside HARE. */
const BUNDLE_DIR = path.join(root, "vendor", "redist");

/** Mirrors ALLOWED_DOWNLOAD_HOSTS in electron/backend/verifiedDownload.ts. */
const ALLOWED_HOSTS = [
  "codeberg.org",
  "gitlab.com",
  "github.com",
  "objects.githubusercontent.com",
  "pawnio.eu",
  // Microsoft's permanent redistributable address, and the CDN it hands off to.
  "aka.ms",
  "download.visualstudio.microsoft.com",
];

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

/**
 * A copy already sitting in the bundle directory -- see the same note in
 * pawnio-manifest.mjs. build.ps1 downloads with Windows' own HTTP stack
 * before npm runs, and this hashes what it left behind.
 */
function localBundle() {
  const file = path.join(BUNDLE_DIR, "vc_redist.x64.exe");
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  if (bytes.length < 1_000_000) return null; // the real thing is ~25 MB
  return {
    version: "bundled",
    url: "file://vendor/redist/vc_redist.x64.exe",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

async function main() {
  const config = readConfig();
  const approved = [];
  const failures = [];

  const local = localBundle();
  if (local) {
    console.log(`  Using the Visual C++ runtime already downloaded (${local.bytes} bytes).`);
    const generated = render([local], []);
    if (CHECK_ONLY) {
      const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
      if (current !== generated) {
        console.error("\nThe generated runtime manifest is out of date. Run: npm run redist:manifest");
        process.exit(1);
      }
      console.log("\nRuntime manifest is up to date.");
      return;
    }
    mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, generated);
    console.log(`\nWrote ${path.relative(root, OUTPUT_PATH)} -- 1 approved runtime(s).`);
    return;
  }

  let builds = config.builds ?? [];

  // Microsoft publishes the current runtime at one permanent address and
  // updates the file in place, so there is no release to resolve -- just an
  // artifact to fetch and pin. The digest changes when they update it, which
  // is exactly why it is regenerated rather than hand-written.
  if (builds.length === 0 && config.track === "latest") {
    builds = [{ version: "latest", url: "https://aka.ms/vs/17/release/vc_redist.x64.exe" }];
  }

  if (builds.length === 0) {
    console.log("No Visual C++ runtime was prepared.");
    console.log("  OpenRGB needs it to start; without it a clean PC sees no devices at all.");
  }

  for (const build of builds) {
    process.stdout.write(`  Visual C++ runtime (${build.version}) ... `);
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
        writeFileSync(path.join(BUNDLE_DIR, "vc_redist.x64.exe"), bytes);
      }
      console.log(`verified (${bytes.length} bytes)${cached ? " [cached]" : ""}, bundled`);
    } catch (err) {
      console.log(`could not verify (${err.message}) -- excluded`);
      failures.push({ version: build.version, reason: err.message });
    }
  }

  const generated = render(approved, failures);

  if (CHECK_ONLY) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
    if (current !== generated) {
      console.error("\nThe generated runtime manifest is out of date. Run: npm run redist:manifest");
      process.exit(1);
    }
    console.log("\nRuntime manifest is up to date.");
    return;
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`\nWrote ${path.relative(root, OUTPUT_PATH)} -- ${approved.length} approved runtime(s).`);
}

function render(approved, failures) {
  const excluded = failures.length
    ? "// Excluded because they could not be verified when this was generated:\n" +
      failures.map((f) => `//   - ${f.version}: ${f.reason}`).join("\n") +
      "\n//\n"
    : "";
  return `// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Produced by scripts/redist-manifest.mjs, which computes the digest below
// from the real published bytes. Microsoft updates this file in place, so a
// hand-written hash would break on their schedule -- generating it is what
// keeps the artifact both current and verified.
//
// Regenerate with:  npm run redist:manifest
//
${excluded}// With no entry here the installer simply doesn't ship the runtime. On a PC
// that already has it that changes nothing; on a clean one, OpenRGB won't
// start.
import type { PinnedArtifact } from "../verifiedDownload.js";

export const APPROVED_REDIST_BUILDS: PinnedArtifact[] = ${JSON.stringify(approved, null, 2)};
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
