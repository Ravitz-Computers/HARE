# HARE

**H**ardware **A**daptive **RGB** **E**ngine — one app for every RGB light in your PC.

Keyboard, mouse, motherboard, memory, fans, cooler, strips: one place to control all of it, instead of
four vendor apps that each want to own your machine. Built by
[Ravitz Computers](https://ravitzcomputers.com).

> **Beta 4.** HARE runs on real hardware and does what this page says it does. It is also new, and
> [`docs/STATUS.md`](docs/STATUS.md) says plainly which parts have been proven on real hardware, which
> have not, and what isn't built yet. Read it before deciding what to trust.

---

## Install

Download **`HARE-Setup-1.0.0-beta.4.exe`** from the
[latest release](https://github.com/Ravitz-Computers/HARE/releases) and run it.

That's the whole thing. One file. It contains HARE, [OpenRGB](https://openrgb.org/), the Microsoft Visual
C++ runtime OpenRGB needs, and the [PawnIO](https://pawnio.eu) driver that motherboard and memory lighting
goes through. Nothing else to download, nothing to configure, no second step.

The installer asks for administrator rights once, during installation. HARE itself never does — it starts
with Windows without a UAC prompt every time, because the one thing that needs elevation is set up at
install time instead.

**Requirements:** Windows 10 or 11, 64-bit.

---

## What it does

**Every light, one app.** HARE finds what's plugged in and groups it — motherboard, memory, cooling,
peripherals, lighting, audio — so a machine with thirty devices reads as easily as one with three.

**Effects that run across everything.** Rainbow wave, breathing, comet, fire, thermal, reactive,
music-reactive, ambient screen sync and more. Pick one, hit Sync All, and it flows across your whole PC at
once. Or stack several as layers on one device, with blend modes and a loop.

**Colours per zone, and per LED.** Whole device, one header, one stick of memory, or one LED at a time
with a painter you click. A painting is remembered and survives a restart.

**A gallery of looks.** Save how a device is lit, apply it to anything else, export it as a file and send
it to a friend.

**Your second monitor becomes a control panel.** Clock, live lighting, sensors, one-tap effects, saved
looks — laid out how you like, on a spare screen or a case panel. Widgets resize and take their own
colour; the background can be a picture, a colour, or nothing at all so your desktop shows through.

**Your cooler's screen shows something useful.** An image, a GIF, or a live temperature readout.

**Sensors.** Temperatures, load and fan speeds from the processor, memory, graphics card and cooler,
feeding the Thermal effect and the second screen. LibreHardwareMonitor and HWiNFO are picked up if you
already run them.

**It tells you the truth.** If nothing is detected, HARE says so and says why, with the next thing to try
— it never shows devices that aren't there. Nothing is uploaded anywhere. There's no account, no
telemetry, and the diagnostic log is off until you turn it on.

---

## How it works

HARE doesn't reimplement RGB protocols. It drives [OpenRGB](https://openrgb.org/) — a mature open-source
project that already speaks the native protocol for well over a thousand products across Corsair, Razer,
ASUS, MSI, NZXT, Logitech, Gigabyte and more — headlessly in the background. That's where essentially all
hardware support comes from, and it's why no vendor software has to be installed or running.

```
┌────────────────────────┐   TCP (localhost:6742)   ┌────────────────────────┐
│  HARE (Electron)       │ ── OpenRGB SDK protocol ▶│  OpenRGB --server      │
│  React UI + effects    │ ◀── device state/colors ─│  (headless, bundled    │
│  engine, main process  │                          │   inside HARE)         │
└────────────────────────┘                          └───────────┬────────────┘
                                                                │ native vendor
                                                                │ protocols / USB HID
                                                                ▼
                                                    Keyboards, mice, motherboards,
                                                    fans, coolers, memory, strips
```

Separately, HARE can drive some vendors' own *software* through their SDKs, for what OpenRGB can't reach
on its own — Razer Chroma over its local REST API, and five others. Only Chroma has been confirmed
working; the rest are marked **Untested** in Settings rather than presented as equals. See
[`docs/STATUS.md`](docs/STATUS.md).

### Addressable headers

A motherboard cannot count the LEDs on a strip you plug into an ARGB header, so OpenRGB reports those
zones as **zero LEDs** until something says how long the strip is. A zero-length zone accepts every colour
and lights nothing — the app looks like it's working and your fans stay dark.

HARE asks. On any motherboard with a resizable header there's an **Addressable Headers** panel, pre-filled
with 8 (one ARGB fan, and the length most bundled strips ship at), and it remembers what you set. This is
the single most common reason RGB software appears to do nothing.

### Device detection

Raw compatibility comes from OpenRGB. What HARE adds (`src/lib/deviceClassification.ts`) is presentation:

- **Motherboards** — headers are labelled as headers, with a note that everything on one physical header
  lights together and can't be split in software.
- **Memory** — sticks that share a vendor and name are grouped as a kit, with one click to match a colour
  across all of them, and no requirement that they always match.
- **Fans** — there is no "this is a fan" flag in OpenRGB. A fan on a motherboard header is part of that
  header's zone, and HARE says so rather than pretending otherwise. A real fan hub, AIO or standalone
  controller is its own USB device and gets full independent per-channel control.

---

## Building the installer

You only need this if you're distributing HARE or working on it. Everyone else just runs the `.exe`.

On Windows, double-click **`build.bat`**. It fetches Node.js, OpenRGB, the runtime and the driver into the
project folder, builds HARE, and produces `release/HARE-Setup-<version>.exe`. Then it tells you where that
file is and offers to install it on the build machine too. Safe to re-run.

The build **refuses to finish** if any payload is missing (`scripts/verify-bundle.mjs`). An installer that
quietly leaves one out installs perfectly and then finds no hardware, which is indistinguishable from HARE
being broken — that failure cost this project three releases, so it's now impossible to ship.

### Working on it

```bash
npm install
npm run dev:electron    # Vite + Electron together, hot-reloading

npm run typecheck
npm run lint
npm test
```

Run those three separately — as one command they have been known to run out of memory.

### How the tests work

There's no RGB hardware in CI, so these aren't unit tests of pure functions. Every file in `test/` opens
with a comment saying **which real failure it exists to catch**, and most exist because that failure
actually shipped: a `$false` that NSIS read as one of its own variables and broke three installer builds,
an em dash that made PowerShell fail to parse the entire build script, a wrapper that silently swallowed
every zone-resize call. The OpenRGB backend is verified against a byte-accurate fake server built from the
SDK's own parser, which is how a CJS/ESM import bug that would have made HARE unable to connect at all was
found.

If you add a test, write that comment. A test that can't fail is worse than no test, because it reads as
coverage.

---

## Project layout

```
build.bat                  Double-click entry point (Windows)
scripts/
  build.ps1                 The real build logic
  build-art.mjs             Draws every icon and installer panel from the Vinny vectors
  verify-bundle.mjs         Refuses to package an installer that's missing a payload
  stage-openrgb.mjs         Puts a digest-verified OpenRGB where the packager can find it
  *-manifest.mjs            Pins each fetched payload's digest at build time
electron/
  main.ts                  Main process: window, tray, IPC
  preload.ts               Sandboxed bridge exposed to the renderer as window.hare
  backend/
    types.ts                Shared types + IPC channel names (one source of truth)
    openrgbBackend.ts       Talks to a live OpenRGB SDK server
    compositeBackend.ts     Merges OpenRGB devices with vendor-software devices
    backendManager.ts       Picks a backend, owns the effect loop, restores saved lighting
    effectsEngine.ts        Pure colour maths for every effect
    sensors/                Temperature, load and fan sources
    displays/               AIO and case screens
    vendors/                Vendor software integrations
src/
  pages/                   Dashboard, DeviceDetail, Effects, Gallery, WidgetEngine, Settings
  dashboard/               The second screen
  components/              Shared UI, including Vinny
  assets/vinny/            The mascot, as vectors, in light and dark variants
build/                     Generated icons and installer artwork, plus installer.nsh
vendor/                    Fetched at build time, digest-pinned, never committed
test/                      Verification suites — see test/README.md
docs/STATUS.md             What works, what's unproven, what isn't built
```

---

## Reporting a problem

**Settings → About → Report a Bug** inside HARE writes the email for you, offers to include your system
details, and tells you how to attach a log. Or open an issue
[here](https://github.com/Ravitz-Computers/HARE/issues).

Two things make a report answerable:

1. **The log.** Settings → General → Diagnostic Log, turn it on, reproduce it, attach today's file.
2. **What OpenRGB does.** Settings → Hardware → "Lighting Not Changing?" opens OpenRGB's own window. If it
   can't change your lighting either, the problem is underneath HARE — a completely different fix.

Security problems go to support@ravitzcomputers.com — see [SECURITY.md](SECURITY.md).

---

HARE collects nothing and sends nothing anywhere. There is no telemetry, no account, and the
diagnostic log is off unless you turn it on and never leaves your PC.

---

## Licence

HARE's own source is **MIT** — see [LICENSE](LICENSE).

HARE bundles OpenRGB and PawnIO, both **GPL-2.0**, redistributed unmodified. Their licence texts install
alongside HARE and are shown in Settings → About; the corresponding source for the exact build inside each
installer is attached to that release, and a written offer of source stands for three years. See
[LICENSE-NOTES.md](LICENSE-NOTES.md) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Vinny the Bunny and the Ravitz Computers medallion belong to Ravitz Computers and are **not** covered by
the MIT licence. Someone may take the code under those terms; not the character.

---

<sub>HARE is not affiliated with, endorsed by, or sponsored by Corsair, Razer, ASUS, MSI, NZXT, Logitech,
SteelSeries, Lian Li, Thermalright, or any other manufacturer. Their names appear only to describe which
hardware and software HARE works with.</sub>
