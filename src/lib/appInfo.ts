/**
 * Who made HARE, where it lives, and which build this is — in one place, so
 * nothing that shows any of it can disagree with anything else.
 */

export { BUILD_STAMP } from "../../electron/backend/generated/buildStamp";

/**
 * The exact version, from package.json.
 *
 * Generated rather than typed here: it used to be a hand-kept copy, which is
 * a string that is wrong the first time anyone forgets.
 */
export { APP_VERSION } from "../../electron/backend/generated/buildStamp";

/**
 * What that version is called out loud.
 *
 * `1.0.0-beta.4` is what the packaging tools need; "Beta 4" is what it is.
 * Derived rather than written twice, so bumping package.json is the only
 * thing anyone has to do.
 */
export function releaseName(version: string): string {
  const beta = /-beta\.(\d+)$/.exec(version);
  if (beta) return `Beta ${beta[1]}`;
  const rc = /-rc\.(\d+)$/.exec(version);
  if (rc) return `Release Candidate ${rc[1]}`;
  return version;
}

/** Ravitz Computers. */
export const COMPANY = {
  name: "Ravitz Computers",
  website: "https://ravitzcomputers.com",
  email: "support@ravitzcomputers.com",
} as const;

/**
 * What every copy of HARE says before it is used for the first time.
 *
 * Kept here as one string so the first-run screen and Settings > About can
 * never drift into saying two different things, and so a test can assert it
 * is actually shown rather than quietly dropped in a redesign.
 *
 * The MIT licence in LICENSE is the operative disclaimer; this is the plain
 * sentence a person will actually read, in the two places they will see it.
 */
export const RISK_NOTICE =
  "HARE talks to your hardware directly. It's provided as-is, with no warranty — " +
  "Ravitz Computers isn't responsible for any damage to your devices.";

/** Where HARE itself lives. */
export const PROJECT_URL = "https://github.com/Ravitz-Computers/HARE";

/** Where a problem gets reported so it's tracked rather than lost in an inbox. */
export const ISSUES_URL = `${PROJECT_URL}/issues`;

/**
 * OpenRGB's source. HARE redistributes an unmodified OpenRGB binary, and
 * GPL-2.0 requires that the corresponding source be made available to anyone
 * who receives it — this link is how HARE does that, so it must stay
 * reachable. See LICENSE-NOTES.md.
 */
export const OPENRGB_SOURCE_URL = "https://gitlab.com/CalcProgrammer1/OpenRGB";
