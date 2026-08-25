// How HARE gets signed, and what to do when it can't be.
//
// WHY THIS IS ARRANGED THIS WAY
//
// Signing needs a certificate, and a certificate belongs to a person or a
// company -- not to a repository. Most people who build HARE (contributors,
// anyone verifying a release for themselves) will never have one, and for them
// the build has to work and produce an honest unsigned installer.
//
// So none of this lives in electron-builder.yml. The config file describes the
// installer; this file decides, at build time, whether there is anything to
// sign with, and hands electron-builder the matching options as `-c.` overrides
// only when there are. Nothing has to be edited to turn signing on: set the
// environment variables and the next build is signed.
//
// Three routes are supported, in the order most projects reach for them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/**
 * The name that must appear in the certificate, and that Windows shows in the
 * "Verified publisher" line of the SmartScreen prompt.
 *
 * Taken from package.json rather than typed again, because electron-builder
 * also uses it to verify the signature -- a mismatch between the two is a
 * failure that only shows up at install time.
 */
export const PUBLISHER_NAME = pkg.author?.name ?? pkg.name;

const env = (name) => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
};

/**
 * Works out how this build should be signed.
 *
 * Returns the electron-builder arguments to add, a one-line summary for the
 * build output, and whether the result will actually carry a signature.
 */
export function resolveSigning() {
  // --- 1. Azure Artifact Signing (formerly Trusted Signing) ----------------
  // Microsoft's own cloud signing service. No hardware token, no private key
  // on the build machine, and it is the cheapest route that Windows treats as
  // a real publisher identity.
  //
  // The three AZURE_* variables are Microsoft Entra's own names, read directly
  // by the Azure identity library that electron-builder calls -- they are not
  // HARE's to rename.
  const azureEndpoint = env("HARE_SIGN_AZURE_ENDPOINT");
  const azureAccount = env("HARE_SIGN_AZURE_ACCOUNT");
  const azureProfile = env("HARE_SIGN_AZURE_PROFILE");
  const azureAuth = env("AZURE_TENANT_ID") && env("AZURE_CLIENT_ID") && env("AZURE_CLIENT_SECRET");

  if (azureEndpoint && azureAccount && azureProfile) {
    if (!azureAuth) {
      return {
        ready: false,
        method: "azure",
        args: [],
        summary:
          "Azure signing is configured but AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET are not set, so this build will NOT be signed.",
        problem: true,
      };
    }
    return {
      ready: true,
      method: "azure",
      args: [
        `-c.win.azureSignOptions.publisherName=${PUBLISHER_NAME}`,
        `-c.win.azureSignOptions.endpoint=${azureEndpoint}`,
        `-c.win.azureSignOptions.codeSigningAccountName=${azureAccount}`,
        `-c.win.azureSignOptions.certificateProfileName=${azureProfile}`,
      ],
      summary: `Signing with Azure Artifact Signing (${azureAccount} / ${azureProfile}).`,
    };
  }

  // --- 2. A certificate file -----------------------------------------------
  // A .pfx on disk. electron-builder reads CSC_LINK / CSC_KEY_PASSWORD by
  // itself, so those are recognised and reported rather than re-passed.
  if (env("CSC_LINK")) {
    return {
      ready: true,
      method: "csc",
      args: [`-c.win.signtoolOptions.publisherName=${PUBLISHER_NAME}`],
      summary: "Signing with the certificate in CSC_LINK.",
    };
  }

  const certFile = env("HARE_SIGN_CERT_FILE");
  if (certFile) {
    const password = env("HARE_SIGN_CERT_PASSWORD");
    return {
      ready: true,
      method: "certificate-file",
      args: [
        `-c.win.signtoolOptions.certificateFile=${certFile}`,
        ...(password ? [`-c.win.signtoolOptions.certificatePassword=${password}`] : []),
        `-c.win.signtoolOptions.publisherName=${PUBLISHER_NAME}`,
      ],
      summary: `Signing with the certificate at ${certFile}.`,
    };
  }

  // --- 3. A certificate already in the Windows store -----------------------
  // How a hardware token or HSM-backed certificate is normally used: the key
  // never leaves the device, and signtool addresses it by subject or thumbprint.
  const subject = env("HARE_SIGN_CERT_SUBJECT");
  const sha1 = env("HARE_SIGN_CERT_SHA1");
  if (subject || sha1) {
    return {
      ready: true,
      method: "certificate-store",
      args: [
        ...(subject ? [`-c.win.signtoolOptions.certificateSubjectName=${subject}`] : []),
        ...(sha1 ? [`-c.win.signtoolOptions.certificateSha1=${sha1}`] : []),
        `-c.win.signtoolOptions.publisherName=${PUBLISHER_NAME}`,
      ],
      summary: `Signing with the certificate in the Windows store (${subject ?? sha1}).`,
    };
  }

  // --- 4. SignPath, which signs after the build ----------------------------
  // SignPath's GitHub Action takes the finished artifact and returns a signed
  // one, so there is nothing for electron-builder to do here. Set this so the
  // build says what's happening rather than reporting an unsigned installer
  // that is about to be signed a step later.
  if (env("HARE_SIGN_VIA_SIGNPATH")) {
    return {
      ready: false,
      method: "signpath",
      args: [],
      summary: "Not signed here -- SignPath signs the finished installer in the release workflow.",
    };
  }

  return {
    ready: false,
    method: "none",
    args: [],
    summary:
      "No signing certificate configured, so this installer will be unsigned. " +
      "Windows will show a SmartScreen warning. See SIGNING.md.",
  };
}
