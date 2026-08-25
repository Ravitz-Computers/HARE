# Changelog

Notable changes to HARE. Dates are the release date; versions follow
[semantic versioning](https://semver.org), and pre-releases are named the way
they're spoken about — `1.0.0-beta.1` is "Beta 1".

## 1.0.0-beta.1 — Beta 1

The first public build. HARE has been running against real hardware
(an ASUS motherboard with an ARGB header, a bundled OpenRGB, PawnIO) rather
than only against simulated devices, and everything below is there because
something on a real PC needed it.

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

### Signing

- The build signs the installer when a certificate is configured, and refuses to finish if signing was
  configured and didn't happen — a build that quietly ships unsigned is the one failure nobody catches
  until it's published. Azure Artifact Signing, a certificate file, one on a hardware token, and
  SignPath are all supported; see `SIGNING.md`.
- This release is **unsigned**. Windows will warn the first people who run it. Every release carries a
  Sigstore build attestation and a SHA-256 checksum in the meantime.

### Under it

- One permission prompt, once, at install — not at every launch.
- A diagnostic log that is off by default, deletes itself after three days,
  and never leaves the PC.
- Every action that reaches hardware now says whether it worked. Silence after
  a click was how a completely dead write path looked identical to a working
  one for three releases.
- Uninstalling removes everything HARE created and nothing it didn't.
