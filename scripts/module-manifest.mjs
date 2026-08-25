#!/usr/bin/env node
// Generates the verified download list for optional vendor modules.
//
// Same rule as scripts/openrgb-manifest.mjs, and for a stronger reason:
// modules are native code HARE loads into its own process, so an unverified
// module download would be worse than an unverified OpenRGB download — at
// least OpenRGB runs as a separate process.
//
// No digest is ever written by a person. Each entry's SHA-256 is computed
// from the real bytes of the artifact being published, and a module with no
// verified entry simply cannot be installed. Absence is the safe default.
//
// Modules are published as zips alongside a HARE release rather than pulled
// straight from npm at runtime: it means one archive format HARE already
// knows how to extract safely, one host on the allowlist, and a digest that
// covers exactly the bytes that will be unpacked.
//
//   node scripts/module-manifest.mjs           # regenerate from config
//   node scripts/module-manifest.mjs --check   # verify only, for CI
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(root, "scripts", "modules.json");
const OUTPUT_PATH = path.join(root, "electron", "backend", "generated", "moduleBuilds.ts");
const CACHE_DIR = path.join(root, "vendor", "module-cache");

/** Mirrors ALLOWED_DOWNLOAD_HOSTS in electron/backend/verifiedDownload.ts. */
const ALLOWED_HOSTS = ["codeberg.org", "gitlab.com", "github.com", "objects.githubusercontent.com"];

const CHECK_ONLY = process.argv.includes("--check");

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return { modules: [] };
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
  const cachePath = path.join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".zip");
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

  if (config.modules.length === 0) {
    console.log("No downloadable modules are configured.");
    console.log("  Modules that need no download (SteelSeries, MSI) are unaffected —");
    console.log("  they rely only on what already ships with HARE.");
  }

  for (const mod of config.modules) {
    process.stdout.write(`  ${mod.id} … `);
    try {
      const { bytes, cached } = await fetchArtifact(mod.url);
      approved.push({
        id: mod.id,
        version: mod.version,
        url: mod.url,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
      console.log(`verified (${bytes.length} bytes)${cached ? " [cached]" : ""}`);
    } catch (err) {
      console.log(`could not verify (${err.message}) — excluded`);
      failures.push({ id: mod.id, reason: err.message });
    }
  }

  const generated = render(approved, failures);

  if (CHECK_ONLY) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : "";
    if (current !== generated) {
      console.error("\nThe generated module manifest is out of date. Run: npm run modules:manifest");
      process.exit(1);
    }
    console.log("\nModule manifest is up to date.");
    return;
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated);
  console.log(`\nWrote ${path.relative(root, OUTPUT_PATH)} — ${approved.length} downloadable module(s).`);
  if (failures.length > 0) {
    console.log(`${failures.length} could not be verified and were excluded. They cannot be installed.`);
  }
}

function render(approved, failures) {
  const excluded = failures.length
    ? failures.map((f) => `//   - ${f.id}: ${f.reason}`).join("\n") + "\n//\n"
    : "";
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Produced by scripts/module-manifest.mjs, which computes every digest below
// from the real published bytes. Modules are native code HARE loads into its
// own process, so a hand-maintained hash here would be an even worse idea
// than elsewhere: it is a check that looks enabled while doing nothing.
//
// Regenerate with:  npm run modules:manifest
//
${excluded ? "// Excluded because they could not be verified when this was generated:\n" + excluded : ""}// A module with no entry here cannot be installed, whatever the UI offers.
// An empty list means no downloadable modules shipped with this build, which
// is a safe state rather than a broken one.
import type { PinnedArtifact } from "../verifiedDownload.js";

export interface ApprovedModule extends PinnedArtifact {
  id: string;
}

export const APPROVED_MODULES: ApprovedModule[] = ${JSON.stringify(approved, null, 2)};
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
