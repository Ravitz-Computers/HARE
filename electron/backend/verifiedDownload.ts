import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Integrity-checked downloads.
 *
 * WHY THIS EXISTS
 *
 * HARE downloads OpenRGB and then *executes* it. Before this module, the
 * download URL was taken straight out of a third-party API response, fetched
 * with redirects followed to any host, unzipped, and run — with no hash
 * check, no signature, and no restriction on where the bytes came from. A
 * compromised release, a hijacked DNS answer, or a single malicious redirect
 * was therefore enough to run arbitrary code on every HARE machine.
 *
 * That was the single most serious issue in the codebase, and it gets worse
 * rather than better as dependency auto-update becomes a headline feature,
 * because it puts this path on the critical route for every user.
 *
 * The rule now: **HARE only installs bytes it can vouch for.** Concretely,
 * three independent gates, all of which must pass:
 *
 *   1. **Host allowlist.** The URL, and every URL it redirects to, must be
 *      HTTPS and on a known host. Redirects are followed manually so each hop
 *      is checked — `redirect: "follow"` hides them.
 *   2. **Known size.** A wildly wrong content length fails fast, before
 *      megabytes are written to disk.
 *   3. **Pinned SHA-256.** The finished file is hashed and compared against a
 *      digest HARE shipped with. A mismatch deletes the file and aborts.
 *
 * Gate 3 is the one that actually matters — 1 and 2 just fail faster and more
 * legibly. Together they mean a hostile server can at worst deny the update,
 * never substitute one.
 */

/** Hosts HARE will accept bytes from. Redirect targets are checked against this too, not just the initial URL. */
export const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = [
  "codeberg.org",
  "gitlab.com",
  "github.com",
  "objects.githubusercontent.com",
  // The PawnIO driver installer is published here. Every download is still
  // pinned to a digest generated from the real bytes, so this widens where a
  // verified artifact may come from — never what may be run unverified.
  "pawnio.eu",
];

/** Redirect hops to follow before giving up — enough for normal CDN handoffs, few enough to bound a redirect loop. */
const MAX_REDIRECTS = 5;

export type VerifyFailure =
  | { reason: "blocked-host"; host: string }
  | { reason: "insecure-scheme"; scheme: string }
  | { reason: "too-many-redirects" }
  | { reason: "http-error"; status: number }
  | { reason: "size-mismatch"; expected: number; actual: number }
  | { reason: "hash-mismatch"; expected: string; actual: string }
  | { reason: "network"; detail: string };

export type VerifiedDownloadResult = { ok: true } | { ok: false; failure: VerifyFailure; message: string };

/** What HARE knows, in advance, about a build it is willing to install. */
export interface PinnedArtifact {
  version: string;
  url: string;
  /** Lowercase hex SHA-256 of the exact bytes. */
  sha256: string;
  /** Exact byte length, when known. Checked before hashing so a wrong file fails fast. */
  bytes?: number;
}

/** Human-readable explanation. Deliberately says what HARE did about it, since every one of these ends in "nothing was installed". */
export function describeFailure(failure: VerifyFailure): string {
  switch (failure.reason) {
    case "blocked-host":
      return `The download pointed at an unexpected server (${failure.host}), so it was refused. Nothing was installed.`;
    case "insecure-scheme":
      return `The download wasn't over HTTPS (${failure.scheme}), so it was refused. Nothing was installed.`;
    case "too-many-redirects":
      return "The download redirected too many times, so it was refused. Nothing was installed.";
    case "http-error":
      return `The update server returned HTTP ${failure.status}. Nothing was installed.`;
    case "size-mismatch":
      return `The download was the wrong size (expected ${failure.expected} bytes, got ${failure.actual}), so it was discarded. Nothing was installed.`;
    case "hash-mismatch":
      return "The download didn't match its expected fingerprint, so it was discarded. Nothing was installed.";
    case "network":
      return `Couldn't reach the update server: ${failure.detail}`;
  }
}

/** Whether a URL is one HARE will fetch from at all. */
export function isAllowedDownloadUrl(rawUrl: string): VerifyFailure | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { reason: "network", detail: "that isn't a valid address" };
  }
  if (parsed.protocol !== "https:") {
    return { reason: "insecure-scheme", scheme: parsed.protocol.replace(":", "") };
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return { reason: "blocked-host", host: parsed.hostname };
  }
  return null;
}

/** SHA-256 of a file on disk, lowercase hex. */
export async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

type FetchLike = (url: string, init?: { redirect?: "manual" | "follow" }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: unknown;
}>;

/**
 * Downloads `artifact.url` to `destPath`, checking every gate above.
 *
 * On any failure the partial file is deleted, so a rejected download can
 * never be mistaken for a good one by a later step.
 */
export async function downloadVerified(
  artifact: PinnedArtifact,
  destPath: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<VerifiedDownloadResult> {
  const fail = (failure: VerifyFailure): VerifiedDownloadResult => ({
    ok: false,
    failure,
    message: describeFailure(failure),
  });

  let url = artifact.url;
  let response: Awaited<ReturnType<FetchLike>> | null = null;

  // Follow redirects by hand so every hop is checked against the allowlist.
  // `redirect: "follow"` would silently land us anywhere.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = isAllowedDownloadUrl(url);
    if (blocked) return fail(blocked);

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(url, { redirect: "manual" });
    } catch (err) {
      return fail({ reason: "network", detail: err instanceof Error ? err.message : String(err) });
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return fail({ reason: "http-error", status: res.status });
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok || !res.body) return fail({ reason: "http-error", status: res.status });
    response = res;
    break;
  }

  if (!response) return fail({ reason: "too-many-redirects" });

  // Cheap pre-check: a wrong Content-Length means a wrong file, and there's
  // no point streaming megabytes to disk to discover that.
  if (artifact.bytes !== undefined) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 0 && declared !== artifact.bytes) {
      return fail({ reason: "size-mismatch", expected: artifact.bytes, actual: declared });
    }
  }

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(destPath)
    );
  } catch (err) {
    await rm(destPath, { force: true });
    return fail({ reason: "network", detail: err instanceof Error ? err.message : String(err) });
  }

  const actual = await sha256File(destPath);
  if (actual.toLowerCase() !== artifact.sha256.toLowerCase()) {
    // Delete before returning: a rejected file must never be left where a
    // later step could pick it up.
    await rm(destPath, { force: true });
    return fail({ reason: "hash-mismatch", expected: artifact.sha256, actual });
  }

  return { ok: true };
}
