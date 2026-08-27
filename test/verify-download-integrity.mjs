// Verifies that HARE will not install bytes it can't vouch for.
//
// WHAT THIS IS GUARDING
//
// HARE downloads OpenRGB and then executes it. Before this layer existed, the
// download URL came straight out of a third-party API response, redirects were
// followed to any host, and nothing about the resulting file was checked
// before it was unzipped and run. That made a compromised release, a hijacked
// DNS answer, or one malicious redirect sufficient to run arbitrary code on
// every HARE machine.
//
// These checks are written as the attacks themselves — each one stands up a
// real local HTTP server that behaves like a specific compromise and asserts
// that HARE refuses it and leaves nothing on disk. A regression here isn't a
// cosmetic bug; it reopens remote code execution.
import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  downloadVerified,
  isAllowedDownloadUrl,
  sha256File,
  ALLOWED_DOWNLOAD_HOSTS,
} from "../dist-electron/backend/verifiedDownload.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "hare-dl-test-"));
const GOOD = Buffer.from("this is a totally legitimate OpenRGB release zip");
const GOOD_SHA = createHash("sha256").update(GOOD).digest("hex");
const EVIL = Buffer.from("this is malware pretending to be OpenRGB");

console.log("Download integrity...\n");

// --- URL gate ---------------------------------------------------------------
{
  check(
    "plain HTTP is refused outright",
    isAllowedDownloadUrl("http://codeberg.org/x.zip")?.reason === "insecure-scheme"
  );
  check(
    "an unknown host is refused even over HTTPS",
    isAllowedDownloadUrl("https://evil.example.com/x.zip")?.reason === "blocked-host"
  );
  check(
    "a lookalike host is refused (not a substring match)",
    isAllowedDownloadUrl("https://codeberg.org.evil.com/x.zip")?.reason === "blocked-host"
  );
  check(
    "an allowlisted host passes",
    isAllowedDownloadUrl("https://codeberg.org/OpenRGB/x.zip") === null
  );
  check(
    "the allowlist is a real list, not empty",
    ALLOWED_DOWNLOAD_HOSTS.length > 0 && ALLOWED_DOWNLOAD_HOSTS.includes("codeberg.org")
  );
  check(
    "a file:// URL can't be used to sideload a local path",
    isAllowedDownloadUrl("file:///C:/evil.zip")?.reason === "insecure-scheme"
  );
}

// A local test server can't be on the allowlist, so route through a fetch
// shim that keeps every gate live but points the socket at localhost. Only
// the transport is redirected — the URL checks still see the real hostnames.
function shimFetch(port, hostMap) {
  return async (url, init) => {
    const parsed = new URL(url);
    const local = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
    const res = await fetch(local, { redirect: "manual", ...init });
    return {
      ok: res.ok,
      status: res.status,
      headers: {
        get(name) {
          const v = res.headers.get(name);
          if (name.toLowerCase() === "location" && v && hostMap) return hostMap(v);
          return v;
        },
      },
      body: res.body,
    };
  };
}

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

// --- The honest case --------------------------------------------------------
{
  const { port, close } = await serve((req, res) => {
    res.setHeader("content-length", String(GOOD.length));
    res.end(GOOD);
  });
  const dest = path.join(tmp, "good.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/good.zip", sha256: GOOD_SHA, bytes: GOOD.length },
    dest,
    shimFetch(port)
  );
  check("a matching download succeeds", result.ok === true);
  check("...and the file is on disk", existsSync(dest));
  check("...with the expected digest", (await sha256File(dest)) === GOOD_SHA);
  await close();
}

// --- Attack: the server returns different bytes than we pinned -------------
// This is the compromised-release / MITM case, and the one gate that actually
// matters. Everything else just fails faster.
{
  const { port, close } = await serve((req, res) => {
    res.setHeader("content-length", String(EVIL.length));
    res.end(EVIL);
  });
  const dest = path.join(tmp, "swapped.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/good.zip", sha256: GOOD_SHA },
    dest,
    shimFetch(port)
  );
  check("substituted bytes are rejected on the hash check", result.ok === false && result.failure.reason === "hash-mismatch");
  check("...and the rejected file is deleted, never left for a later step to pick up", !existsSync(dest));
  check("...and the user is told nothing was installed", /nothing was installed/i.test(result.message));
  await close();
}

