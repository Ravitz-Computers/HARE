// Signing: off by default, on when there's something to sign with, and never
// silently half-done.
//
// WHY THIS EXISTS
//
// A certificate belongs to a person or a company, not to a repository — so the
// signing configuration cannot live in electron-builder.yml, and everyone who
// builds HARE without one has to get a working unsigned installer rather than
// an error. That leaves two failure modes worth guarding:
//
//   1. A build that was *meant* to be signed and quietly wasn't. Nobody finds
//      out until it's published, and by then the reputation the signature
//      exists to accumulate has already started from zero.
//   2. A checksum or an attestation taken before signing. Signing rewrites the
//      file, so both would describe bytes nobody will ever download. They were
//      in exactly that order until this was traced through.
import { existsSync, readFileSync } from "node:fs";
import { resolveSigning } from "../scripts/signing.mjs";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

console.log("Code signing...\n");

/** Runs resolveSigning() with a given environment and nothing else set. */
function withEnv(vars) {
  const names = [
    "HARE_SIGN_AZURE_ENDPOINT",
    "HARE_SIGN_AZURE_ACCOUNT",
    "HARE_SIGN_AZURE_PROFILE",
    "AZURE_TENANT_ID",
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "CSC_LINK",
    "HARE_SIGN_CERT_FILE",
    "HARE_SIGN_CERT_PASSWORD",
    "HARE_SIGN_CERT_SUBJECT",
    "HARE_SIGN_CERT_SHA1",
    "HARE_SIGN_VIA_SIGNPATH",
  ];
  const saved = {};
  for (const name of names) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  Object.assign(process.env, vars);
  try {
    return resolveSigning();
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

// --- Nothing configured is a working build, not a failure -------------------
{
  const none = withEnv({});
  check("with no certificate, the build still runs", none.method === "none" && !none.problem);
  check("...produces an unsigned installer", none.ready === false && none.args.length === 0);
  check("...and says so, including what Windows will do", /unsigned/i.test(none.summary) && /SmartScreen/i.test(none.summary));
}

// --- Azure Artifact Signing -------------------------------------------------
{
  const azure = withEnv({
    HARE_SIGN_AZURE_ENDPOINT: "https://eus.codesigning.azure.net",
    HARE_SIGN_AZURE_ACCOUNT: "acct",
    HARE_SIGN_AZURE_PROFILE: "prof",
    AZURE_TENANT_ID: "t",
    AZURE_CLIENT_ID: "c",
    AZURE_CLIENT_SECRET: "s",
  });
  check("Azure signing is picked up from the environment", azure.ready && azure.method === "azure");
  const joined = azure.args.join(" ");
  for (const [what, needle] of [
    ["the endpoint", "-c.win.azureSignOptions.endpoint=https://eus.codesigning.azure.net"],
    ["the account", "-c.win.azureSignOptions.codeSigningAccountName=acct"],
    ["the profile", "-c.win.azureSignOptions.certificateProfileName=prof"],
  ]) {
    check(`...passing ${what}`, joined.includes(needle));
  }
  check(
    "...and the publisher name from package.json, which is what the signature is verified against",
    joined.includes("-c.win.azureSignOptions.publisherName=Ravitz Computers")
  );

  // Half-configured is the dangerous state: it looks set up and produces an
  // unsigned file.
  const half = withEnv({
    HARE_SIGN_AZURE_ENDPOINT: "https://eus.codesigning.azure.net",
    HARE_SIGN_AZURE_ACCOUNT: "acct",
    HARE_SIGN_AZURE_PROFILE: "prof",
  });
  check("Azure signing without credentials is refused, not silently skipped", half.problem === true);
  check("...and the build stops for it", read("scripts/package-win.mjs").includes("half-configured"));
}

// --- A certificate on disk, or on a token ----------------------------------
{
  const file = withEnv({ HARE_SIGN_CERT_FILE: "C:\\certs\\x.pfx", HARE_SIGN_CERT_PASSWORD: "p" });
  check("a certificate file is used when given", file.ready && file.method === "certificate-file");
  check(
    "...with its password",
    file.args.some((a) => a === "-c.win.signtoolOptions.certificatePassword=p")
  );

  const store = withEnv({ HARE_SIGN_CERT_SUBJECT: "Ravitz Computers" });
  check("a certificate in the Windows store is used when named", store.ready && store.method === "certificate-store");

  const csc = withEnv({ CSC_LINK: "file:///x.pfx" });
  check("electron-builder's own CSC_LINK is recognised rather than fought with", csc.ready && csc.method === "csc");
}

// --- SignPath signs afterwards, so the build must not claim "unsigned" ------
{
  const signpath = withEnv({ HARE_SIGN_VIA_SIGNPATH: "1" });
  check("SignPath is reported as signed-later, not unsigned", signpath.method === "signpath");
  check("...with nothing passed to electron-builder", signpath.args.length === 0);
  check("...and no scary warning, because one is coming a step later", !/SmartScreen/i.test(signpath.summary));
}

// --- The build refuses to ship an unsigned file it meant to sign ------------
{
  const packager = read("scripts/package-win.mjs");
  check("the finished installer's signature is checked", packager.includes("Get-AuthenticodeSignature"));
  check(
    "...and a signing failure fails the build rather than warning",
    /signature\.status !== "Valid"[\s\S]{0,300}process\.exit\(1\)/.test(packager)
  );
  check(
    "the build script says whether what it produced is signed",
    read("scripts/build.ps1").includes("Get-AuthenticodeSignature")
  );
}

// --- Order of operations in CI ---------------------------------------------
// Signing rewrites the file. Anything measured before it describes bytes
// nobody will download.
{
  const workflow = read(".github/workflows/release.yml");
  const at = (name) => workflow.indexOf(`- name: ${name}`);
  const build = at("Build installer");
  const sign = at("Sign installer with SignPath");
  const checksum = at("Checksum the installer");
  const attest = at("Attest build provenance");

  check("every step is present", [build, sign, checksum, attest].every((i) => i > 0));
  check("signing comes after the build", sign > build);
  check("the checksum is taken after signing, not before", checksum > sign);
  check("...and so is the attestation", attest > sign);
  check(
    "signing credentials reach the build step",
    /Build installer[\s\S]{0,600}AZURE_CLIENT_SECRET/.test(workflow)
  );
  check(
    "...and a fork with no secrets still builds",
    /HARE_SIGN_VIA_SIGNPATH != ''/.test(workflow)
  );
}

// --- The documentation matches the code ------------------------------------
{
  const doc = read("SIGNING.md");
  for (const name of [
    "HARE_SIGN_AZURE_ENDPOINT",
    "HARE_SIGN_AZURE_ACCOUNT",
    "HARE_SIGN_AZURE_PROFILE",
    "HARE_SIGN_CERT_FILE",
    "HARE_SIGN_CERT_SUBJECT",
    "HARE_SIGN_VIA_SIGNPATH",
  ]) {
    check(`SIGNING.md documents ${name}`, doc.includes(name));
  }
  check(
    "...and still warns that EV certificates don't bypass SmartScreen",
    /EV certificates no longer bypass/i.test(doc)
  );
}

console.log("");
if (failures > 0) {
  console.error(`ALL_SIGNING_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_SIGNING_CHECKS_PASSED");
