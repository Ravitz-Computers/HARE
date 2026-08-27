// Regression test for the extract-zip mitigation in deviceDatabase.ts.
//
// extract-zip@2.0.1 (the latest published release) has an unpatched "Zip
// Slip"-style vulnerability (GHSA-jmr9-qjv8-65gv / CVE-2026-56876): a
// malicious zip can contain a symlink entry whose target escapes the
// extraction directory, and the library creates it without checking. There
// is no newer extract-zip release that fixes this, so HARE adds its own
// application-level guard (assertNoSymlinkEscapes) that runs immediately
// after every extraction and rejects the whole update if any symlink
// resolves outside the extraction directory -- before anything downstream
// (findFileRecursive / copyDirContentsInto) ever touches the extracted
// content.
//
// This test proves the guard actually works: it builds a directory tree by
// hand (a real symlink pointing outside the "extraction dir", exactly what
// a malicious zip's extracted symlink entry would produce -- no need to
// craft actual zip bytes to test this half of the pipeline, since
// assertNoSymlinkEscapes only cares about what's already on disk after
// extraction) and confirms it throws, then confirms a legitimate/benign
// tree (including an in-bounds symlink, which should be allowed) passes
// cleanly.
//
// Run via `npm run test:openrgb` (which builds electron first) rather than
// directly.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const { assertNoSymlinkEscapes } = await import("../dist-electron/backend/deviceDatabase.js");

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  OK: " + msg);
}

const root = mkdtempSync(path.join(os.tmpdir(), "hare-symlink-guard-test-"));

try {
  // --- Malicious case: a symlink escaping the extraction dir ---
  const maliciousExtractDir = path.join(root, "malicious-extract");
  const outsideTarget = path.join(root, "outside-secret.txt");
  writeFileSync(outsideTarget, "should never be reachable through the extracted update");
  mkdirSync(maliciousExtractDir, { recursive: true });
  mkdirSync(path.join(maliciousExtractDir, "nested"), { recursive: true });
  // Mirrors what extract-zip would produce from a malicious symlink entry
  // like "nested/innocent.txt -> ../../outside-secret.txt".
  symlinkSync(
    path.relative(path.join(maliciousExtractDir, "nested"), outsideTarget),
    path.join(maliciousExtractDir, "nested", "innocent.txt")
  );

  console.log("Testing a symlink that escapes the extraction directory...");
  let threw = false;
  try {
    assertNoSymlinkEscapes(maliciousExtractDir);
  } catch (err) {
    threw = true;
    assert(
      err.message.includes("Refusing to apply this OpenRGB update"),
      `error message explains what happened, got "${err.message}"`
    );
  }
  assert(threw, "assertNoSymlinkEscapes throws when a symlink escapes the extraction directory");

  // --- Benign case: a normal extracted tree, including an in-bounds symlink ---
  const benignExtractDir = path.join(root, "benign-extract");
  mkdirSync(path.join(benignExtractDir, "nested"), { recursive: true });
  writeFileSync(path.join(benignExtractDir, "OpenRGB.exe"), "pretend binary");
  writeFileSync(path.join(benignExtractDir, "nested", "readme.txt"), "hi");
  // An in-bounds symlink (target stays inside the extraction dir) is
  // legitimate and must NOT be rejected.
  symlinkSync(
    path.join(benignExtractDir, "OpenRGB.exe"),
    path.join(benignExtractDir, "nested", "link-to-exe")
  );

  console.log("\nTesting a normal extracted tree (including an in-bounds symlink)...");
  assertNoSymlinkEscapes(benignExtractDir);
  console.log("  OK: assertNoSymlinkEscapes does not throw for a legitimate extracted tree");

  console.log("\nALL_SYMLINK_ESCAPE_GUARD_CHECKS_PASSED");
  process.exit(0);
} finally {
  rmSync(root, { recursive: true, force: true });
}
