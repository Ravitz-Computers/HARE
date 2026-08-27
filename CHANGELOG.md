# Changelog

Notable changes to HARE. Dates are the release date; versions follow
[semantic versioning](https://semver.org), and pre-releases are named the way
they're spoken about — `1.0.0-beta.1` is "Beta 1".

## 1.0.0-beta.2 — Beta 2

What changed since the Beta 1 test builds.

### Fixed

- **Resizing a widget did nothing.** The size control was a popover *inside* the layout preview, and
  that preview clips its contents — on a one-cell widget the panel was about ninety pixels wide with
  half of it off the edge. The dropdowns inside it may never have opened either: a native `select`
  inside a draggable element frequently refuses to open in Chromium. Size and colour now live below
  the preview, where there is room, and size is a −/+ stepper.
- **HARE's effects painted on top of the board's own.** On ASRock Polychrome boards, firmware modes
  worked and HARE's effects came out wrong — both were running at once, drawing to the same LEDs.
  HARE asked to be given the LEDs using the OpenRGB request that asks the *controller* which of its
  modes is the direct one; a controller that doesn't answer accepts that request and changes nothing.
  HARE now picks the direct mode itself and switches into it. (Setting the board to Off isn't the
  answer — that stops the output too, so HARE's colours go nowhere either.)
- **"No background" showed a dark rectangle.** Making the window transparent is only half of it; the
  page still painted. `body` carries an opaque colour and two radial gradients, so the screen looked
  exactly as before. Every layer between the desktop and the cards is cleared now.
- **The installer wouldn't build.** `publisherName` was at the root of `electron-builder.yml`, where
  it isn't an option — and electron-builder validates its config *after* everything is built, so it
  died ten minutes in. The config is now checked against electron-builder's own schema in about a
  second, before the slow part.
- **The build script wouldn't parse on Windows.** One em dash. PowerShell 5.1 reads a `.ps1` as the
  system code page unless the file has a byte-order mark, so three UTF-8 bytes arrived as mojibake,
  ended a string early, and took the rest of the file with it. Those files are ASCII-only now, the
  PowerShell carries a BOM, and the script is actually parsed as part of the test suite.
- **MSI Mystic Light reported success when every write had failed.** It counted attempts and threw
  the SDK's return code away.
- Effects that need something from outside HARE — the keyboard hook, screen capture, system audio —
  used to fail into silence. The input hook had recorded exactly why since the day it was written;
  nothing ever read it. All three now say what was refused, on the effect itself.
- Music Reactive froze when HARE was minimised to the tray, because its capture loop runs on
  `requestAnimationFrame` and Chromium doesn't fire that for a hidden window.

### The second screen

- **It arranges itself.** Tap Edit on the screen and drag widgets, resize them and recolour them
  there, without walking back to the PC. **Lockable** from HARE's own window — the switch is never on
  the screen itself, so a panel anyone can reach can't unlock itself.
- Its own taskbar button, its own name and its own badge, rather than a second entry under HARE that
  reads as a dialog somebody left open.

### Getting unstuck

- **Restart OpenRGB**, in Settings → Hardware. OpenRGB can end up connected but no longer responding,
  and until now the only way out was closing HARE and finding OpenRGB.exe in Task Manager. It handles
  the three cases separately and says which one it was in: HARE's own server is stopped and started,
  an elevated one is restarted through its logon task, and an OpenRGB you're running yourself is left
  strictly alone. Your saved lighting is reapplied either way.
- **Report a Bug**, in Settings → About. Writes the email for you, offers to include your system
  details, and tells you how to attach a log.

### Starting up

- HARE starts with Windows by default, and starts **into the tray** when Windows is the one starting
  it. Opening HARE yourself always shows a window — an app that appears to do nothing when you click
  it is broken, whatever a setting says.

### Signing

- The build signs the installer when a certificate is configured, and refuses to finish if signing was
  configured and didn't happen — a build that quietly ships unsigned is the one failure nobody catches
  until it's published. Azure Artifact Signing, a certificate file, one on a hardware token, and
  SignPath are all supported; see `SIGNING.md`.
- This release is **unsigned**. Windows will warn the first people who run it. Every release carries a
  Sigstore build attestation and a SHA-256 checksum in the meantime.

### Honesty

- Vendor integrations that have never been run against the real software are marked **Untested**
  rather than showing the same confident green badge as the one that has.
- Controls that could never succeed are gone rather than greyed out: the Community Widgets panel, and
  the add-on module Install buttons.
- [`docs/STATUS.md`](docs/STATUS.md) says what works, what's unproven, what's degraded and what isn't
  built, and the README links to it.

## 1.0.0-beta.1 — Beta 1

Never released. Builds carrying this version were test builds, and the list
below is the baseline Beta 2 builds on.

HARE running against real hardware — an ASUS motherboard with an ARGB header,
a bundled OpenRGB, PawnIO — rather than only against simulated devices.
Everything below is there because something on a real PC needed it.

### One installer

- `HARE-Setup-1.0.0-beta.1.exe` is the whole product. It carries HARE,
  OpenRGB, the Microsoft Visual C++ runtime OpenRGB needs to start at all, and
  the PawnIO driver for motherboard and memory lighting. Nothing is downloaded
  on the user's PC and there is no second step.
- The build refuses to package an installer that is missing any of those. An
  installer that quietly leaves one out installs perfectly and then finds no
  hardware, which is indistinguishable from HARE being broken.
- A branded wizard: welcome page that says what else is being installed, the
  licence, a choice of location, live progress, and a finish page that opens
  HARE.

### Lighting

- Effects, per-device and per-zone colour, layered effects, and a Gallery of
  saved looks that can be exported and shared as files.
- **Addressable headers.** A motherboard can't count the LEDs on a strip you
  plug into it, so those zones report zero and everything written to them goes
  nowhere. HARE now asks how long the strip is, defaults to 8, and remembers
  it. This was the cause of "the app says it worked and nothing lights up".
- Per-LED painting survives a restart and can be saved to the Gallery.
- Vendor software (Razer Chroma and friends) appears as ordinary devices, so
  effects, looks and the second screen all reach it.

### The second screen

- Any spare monitor becomes a touch panel: clock, lighting, sensors, quick
  controls, saved looks.
- Widgets can be dragged, resized from 1×1 to 4×3, and given their own colour.
  The editor draws the real widgets rather than placeholder boxes.
- The background can be HARE's own, a flat colour, a picture, or nothing at
  all — which makes the window transparent so the desktop shows through.
- Cooler and case screens take an image, a GIF, or a **live temperature
  readout**, which is the main reason to own one.

### Sensors

- Temperatures, load and fan speeds from the processor, memory, graphics card
  and AIO cooler, with LibreHardwareMonitor and HWiNFO picked up when present.
- Settings → Hardware → System Sensors says what each missing source needs.

### Under it

- One permission prompt, once, at install — not at every launch.
- A diagnostic log that is off by default, deletes itself after three days,
  and never leaves the PC.
- Every action that reaches hardware now says whether it worked. Silence after
  a click was how a completely dead write path looked identical to a working
  one for three releases.
- Uninstalling removes everything HARE created and nothing it didn't.
