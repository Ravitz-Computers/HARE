#!/usr/bin/env node
// Stamps each build with something a log can be traced back to.
//
// Every build called itself "HARE 0.1.0", so a diagnostic log couldn't say
// which one produced it -- a real cost: a log arrived showing a bug that had
// already been fixed, and there was no way to tell from the file whether the
// fix was even present. The version alone can't do this, because the version
// only changes on release and builds happen constantly.
//
// So each build gets a short fingerprint of its own source. It's derived from
// the files, never hand-written, and identical inputs give an identical
// stamp.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(root, "electron", "backend", "generated", "buildStamp.ts");
const SOURCES = ["electron", "src"];

function hashTree(dir, hash) {
  for (const entry of readdirSync(dir).sort()) {
    // Generated output is excluded, or the stamp would depend on itself.
    if (entry === "generated" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) hashTree(full, hash);
    else if (/\.(ts|tsx|css)$/.test(entry)) hash.update(entry).update(readFileSync(full));
  }
}

const hash = createHash("sha256");
for (const dir of SOURCES) hashTree(path.join(root, dir), hash);
const stamp = hash.digest("hex").slice(0, 8);

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(
  OUTPUT,
  `// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Produced by scripts/build-stamp.mjs from a hash of this build's own source,
// so a diagnostic log can be traced back to exactly the code that wrote it.
// "HARE 0.1.0" was the same string for every build ever made; this isn't.
//
// Regenerate with:  npm run build:electron
export const BUILD_STAMP = ${JSON.stringify(stamp)};
export const APP_VERSION = ${JSON.stringify(pkg.version)};
`
);
console.log(`Build stamp: ${pkg.version}+${stamp}`);
