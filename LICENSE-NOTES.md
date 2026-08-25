# Licensing notes

Plain-English notes on how HARE is licensed and what that means if you publish
or distribute it. Not legal advice — nobody here is a lawyer, and if HARE is
ever distributed commercially or at scale it's worth having a real one read
this. It is, however, an accurate description of what's in the project and
what the licenses involved actually ask for.

## The short version

- **HARE's own code is MIT.** Permissive, open source, and it disclaims all
  warranty and liability. See `LICENSE`.
- **HARE bundles OpenRGB, which is GPL-2.0.** That's the one component with
  real conditions attached to redistributing it. Everything needed to comply
  is already in the repo; the details are below.
- **Everything else HARE ships is permissive** (MIT, BSD, ISC, OFL). Those
  licenses ask only that their copyright and permission notices travel with
  the software, which is what `THIRD-PARTY-NOTICES.md` is for.
- **Several things HARE uses are never shipped at all** — the PawnIO driver,
  the graphics vendors' own libraries, and the hardware monitors HARE can read
  from. Nothing HARE distributes contains them, so no obligation attaches, but
  they're all listed in `THIRD-PARTY-NOTICES.md` under "Software HARE uses but
  does not ship" so the question "what is this made of" has a complete
  answer.

## OpenRGB and the GPL

This is the part worth understanding properly.

