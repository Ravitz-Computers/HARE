#!/usr/bin/env node
// Builds the Windows installer, signs it if there's anything to sign with, and
// says which of those happened.
//
// WHY THIS EXISTS RATHER THAN A LONGER npm SCRIPT
//
// Signing options can't be baked into electron-builder.yml: a certificate
// belongs to a person or a company, not to a repository, and everyone else who
// builds HARE has to get a working unsigned installer rather than an error. So
// the options are worked out here (see signing.mjs) and passed as `-c.`
// overrides only when they exist.
//
// The other half is verification. An installer that was *meant* to be signed
// and silently wasn't is worse than one that was never going to be, because
// nobody finds out until it's published -- so when signing was configured, the
// finished file is checked and the build fails if it isn't actually signed.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSigning } from "./signing.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Asks Windows whether the file carries a valid signature, and who signed it. */
function describeSignature(file) {
  if (process.platform !== "win32") return null;
  const script = `
    $sig = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(file)}
    Write-Output "$($sig.Status)|$($sig.SignerCertificate.Subject)"
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const [status, subject] = String(result.stdout).trim().split("|");
  return { status, subject: subject ?? "" };
}

const signing = resolveSigning();

console.log("");
console.log(`  Signing: ${signing.summary}`);
console.log("");

if (signing.problem) {
  // Half-configured is the dangerous state: it looks set up and produces an
  // unsigned file.
  console.error("Refusing to build: signing is half-configured. Set the missing variables, or unset the rest.");
  process.exit(1);
}

// First, and it takes a second: electron-builder validates its own config
// only after everything else has been built, which is the most expensive
// possible moment to discover a misplaced key.
run("npm", ["run", "test:builder-config"]);
run("npm", ["run", "build"]);
run("npm", ["run", "verify:bundle"]);
// `--publish never` is explicit on purpose. electron-builder decides on its
// own to "publish" when it detects a CI environment, and warns that the
// behaviour is going away in v27 -- and it detected CI on a plain desktop
// build. There is nowhere to publish to (`publish: null` in the config), so
// saying so removes both the warning and the guesswork.
run("npx", ["electron-builder", "--win", "--publish", "never", ...signing.args]);

// --- Did it actually get signed? -------------------------------------------
const releaseDir = path.join(root, "release");
const installer = existsSync(releaseDir)
  ? readdirSync(releaseDir)
      .filter((name) => name.toLowerCase().endsWith(".exe"))
      .map((name) => path.join(releaseDir, name))[0]
  : null;

if (!installer) {
  console.error("The build finished but no installer appeared in release/.");
  process.exit(1);
}

const signature = describeSignature(installer);

if (signing.ready) {
  if (!signature) {
    console.log(`  Built ${path.basename(installer)}. Signature can't be checked from here -- verify on Windows.`);
  } else if (signature.status !== "Valid") {
    console.error("");
    console.error(`  ${path.basename(installer)} was supposed to be signed and isn't: ${signature.status}`);
    console.error("  A build that quietly ships unsigned is the one failure worth stopping for.");
    process.exit(1);
  } else {
    console.log(`  Signed: ${path.basename(installer)}`);
    console.log(`          ${signature.subject}`);
  }
} else {
  console.log(`  Built ${path.basename(installer)} (unsigned).`);
  if (signing.method === "none") {
    console.log("  Windows will warn the first people who run it. SIGNING.md explains the options.");
  }
}
console.log("");
