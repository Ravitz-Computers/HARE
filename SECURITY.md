# Reporting a security problem

HARE installs a kernel driver, asks for administrator rights during
installation, and runs a background process that talks to your hardware. If
you find something that could be abused, please tell us before telling
everyone.

**Email:** support@ravitzcomputers.com
**Subject:** `[HARE-SECURITY]`

Please include what you found, how to reproduce it, and which version of HARE
(Settings → About). You'll get a reply within a week. If we agree it's a
problem, we'll tell you when a fix is out and credit you in the release notes
unless you'd rather we didn't.

Please don't open a public GitHub issue for anything that would give someone
else a working attack before there's a fix.

## What's in scope

- HARE itself, and the way it launches or talks to OpenRGB.
- The installer and uninstaller, including how the bundled driver and runtime
  are installed.
- The verified-download machinery (`electron/backend/verifiedDownload.ts`) and
  the digest-pinned manifests under `scripts/`.
- The IPC bridge between the window and the main process.

## What isn't

- Vulnerabilities in OpenRGB, PawnIO, Electron or Chromium themselves —
  report those upstream. If HARE ships an affected version, tell us as well
  and we'll update the pin.
- Anything that needs administrator rights to set up in the first place. A
  person who is already an administrator on the machine can do more than HARE
  can.

## What HARE does with your data

Nothing leaves your PC. There is no telemetry, no analytics, and no account.
The diagnostic log is off unless you turn it on, is written only to your own
AppData folder, deletes itself after three days, and is only ever shared if
you attach it to an email yourself.
