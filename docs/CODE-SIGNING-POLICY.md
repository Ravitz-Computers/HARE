# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

This page says who can cause a signed HARE to exist, how one is made, and what
you can check for yourself. It is deliberately specific: a signature is only
worth what the process behind it is worth.

## Who

| | |
| --- | --- |
| Project | HARE (Hardware Adaptive RGB Engine) |
| Publisher | Ravitz Computers |
| Repository | <https://github.com/Ravitz-Computers/HARE> |
| Author and approver | Avrumi Ravitz — support@ravitzcomputers.com |
| Contributors | Pull requests are reviewed before merge; no contributor can trigger a signing request |

## The signing key

- The private key is held in **SignPath's hardware security module**. It is
  generated there and cannot be exported.
- **Nobody on this project has a copy**, and no build machine ever sees one.
  There is no `.pfx` anywhere in this repository, in CI, or on a developer's
  PC — `.gitignore` and `test/verify-release-hygiene.mjs` both enforce that no
  certificate or key material is ever committed.
- **Every signing request is approved by hand** by the person named above.
  Nothing signs automatically on a push.

## How a release is made

1. A version tag (`v*`) is pushed to the repository.
2. GitHub Actions runs the release workflow (`.github/workflows/release.yml`)
   on a clean Windows runner: typecheck, lint, the full test suite, then the
   build.
3. Every third-party payload the installer carries — OpenRGB, the Microsoft
   Visual C++ runtime, the PawnIO driver — is fetched and **verified against a
   pinned SHA-256** before it is packaged. No digest in this project is ever
   written by hand; they are computed from the real bytes at build time.
   The build refuses to produce an installer with any of them missing.
4. The unsigned installer is submitted to SignPath, which **verifies that it
   originated from this repository's workflow** before it will sign anything.
5. The signing request is approved manually.
6. The signed installer is checksummed and attested, then published.

The order matters and is enforced: the SHA-256 and the build attestation are
both produced **after** signing, because signing rewrites the file. Anything
measured before it would describe bytes nobody downloads.

## What you can verify

Every release publishes `SHA256SUMS.txt` alongside the installer, and a
[Sigstore](https://www.sigstore.dev/) build attestation proving the file came
from this repository's workflow at a specific commit:

```
gh attestation verify HARE-Setup-<version>.exe --repo Ravitz-Computers/HARE
```

Windows does not read that attestation — it does nothing for SmartScreen — but
it is a stronger claim than a signature alone, because it ties the binary to
the source it was built from rather than only to a publisher.

## Privacy

HARE collects nothing and sends nothing anywhere.

- No telemetry, no analytics, no account, no phone-home.
- The diagnostic log is **off by default**, is written only to your own AppData
  folder, deletes itself after three days, and only ever leaves your PC if you
  attach it to an email yourself.
- The bug reporter opens **your** email program with a message you read and
  send. System details are included only if you tick the box, and you can see
  every line before it goes.

## Reporting a problem with a signed build

If a signed HARE binary looks wrong to you — an unexpected signature, a
checksum that doesn't match, a build you can't tie back to a commit — email
support@ravitzcomputers.com rather than opening a public issue. See
[`SECURITY.md`](../SECURITY.md).
