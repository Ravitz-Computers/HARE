# What works, what doesn't

Beta 2 · `1.0.0-beta.2`

This page exists because "it's in the app" and "it works" are different claims, and a beta should be
honest about which one it's making. Four sections: proven, unproven, degraded, absent.

---

## Proven on real hardware

Each of these has a recorded failure behind it — something went wrong on an actual PC, was diagnosed, and
is now covered by a test.

- **Motherboard ARGB headers.** Found on a real ASUS board where a zero-length zone accepted every colour
  and lit nothing. HARE now asks how long the strip is, defaults to 8, and remembers it.
- **Driving OpenRGB.** Discovery, per-device / per-zone / per-LED colour, and native device modes, against
  a real bundled OpenRGB on a real machine.
- **The one-time hardware permission.** The scheduled task that gives OpenRGB SMBus access — the quoting
  bug that broke it was found on a real Windows PC, along with the misdiagnosis it caused.
- **Not fighting your own OpenRGB.** HARE checks the port before launching, so an OpenRGB you already run
  is neither duplicated nor killed. This one was your diagnosis, not ours.
- **Surviving an OpenRGB crash.** An unhandled socket error used to take the whole app down.
- **The installer.** Program Files, one permission prompt, the driver and runtime installed as part of it,
  and a single instance no matter how many times the shortcut is clicked.

## Proven against a byte-accurate simulator

Strong, but not the same as hardware. The fake OpenRGB server is built from the SDK's own parser, and it
caught a CJS/ESM import bug that would have left HARE unable to connect at all.

Effects and layering, saved looks, per-device persistence, the verified-download layer (digest pinning,
host allowlist, zip-slip guard), the second-screen dashboard, sensor degradation, and the installer script
itself.

---

## In the app, but never confirmed against the real thing

These have complete implementations. Nobody has watched them work.

| What | Why it's unproven |
|---|---|
| **NZXT Kraken LCD** — images, GIFs, brightness, orientation, the temperature readout | Every byte is transcribed from liquidctl's driver. It writes to the cooler's onboard flash. This is the highest-consequence untested path in HARE. |
| **AIO liquid temperature and pump speed** | Same source, same caveat — the byte offsets are read from a reference, not observed. |
| **Razer Chroma** | The SDK port is genuinely undocumented (HARE tries two), and the request body shape is the commonly-described one rather than a confirmed one. Marked **Untested** in Settings. |
| **Corsair iCUE, ASUS Aura, MSI Mystic Light, Logitech G HUB, SteelSeries GameSense** | Each has a real client. None has been run against the vendor's software. All marked **Untested**. |
| **NVIDIA and AMD sensors** | The library calls are right per the published API; whether they match your driver revision is unproven. |

Mystic Light additionally needs MSI Center running **and** HARE started as administrator, which HARE
deliberately never does on its own — so in normal use it will not connect.

Corsair iCUE and ASUS Aura need optional native modules that compile from source at install time. If they
didn't build on the machine that made your installer, those two report that the module isn't available and
there is currently no way to add it afterwards.

---

## Known-degraded

Real defects, stated rather than hidden.

- **Add-on modules can't be installed.** Settings → Hardware lists them and shows which are included, but
  no build ships a downloadable module yet, and the install-then-load path isn't finished. Rows say
  "Not in this build" rather than offering a button that can't succeed.
- **Device support doesn't update itself.** HARE checks whether a newer OpenRGB exists and will tell you,
  but this build can't fetch and apply it — the download is digest-pinned and no pin is approved. A newer
  HARE brings newer device support. Settings says exactly this instead of promising an automatic update.
- **Effects that need something from outside HARE can be refused.** Reactive needs a global keyboard hook;
  Ambient Glow needs screen capture; Music Reactive needs system audio. Security software blocks any of
  these. They used to fail into silence — the effect stayed selected and the lights just stopped. HARE now
  says which one was refused and why, on the effect itself.
- **Thermalright case screens are detected but can't be driven.** Their image transports aren't
  implemented. HARE shows the model and says so rather than offering controls that do nothing.
- **On a shared PC, uninstalling cleans one account.** HARE stores settings per user; the uninstaller
  removes the profile of whoever runs it. Another person's saved looks stay in their own AppData.
- **No video on cooler screens.** These panels don't accept it. Use a GIF.
- **Widget layouts are per-user.** The second screen shows the layout of whoever is signed in, not a
  layout the machine shares.

---

## Not built

No code, listed so the absence is deliberate rather than discovered.

Per-app or per-game profiles · scheduling · global hotkeys · multi-PC sync · a third-party API ·
smart lights (Hue, Nanoleaf, Govee, WLED) · macOS and Linux · HARE updating itself ·
community widgets · per-key control of vendor-software devices.

**Code signing** is the one worth calling out: this installer is unsigned, so Windows SmartScreen will
warn the first people who run it. The build is already wired for it — set a certificate's details as
environment variables and the next build is signed, with the build failing rather than quietly shipping
unsigned if signing was configured and didn't happen. What's missing is the certificate itself.
[`SIGNING.md`](../SIGNING.md) has both routes: Azure Artifact Signing at about $10 a month, or SignPath
Foundation free for open source. Until then every release carries a build attestation and a SHA-256
checksum, neither of which SmartScreen reads but both of which prove the download is genuine.

**Community widgets** were removed from Settings rather than left as a disabled button. A widget is code
HARE would run inside its own window, and before any of it can load it needs a manifest, a signature
check, and a sandbox it can't reach out of. Until all three exist, importing does nothing — which is
correct behaviour, not a limitation.

---

## Telling us

If something here is wrong in either direction — something marked unproven that works fine on your
machine, or something marked proven that doesn't — that's the most useful thing you can send.
**Settings → About → Report a Bug**, or
[open an issue](https://github.com/Ravitz-Computers/HARE/issues).
