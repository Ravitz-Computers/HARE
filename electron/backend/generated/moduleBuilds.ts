// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Produced by scripts/module-manifest.mjs, which computes every digest below
// from the real published bytes. Modules are native code HARE loads into its
// own process, so a hand-maintained hash here would be an even worse idea
// than elsewhere: it is a check that looks enabled while doing nothing.
//
// Regenerate with:  npm run modules:manifest
//
// A module with no entry here cannot be installed, whatever the UI offers.
// An empty list means no downloadable modules shipped with this build, which
// is a safe state rather than a broken one.
import type { PinnedArtifact } from "../verifiedDownload.js";

export interface ApprovedModule extends PinnedArtifact {
  id: string;
}

export const APPROVED_MODULES: ApprovedModule[] = [];
