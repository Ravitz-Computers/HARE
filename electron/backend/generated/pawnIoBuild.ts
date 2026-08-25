// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Produced by scripts/pawnio-manifest.mjs, which computes the digest below
// from the real published bytes. This artifact installs a kernel driver, so
// a hand-written hash here would be the most dangerous kind of check: one
// that looks enabled while verifying nothing.
//
// Regenerate with:  npm run pawnio:manifest
//
// With no entry here HARE cannot install PawnIO at all -- it can still detect
// an install the user did themselves, which is the safe default.
import type { PinnedArtifact } from "../verifiedDownload.js";

export const APPROVED_PAWNIO_BUILDS: PinnedArtifact[] = [
  {
    "version": "bundled",
    "url": "file://vendor/pawnio/PawnIO-Setup.exe",
    "sha256": "1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032",
    "bytes": 3410960
  }
];
