#!/usr/bin/env node
// Refuses to package an installer that isn't complete.
//
// WHY THIS EXISTS
//
// HARE ships one file. Someone downloads HARE-Setup.exe, runs it, and has
// working RGB -- no zip, no second download, no "now go and get OpenRGB".
// Everything that makes that true travels inside the installer: OpenRGB
// itself, the Visual C++ runtime it needs to start at all, and the PawnIO
// driver that motherboard and RAM lighting go through.
//
// Each of those is fetched at build time, and each fetch can fail -- a proxy,
// an offline machine, a rate-limited API. When one did, the build carried on
// and produced an installer that looked finished and wasn't: it installed,
// launched, found no devices, and gave no clue why. That is exactly the fault
// that cost this project three releases and a lot of someone's evening.
//
// So the check runs before packaging and stops the build. A missing payload is
// a broken installer, and a broken installer is worse than no installer.
//
//   node scripts/verify-bundle.mjs
//   node scripts/verify-bundle.mjs --allow-incomplete   # a dev build, never for release
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lenient = process.argv.includes("--allow-incomplete");

/** Everything that has to be inside the installer, and what it's for. */
const REQUIRED = [
  {
    label: "OpenRGB",
    file: "vendor/openrgb/OpenRGB.exe",
    minBytes: 1_000_000,
    why: "HARE drives OpenRGB. Without it nothing lights up at all.",
    fix: "Run build.bat again -- it downloads OpenRGB automatically. If it can't reach codeberg.org, download the Windows 64-bit zip from openrgb.org and unzip it into vendor\\openrgb.",
  },
  {
    label: "The Visual C++ runtime",
    file: "vendor/redist/vc_redist.x64.exe",
    minBytes: 1_000_000,
    manifest: "electron/backend/generated/redistBuild.ts",
    manifestSymbol: "APPROVED_REDIST_BUILDS",
    why: "OpenRGB is built against it. On a PC that doesn't have it, OpenRGB.exe fails to start with no error and HARE finds no devices -- every symptom points at HARE.",
    fix: "Run build.bat again. If it still can't fetch it, download it yourself from https://aka.ms/vs/17/release/vc_redist.x64.exe and put it in vendor\\redist.",
  },
  {
    label: "The PawnIO driver",
    file: "vendor/pawnio/PawnIO-Setup.exe",
    minBytes: 100_000,
    manifest: "electron/backend/generated/pawnIoBuild.ts",
    manifestSymbol: "APPROVED_PAWNIO_BUILDS",
    why: "Motherboard and RAM lighting go through it. Without it, everything plugged in over USB still works, but the board itself stays dark.",
    fix: "Run build.bat again. If it still can't fetch it, download the installer from https://pawnio.eu and save it as vendor\\pawnio\\PawnIO-Setup.exe.",
  },
  {
    label: "The licence texts",
    file: "LICENSE",
    minBytes: 500,
    why: "HARE bundles GPL-licensed software, whose terms have to travel with it.",
    fix: "The LICENSE file is missing from the project -- re-extract the HARE source.",
  },
];

/** A generated manifest counts as filled in when its array has at least one entry. */
function manifestHasEntry(relative, symbol) {
  const file = path.join(root, relative);
  if (!existsSync(file)) return false;
  const source = readFileSync(file, "utf8");
  const match = new RegExp(`${symbol}[^=]*=\\s*(\\[[\\s\\S]*?\\]);`).exec(source);
  if (!match) return false;
  try {
    return JSON.parse(match[1]).length > 0;
  } catch {
    return false;
  }
}

const problems = [];

for (const item of REQUIRED) {
  const full = path.join(root, item.file);
  if (!existsSync(full)) {
    problems.push({ ...item, detail: "it isn't there" });
    continue;
  }
  const size = statSync(full).size;
  if (size < item.minBytes) {
    // A failed download often lands as an HTML error page saved under the
    // right name, which exists and is useless.
    problems.push({ ...item, detail: `it's only ${size} bytes, which is too small to be the real file` });
    continue;
  }
  if (item.manifest && !manifestHasEntry(item.manifest, item.manifestSymbol)) {
    problems.push({ ...item, detail: "the file is there but wasn't verified, so HARE won't use it" });
  }
}

if (problems.length === 0) {
  console.log("Everything the installer needs is present:");
  for (const item of REQUIRED) {
    const size = statSync(path.join(root, item.file)).size;
    console.log(`  OK  ${item.label} -- ${item.file} (${(size / 1_048_576).toFixed(1)} MB)`);
  }
  process.exit(0);
}

console.error("");
console.error("The installer can't be built yet. It has to contain everything HARE needs,");
console.error("so that the one file works on a PC with nothing else on it.");
console.error("");
for (const problem of problems) {
  console.error(`  MISSING  ${problem.label} -- ${problem.detail}`);
  console.error(`           ${problem.why}`);
  console.error(`           ${problem.fix}`);
  console.error("");
}

if (lenient) {
  console.error("Continuing anyway because --allow-incomplete was passed.");
  console.error("The installer this produces is for testing. Do not give it to anyone.");
  process.exit(0);
}

process.exit(1);
