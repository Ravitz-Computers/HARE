# Contributing to HARE

Thanks for wanting to help.

## Reporting a bug

The fastest route is **Settings → About → Report a Bug** inside HARE. It writes
the email for you, offers to include your system details, and tells you how to
attach a log. Or open an issue at
<https://github.com/Ravitz-Computers/HARE/issues>.

Whatever route you take, the two things that make a report answerable are:

1. **The log.** Settings → General → Diagnostic Log, turn it on, make the
   problem happen again, then attach today's file from the logs folder.
2. **What OpenRGB does.** Settings → Hardware → "Lighting Not Changing?" opens
   OpenRGB's own window. If it can't change your lighting either, the problem
   is underneath HARE, which is a completely different fix.

Security problems go to support@ravitzcomputers.com instead — see
[SECURITY.md](SECURITY.md).

## Building it

```bash
npm install
npm run dev:electron    # Vite + Electron together, hot-reloading
```

To build the installer, on Windows, double-click `build.bat`. It fetches
everything and produces `release/HARE-Setup-<version>.exe`.

Before opening a pull request:

```bash
npm run typecheck
npm run lint
npm test
```

Run them separately — running them as one command has been known to run out of
memory.

## How the tests here work

There is no hardware in CI, so the test suite is not unit tests of pure
functions. Every file in `test/` starts with a comment saying **which real
failure it exists to catch**, and most of them exist because that failure
actually shipped. If you add one, write that comment. A test that can't fail
is worse than no test, because it reads as coverage.

The same goes for comments in the code: say what a thing is and why it is the
way it is, especially when the obvious approach was tried first and didn't
work. A lot of this codebase is one-line fixes with a paragraph above them,
and that paragraph is the valuable part.

## Copy

User-facing text says what something is and how to use it. It doesn't explain
why it works that way internally. The test is: *do I need to know this to use
the program?*

## The mascot

Vinny the Bunny and the Ravitz Computers medallion belong to Ravitz Computers
and are not covered by the MIT licence on the code. See
[LICENSE-NOTES.md](LICENSE-NOTES.md).