// --- Attack: redirect to a host that isn't allowlisted ---------------------
// `redirect: "follow"` would have made this invisible.
{
  const { port, close } = await serve((req, res) => {
    res.statusCode = 302;
    res.setHeader("location", "https://evil.example.com/payload.zip");
    res.end();
  });
  const dest = path.join(tmp, "redirected.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/good.zip", sha256: GOOD_SHA },
    dest,
    shimFetch(port)
  );
  check("a redirect to an unlisted host is refused", result.ok === false && result.failure.reason === "blocked-host");
  check("...naming the host it refused", result.failure.host === "evil.example.com");
  check("...and nothing was written", !existsSync(dest));
  await close();
}

// --- Attack: redirect downgrade to plain HTTP ------------------------------
{
  const { port, close } = await serve((req, res) => {
    res.statusCode = 302;
    res.setHeader("location", "http://codeberg.org/payload.zip");
    res.end();
  });
  const dest = path.join(tmp, "downgraded.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/good.zip", sha256: GOOD_SHA },
    dest,
    shimFetch(port)
  );
  check("a redirect that downgrades to HTTP is refused", result.ok === false && result.failure.reason === "insecure-scheme");
  await close();
}

// --- Attack: redirect loop -------------------------------------------------
{
  const { port, close } = await serve((req, res) => {
    res.statusCode = 302;
    res.setHeader("location", "https://codeberg.org/loop.zip");
    res.end();
  });
  const dest = path.join(tmp, "loop.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/loop.zip", sha256: GOOD_SHA },
    dest,
    shimFetch(port)
  );
  check("an endless redirect loop terminates rather than hanging", result.ok === false && result.failure.reason === "too-many-redirects");
  await close();
}

// --- A legitimate redirect within the allowlist still works ----------------
// The point is to check hops, not to ban them — CDN handoffs are normal.
{
  const { port, close } = await serve((req, res) => {
    if (req.url === "/start.zip") {
      res.statusCode = 302;
      res.setHeader("location", "https://objects.githubusercontent.com/real.zip");
      res.end();
      return;
    }
    res.setHeader("content-length", String(GOOD.length));
    res.end(GOOD);
  });
  const dest = path.join(tmp, "cdn.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/start.zip", sha256: GOOD_SHA },
    dest,
    shimFetch(port)
  );
  check("a redirect between allowlisted hosts is followed normally", result.ok === true);
  await close();
}

// --- Size pre-check fails fast --------------------------------------------
{
  const { port, close } = await serve((req, res) => {
    res.setHeader("content-length", "999999");
    res.end(GOOD);
  });
  const dest = path.join(tmp, "wrongsize.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/good.zip", sha256: GOOD_SHA, bytes: GOOD.length },
    dest,
    shimFetch(port)
  );
  check("a wrong declared size is rejected before the body is written", result.ok === false && result.failure.reason === "size-mismatch");
  check("...and no file is left behind", !existsSync(dest));
  await close();
}

// --- Server errors ---------------------------------------------------------
{
  const { port, close } = await serve((req, res) => {
    res.statusCode = 503;
    res.end("down");
  });
  const dest = path.join(tmp, "err.zip");
  const result = await downloadVerified(
    { version: "v1", url: "https://codeberg.org/good.zip", sha256: GOOD_SHA },
    dest,
    shimFetch(port)
  );
  check("an HTTP error is reported cleanly rather than throwing", result.ok === false && result.failure.reason === "http-error");
  await close();
}

// --- The updater only installs versions HARE has approved -----------------
// Even a perfectly valid, correctly-signed release that HARE hasn't verified
// must not be installed automatically. This is what stops the API dictating
// what runs.
{
  const src = await import("node:fs").then((m) =>
    m.readFileSync("electron/backend/deviceDatabase.ts", "utf8")
  );
  check(
    "the updater resolves what to download from its own approved list",
    src.includes("approvedBuildFor(this.latestVersionTag)")
  );
  check(
    "an unapproved version is refused with an explicit error",
    src.includes("isn't a build HARE has verified yet")
  );
  check(
    "the API's own download URL is never used",
    !src.includes("browser_download_url")
  );
  check(
    "the unchecked downloader is gone entirely",
    !src.includes('redirect: "follow"')
  );
  check(
    "the approved-build list is generated, not hand-maintained",
    src.includes("generated/openrgbBuilds.js")
  );
}

// --- sha256File is actually SHA-256 ---------------------------------------
{
  const f = path.join(tmp, "known.bin");
  writeFileSync(f, "abc");
  check(
    "sha256File matches the known SHA-256 of 'abc'",
    (await sha256File(f)) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
}

rmSync(tmp, { recursive: true, force: true });

console.log("");
if (failures > 0) {
  console.error(`ALL_DOWNLOAD_INTEGRITY_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_DOWNLOAD_INTEGRITY_CHECKS_PASSED");