HARE does not talk to RGB hardware itself. It launches
[OpenRGB](https://openrgb.org/) as a **separate background process** and talks
to it over OpenRGB's own documented TCP network protocol (the OpenRGB SDK).
`electron-builder.yml` copies a portable OpenRGB build into the installer, so
**a HARE release redistributes an OpenRGB binary**.

Two separate questions follow from that, and they have different answers.

### 1. Does HARE itself have to be GPL?

The prevailing reading is no, and that's the basis on which HARE is MIT.

HARE and OpenRGB are separate programs in separate processes that communicate
at arm's length over a documented network protocol. Under the usual
interpretation — including the Free Software Foundation's own guidance on
separate processes communicating by sockets and pipes — that's aggregation of
two works, not one derivative work, so HARE's own source can carry its own
license.

Be aware this is an interpretation, not a settled matter of decided law, and
the FSF words its position on "intimate" communication cautiously. HARE stays
comfortably on the safe side of the line: it uses only OpenRGB's public,
documented SDK protocol, ships an unmodified upstream binary, links no OpenRGB
code into its own process, and shares no internal data structures with it.

If you'd rather not rely on that reasoning at all, there's a clean way out —
see "If you'd rather not redistribute OpenRGB" below.

### 2. What does redistributing the OpenRGB binary require?

This part is not ambiguous. GPL-2.0 sections 1 and 3 apply to anyone
distributing the binary, and they require:

1. **Keep the copyright notices and ship the license.** The full GPL-2.0 text
   is at `licenses/GPL-2.0.txt`, and OpenRGB is credited in
   `THIRD-PARTY-NOTICES.md`.
2. **Make the complete corresponding source available.** A link to the
   upstream project is *not* one of the three things section 3 accepts, and
   it is not what HARE relies on. Two of the three are used, belt and braces:

   - **Section 3(a)** — the source archive matching the exact OpenRGB build
     inside the installer is attached to the same GitHub release as the
     installer, by the release workflow, using the version that was actually
     staged rather than one someone remembered to type.
   - **Section 3(b)** — the written offer below, which stands whether or not
     that release page still exists.

   If you ever ship a *modified* OpenRGB build, you must publish those exact
   modified sources yourself — neither of the above covers you then.
3. **Don't add restrictions.** You can't wrap the bundled OpenRGB in extra
   terms of your own.

### Written offer for source (GPL-2.0 section 3(b))

> For any binary of OpenRGB or PawnIO distributed as part of HARE, Ravitz
> Computers offers, valid for three years from the date that binary was
> distributed, to give any third party a complete machine-readable copy of the
> corresponding source code, on a medium customarily used for software
> interchange, for no more than the cost of physically performing the
> distribution.
>
> Write to **avrumi@ravitzcomputers.com**, saying which version of HARE you
> have — Settings → About shows it, or it's in the installer's filename.

This offer is shipped with every copy of HARE: `LICENSE-NOTES.md` is installed
alongside the app as a plain readable file, and its text is shown in
Settings → About.

Practically, for a GitHub release: keep `licenses/GPL-2.0.txt` and
`THIRD-PARTY-NOTICES.md` in the repo and in the installed app (both are
surfaced in Settings → About), attach the matching source archives, and state
in the release notes which OpenRGB version is bundled. The release workflow
does all three.

### If you'd rather not redistribute OpenRGB

Stop bundling the binary and have HARE use an OpenRGB the user installs
themselves. Remove the `vendor/openrgb` entry from `extraResources` in
`electron-builder.yml`; HARE already falls back to an honest "no devices
detected" state when it can't reach an OpenRGB server, so nothing breaks.

You'd then be distributing no GPL code at all, and section 3 wouldn't apply.
The cost is setup friction for the user, which is exactly what bundling was
meant to avoid — a real trade-off, not an obvious win either way.

## The artwork

Vinny the hare — the mascot on the app icon, the welcome screen and the
badge — and the Ravitz Computers medallion are **owned by Ravitz Computers**
and supplied for use in this program. They are not covered by the MIT license
on HARE's source: someone may take the code under those terms, but not the
character.

The artwork in `src/assets/vinny/` is the vector set supplied by Ravitz
Computers, unmodified. Every raster HARE ships — the app icon, the tray icon,
the installer panels — is drawn from those vectors by `scripts/build-art.mjs`
at build time rather than edited by hand, so the shipped images are always the
supplied artwork rather than someone's copy of it.

## Trademarks

"OpenRGB", "Razer", "Chroma", "Corsair", "iCUE", "Logitech", "ASUS", "Aura
Sync", "MSI", "Mystic Light", "NZXT", "Lian Li", "Thermalright" and other
product names are trademarks of their respective owners.

HARE is an independent project. It is not affiliated with, endorsed by, or
sponsored by any of these companies. Their names appear only to describe which
hardware and software HARE works with, which is ordinary descriptive use.

## Fonts

HARE bundles the Inter and Space Grotesk typefaces under the SIL Open Font
License 1.1 (`licenses/OFL-1.1.txt`), installed from npm as `@fontsource/*`.

They used to be loaded from Google Fonts over the network at runtime. That was
changed deliberately: a packaged desktop app hotlinking a font CDN makes a
third-party request on every launch that the user never agreed to (a point
European data-protection regulators have taken seriously), and it silently
degrades to fallback fonts with no internet. Bundling fixes both. The OFL
permits redistribution like this; it only forbids selling the fonts on their
own and requires the license travel with them.

## Vendor SDKs

HARE can optionally drive vendor software (Razer Chroma, Corsair iCUE,
Logitech G HUB, ASUS Aura Sync) through those vendors' own SDKs.

- The **Chroma** integration uses Razer's local REST API over HTTP. No Razer
  code ships with HARE.
- The **Corsair** and **ASUS** integrations depend on `cue-sdk` and `winax`,
  declared as **optional** dependencies. They're native modules that only
  build on their supported platforms, and HARE degrades gracefully when
  they're absent.
- Those SDKs talk to vendor software the **user** has installed, under
  whatever license that user accepted from the vendor. HARE redistributes no
  vendor runtime.
- The **MSI** and **SteelSeries** integrations work the same way — a DLL and a
  local HTTP API respectively, both belonging to software the user installed.

## Sensors, and the libraries HARE calls

HARE reads temperatures and load without shipping anything of its own:

- **NVML** (`nvml.dll`) and **ADL** (`atiadlxx.dll`) are installed by the
  user's NVIDIA or AMD graphics driver. HARE loads whichever is present and
  calls it. Nothing from either vendor is redistributed, and the call
  signatures were written from public API documentation rather than copied
  from an SDK header.
- **LibreHardwareMonitor** (MPL-2.0) and **HWiNFO** publish their sensor
  readings — to a WMI namespace and to the registry. HARE reads those when
  the user is already running either program. No code from either is used,
  linked or shipped; this is one program reading data another chose to
  publish, which carries no obligation. Both are credited anyway, because
  they are where HARE's CPU and fan readings actually come from.

## PawnIO

Microsoft blocklisted the **WinRing0** driver that most RGB and monitoring
tools used to reach the SMBus, and OpenRGB moved to **PawnIO** (GPL-2.0) from
1.0rc2 onward. On a current build, that driver is what makes motherboard and
RAM lighting work at all.

HARE does not bundle it, link against it, or call it — OpenRGB does. What HARE
does is detect whether it is installed and, when a build carries a verified
installer, download that installer from pawnio.eu and run it with the user's
consent.

**HARE now ships the installer**, rather than fetching it — because telling
someone their motherboard lighting needs a driver from a website they have
never heard of is not a working product. The build pins it by digest
(`scripts/pawnio-manifest.mjs`) and places it in the installer, so the copy
that ships is the copy that was verified.

That makes it redistribution of a GPL-2.0 work, and the obligations are the
same ones already documented above for OpenRGB, and met the same way:

1. **An unmodified upstream binary.** HARE ships the official signed installer
   exactly as published, and never a rebuilt one.
2. **The license travels with it.** `licenses/GPL-2.0.txt` already ships and is
   surfaced in Settings → About.
3. **Corresponding source is available**, from
   <https://github.com/namazso/PawnIO> and
   <https://github.com/namazso/PawnIO.Setup>. As with OpenRGB, shipping a
   *modified* build would mean publishing those exact modified sources
   yourself — the upstream link would stop being enough.

Nothing is installed silently: the driver's own installer runs, visibly, after
the user asks for it.

## Protocol descriptions

HARE's NZXT Kraken support — the screen, and now the liquid temperature and
pump speed the sensor layer reads — was written from **liquidctl**'s `kraken3`
driver, which is the community reference implementation for that protocol.
liquidctl is GPL-3.0.

No liquidctl code is copied or shipped. What was taken is the protocol
description: report ids, byte offsets and message sequences. Those are facts
about how a piece of hardware behaves rather than creative expression, and
facts aren't copyrightable — which is the reading HARE relies on, and the
same one every independent implementation of a hardware protocol relies on.

It is written down here for two reasons. It is a judgement rather than a
certainty, and a judgement nobody can see is one nobody can check. And the
work is genuinely owed to that project either way: without liquidctl's
reverse-engineering, none of HARE's cooler support would exist.

## Regenerating the notices

```bash
npm run notices
```

`THIRD-PARTY-NOTICES.md` is generated from the packages actually installed, so
it can't quietly drift out of date as dependencies change. Re-run it before
tagging a release. It exits non-zero if any dependency declares no license at
all, so that can't slip into a build unnoticed.

## Those npm deprecation warnings

`npm install` prints warnings about `inflight`, `glob@7`, `rimraf@2` and
`boolean`. They look alarming and are worth understanding rather than
ignoring, so:

**None of them ship in HARE.** Every one is a transitive dependency of
`electron-builder`, which is a **devDependency** — it builds the installer and
is never inside it. You can confirm that at any time:

```bash
npm ls inflight glob rimraf boolean --omit=dev   # all empty
```

**They aren't ours to upgrade.** Nothing in this project depends on any of
them directly; they arrive several levels down inside electron-builder's own
tree:

```
electron-builder → app-builder-lib → @electron/asar → glob@7 → inflight
electron-builder → app-builder-lib → …/electron-winstaller → temp → rimraf@2
electron-builder → app-builder-lib → @electron/get → global-agent → boolean
```

Forcing newer versions with npm `overrides` would be actively risky: `glob`
and `rimraf` both changed their APIs incompatibly at v9/v4, so pinning newer
ones would hand electron-builder's internals a library they weren't written
against — trading a cosmetic install-time warning for a packaging tool that
might break in non-obvious ways. `boolean` has no successor to move to at all.
The fix belongs upstream in electron-builder, and arrives when it upgrades.

`npm audit --omit=dev` reports one genuine finding in a shipped dependency:
`extract-zip`'s symlink path traversal, which has no upstream fix. HARE closes
it at the application level with `assertNoSymlinkEscapes()` in
`deviceDatabase.ts`, run immediately after every extraction and covered by
`test/verify-symlink-escape-guard.mjs`.
