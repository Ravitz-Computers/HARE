#!/usr/bin/env node
// Puts a verified OpenRGB into vendor/openrgb, ready to be packaged.
//
// WHY THIS EXISTS
//
// `build.bat` does this on Windows, in PowerShell. CI doesn't run build.bat --
// it runs npm -- and until this existed the release workflow regenerated the
// OpenRGB *manifest* and then tried to package, with `vendor/openrgb` still
// empty. `verify-bundle.mjs` correctly refused, and the tagged release
// produced nothing at all.
//
// The bytes come from the same digest-pinned entry the app itself trusts
// (electron/backend/generated/openrgbBuilds.ts), so what gets staged here is
// exactly what was verified -- this never reaches for an unpinned download.
//
//   node scripts/stage-openrgb.mjs
//   node scripts/stage-openrgb.mjs --force   # restage even if it's already there
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import extract from "extract-zip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(root, "vendor", "openrgb");
const CACHE_DIR = path.join(root, "vendor", "openrgb-cache");
const MANIFEST = path.join(root, "electron", "backend", "generated", "openrgbBuilds.ts");
const force = process.argv.includes("--force");

function approvedBuilds() {
  if (!existsSync(MANIFEST)) return [];
  const source = readFileSync(MANIFEST, "utf8");
  const match = /APPROVED_OPENRGB_BUILDS[^=]*=\s*(\[[\s\S]*?\]);/.exec(source);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

/** Finds OpenRGB.exe wherever the archive happened to put it. */
function findExeDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry.toLowerCase() === "openrgb.exe") return dir;
    if (statSync(full).isDirectory()) {
      const found = findExeDir(full);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  if (!force && existsSync(path.join(TARGET, "OpenRGB.exe"))) {
    console.log("OpenRGB is already staged in vendor/openrgb.");
    return;
  }

  const build = approvedBuilds()[0];
  if (!build) {
    console.error("No verified OpenRGB build is available. Run: npm run openrgb:sync");
    process.exit(1);
  }

  const cachePath = path.join(CACHE_DIR, createHash("sha1").update(build.url).digest("hex") + ".zip");
  let bytes;
  if (existsSync(cachePath)) {
    bytes = readFileSync(cachePath);
  } else {
    console.log(`  Downloading OpenRGB ${build.version}...`);
    const res = await fetch(build.url, { redirect: "follow" });
    if (!res.ok) {
      console.error(`Couldn't download OpenRGB: HTTP ${res.status}`);
      process.exit(1);
    }
    bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, bytes);
  }

  // The digest is the whole point. A staged binary that doesn't match the
  // pinned hash is not the binary anyone approved, and packaging it would
  // put unverified code inside a signed installer.
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== build.sha256) {
    console.error(`OpenRGB ${build.version} does not match its pinned digest.`);
    console.error(`  expected ${build.sha256}`);
    console.error(`  got      ${digest}`);
    rmSync(cachePath, { force: true });
    process.exit(1);
  }

  const scratch = path.join(root, "vendor", ".openrgb-staging");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const zipPath = path.join(scratch, "openrgb.zip");
  writeFileSync(zipPath, bytes);
  await extract(zipPath, { dir: path.join(scratch, "extract") });

  const exeDir = findExeDir(path.join(scratch, "extract"));
  if (!exeDir) {
    console.error("The archive downloaded, but there's no OpenRGB.exe inside it.");
    rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  }

  // Flattened, so OpenRGB.exe sits directly in vendor/openrgb -- which is
  // where electron-builder's extraResources mapping and every path in the
  // app expect it.
  rmSync(TARGET, { recursive: true, force: true });
  mkdirSync(TARGET, { recursive: true });
  cpSync(exeDir, TARGET, { recursive: true });
  writeFileSync(path.join(TARGET, "version.txt"), build.version, "utf8");
  rmSync(scratch, { recursive: true, force: true });

  console.log(`Staged OpenRGB ${build.version} into vendor/openrgb.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
