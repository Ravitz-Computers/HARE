# Changelog

Notable changes to HARE. Dates are the release date; versions follow
[semantic versioning](https://semver.org), and pre-releases are named the way
they're spoken about — `1.0.0-beta.1` is "Beta 1".

## 1.0.0-beta.4 — Beta 4

### Fixed

- **There was no way to add a background picture.** The switch for the background layer was disabled
  until a picture existed, and the control for choosing one only appeared once the layer was on — so
  the switch said "choose one below" and there was nothing below. The chooser is always there now,
  with a thumbnail of what's set and a way to take it off, and choosing a picture turns the layer on.
- **HARE can't drive the Galahad II LCD (Vision), and now says so.** The cooler answers every screen
  command with the exact bytes it was sent and does nothing with them, and the same connection
  returns nothing at all when asked whether the screen is behind it. That reply reads as success from
  every angle, which is why "Reset to stock does nothing" took several rounds to pin down. HARE now
  recognises its own message coming back, says the screen isn't on a connection it can reach, and
  stops after three attempts instead of reopening the cooler every five seconds for the rest of the
  session.

### Added

- **Set every channel at once.** A fan controller's channels usually carry the same fans, so the same
  number went in eight times with a device re-read between each. One box now sets them all, offering
  only a number every channel will take.
- **HARE was talking to whichever part of the cooler Windows listed first.** These AIOs enumerate as
  several USB interfaces under one id — the pump and fans on one, the screen on another — and HARE
  opened the first one it found. When that isn't the screen there is no error: writes succeed, the
  cooler answers the handshake, and nothing appears on the panel, which looks exactly like a screen
  that ignores commands. HARE now asks each interface whether the screen is behind it and uses the
  one that says yes, writing every answer to the log. A cooler that doesn't answer the question is
  used as before, so nothing that works today can be broken by this.
- **Brightness and rotation sent the wrong kind of message.** Both used the command that announces an
  application is taking the panel over, rather than the one for adjusting a panel already being
  driven — so every drag of the brightness slider re-claimed the screen.
- **Firmware effects that need a colour ran with none.** Once modes started working, about half of
  them still appeared to do nothing: Spectrum Cycle and Rainbow Wave make their own colours and were
  fine, while Static, Breathing and Neon were set successfully and drew nothing. A mode says how many
  colours of its own it takes, and HARE was sending whatever the controller happened to report, which
  for those modes was none. They now get the colour that's already on the device.
- **Fan channels no longer get a length HARE guessed.** A hub channel's maximum is what the channel
  can drive, not what's plugged into it — 96 per channel across eight channels on a Uni Hub. Starting
  each one there lit every fan and made the device 768 LEDs, most of them nothing, so every effect
  was spread over four times the real length at four times the USB traffic. That's the "weird and
  choppy". Nothing can count a fan chain, so HARE doesn't try: a channel stays empty, the device page
  shows it, and one click there lights everything on every empty channel for anyone who'd rather not
  count.
- **A screen command the cooler ignores no longer reports success.** Taking the screen over and
  handing it back are one-way messages, and nothing was read back, so HARE said "Done." either way.
  On a Galahad II LCD (Vision) neither does anything — pictures land underneath the cooler's own
  display and Reset to stock changes nothing — and there was no way to tell whether the message was
  even arriving. HARE now waits for the panel's reply, writes it (or its absence) to the log, and
  says the screen didn't answer instead of claiming it worked. The picture is still sent either way.
- **Every firmware mode switched the fans off.** They stopped erroring and started working — as far
  as HARE could tell — while turning the lights off instead of changing them. A mode is set by
  sending the controller its whole description of that mode back, and two of its fields are the
  vendor's own effect number and the flags saying which of the other fields mean anything. Neither
  survives into HARE's own copy of a device, so they were being sent as zero, along with a brightness
  of zero. Every mode read as "vendor effect 0, brightness 0". HARE now keeps the controller's
  record exactly as it arrived and changes only what you changed.
- **A cooler screen's panel offered no controls at all.** Settings for a screen only exist once
  something is saved, so on a screen nobody has touched — which is every screen the first time it's
  opened — the panel read a setting that wasn't there and stopped rendering. React replaced it with
  an error card, and nothing appeared in the log, so it was reported once as the tab not opening and
  again as the screen having no controls.
- **The diagnostic log was blind to half of HARE.** It captured the main process, where the hardware
  messages come from, and nothing at all from the window. Anything that goes wrong while the
  interface is drawing goes wrong there, so a fault could be reported twice from two different
  symptoms with an empty log behind both. Warnings and errors from the window are now recorded,
  with the file and line they came from.
- **Every built-in mode on a Lian Li fan hub errored out.** All eighteen of them, with an offset
  error, on a hub whose lighting HARE could otherwise drive. The library HARE uses re-reads the whole
  device before it sends a mode change, so on a device its parser can't read, the mode change fails
  before a single byte reaches the hardware — the hub was fine, the read on the way in was not. HARE
  now builds and sends that message itself for those devices, from the mode it already has.
- **A fan channel's LED count started far too low.** A hub channel drives a chain of fans and reports
  nothing until it's told a length; starting it at eight — right for a motherboard ARGB header — lit
  about a third of the first fan and left the rest dark. Set to twenty-four it lit further along and
  stopped, which reads as the number meaning a position rather than a quantity. A channel now starts
  at what it can actually drive, the panel is titled Fan Channels rather than Addressable Headers on
  a hub, and it says that daisy-chained fans add up.
- **Readings on a cooler screen stopped updating and showed dashes.** Several parts of HARE ask to
  watch the sensors — the screen's own redraw, the Widgets & Screens panel, the sensor settings page,
  the dashboard widget — and closing any one of them switched sensor polling off for all of them.
  Nothing errored: the screen carried on being redrawn from readings that never changed again, until
  HARE was restarted.
- **A reading with no source now says so.** It used to draw a dash on the cooler, which across a room
  looks like a broken screen. The tick list marks what nothing is reporting and points at Settings →
  Hardware → System Sensors.
- **"Device 2 reported no colours back, so HARE can't tell whether the write took."** A warning about
  the device, caused by HARE: the check that reads a colour back went to the library rather than
  through the reader that can actually read that device, so it appeared after every successful colour
  change on a working fan hub.
- **"Couldn't communicate with OpenRGB — Invalid array length", and no devices at all.** Reported on
  an ASUS + Lian Li machine where OpenRGB's own window found everything. Nothing was wrong with the
  connection or the hardware: the JavaScript client HARE uses, `openrgb-sdk` 0.6.0, throws while
  *reading* the device list if any device reports a flag bit newer than the SDK's own tables. OpenRGB
  has moved on — zone flags now go to bit 24 where the SDK knows one, device flags to bit 25 where it
  knows nine, mode flags to bit 10 where it knows ten — and a zone whose size can be changed sets a
  bit that was enough to lose the entire device list. Any resizable ARGB header or fan hub does that.
  0.6.0 is the newest release, so HARE repairs the decoder at build time and ignores bits it has no
  name for instead of dying on them.
- **One unreadable device no longer costs every other device.** Devices are read one at a time now.
  If OpenRGB sends something HARE can't parse, that device is skipped and named in the log and the
  rest still appear — instead of a PC full of working hardware showing "0 devices detected". Two
  different parsing bugs produced exactly that in two builds; whatever the third one is, it costs one
  device.
- **And HARE now picks the OpenRGB protocol version that reads the most devices.** On a real machine
  the newest one read the motherboard and the graphics card and dropped a Lian Li fan controller,
  whose reply the parser walked off the end of. Two of three devices isn't success when the third is
  the one you were asking about, so HARE tries older versions and keeps whichever finds everything.
  Each older version is a strictly smaller reply — v5 adds zone flags, device flags and alternate LED
  names, v4 adds zone segments — and HARE reads none of those, so it costs nothing. Reconnecting
  never re-scans hardware, so it can't touch the SMBus either.
- **A screen HARE can't draw on now says which screen it is.** It used to render one anonymous line,
  so an owner of a Galahad II LCD reasonably concluded their screen wasn't detected at all. Name,
  resolution and USB id are all shown.
- **The installer's "Show details" pane was empty.** electron-builder silences every message before
  HARE's own install steps run, so the button opened an empty box. It now shows what setup is doing.
- **And HARE falls back to an older OpenRGB protocol when the newest one can't be read.** Each older
  version has strictly fewer fields, and HARE reads none of the ones that disappear, so this costs
  nothing anyone would notice. Only a parsing failure falls back — a server that isn't running is
  reported straight away rather than three times over.
- **That failure was reported as a connection problem.** It was retried four times and came back as
  "couldn't reach an OpenRGB server", which sent people looking for a network fault that didn't
  exist. Reading the device list is now a separate failure that says OpenRGB *was* reached and that
  its own window will still show the devices.

- **The driver installer sat on top of the finish page.** PawnIO's own window opened over HARE's
  installer and stayed there, so setup looked stalled and people closed the wrong window. It installs
  silently now, using `-install -silent` — the switch PawnIO's publisher declares in its own winget
  manifest, not a guessed one. If it doesn't take, setup opens the visible installer exactly as
  before.
- **An unattended install got no driver.** `winget install` skipped PawnIO entirely, so motherboard
  and memory lighting silently didn't work and nothing said why. It's installed now, the same as any
  other install.

### Added

- **A "Show details" button in the installer.** Setup installs OpenRGB, the Visual C++ runtime and a
  driver, and until now showed a bare progress bar while it did — electron-builder hides the log
  *and* the button that opens it. The log starts collapsed, so the wizard is as quiet as before for
  anyone who doesn't care, and completely open to anyone who does.
- **One awkward device no longer floods the log or breaks the buttons.** The direct reader only ran
  during a full device refresh; every other read of that device — after resizing a header, after
  changing a mode — went straight back to the library that can't read it and threw. One click on a
  hub with eight channels produced eight recovered rejections in the main process and a failed
  action. A device that has needed the direct reader once is now remembered and read that way from
  then on, re-reading never rejects, and automatic header sizing happens once per zone instead of on
  every refresh.
- **A header HARE can't read back after resizing is taken on trust.** It used to stay at zero, which
  meant the automatic sizing saw an empty zone and resized it again on every pass, for ever, while
  every colour written to it went into a zone HARE believed was empty.
- **A device reporting no LEDs is now told so**, rather than being written to. "Writing rgb(255, 46,
  122) to all 0 LEDs" appeared in a real log.
- **One cooler screen's controls can't take down the Widgets & Screens tab.** Each screen's panel is
  boxed in on its own and reports what went wrong in place, instead of the tab refusing to open.
- **A device openrgb-sdk can't read is now read by HARE directly.** Only that device, only after the
  library has already failed on it, and only when the failure is the parser losing its place — a
  timeout or a dropped connection gets nothing from a second parser. The reader trusts the length
  prefixes OpenRGB puts in front of variable-length blocks, which is the thing openrgb-sdk doesn't:
  it reads a zone's matrix dimensions and then reads that many values on trust, so a zone whose
  declared size and declared dimensions disagree walks it hundreds of bytes past the end and takes
  the whole device with it. Every read here is bounds-checked, and on a well-formed device the two
  parsers are asserted to agree field for field.
- **A cooler screen is now a background and readings, switched separately.** Either on its own, or
  readings drawn over a picture — they used to be mutually exclusive only because sending an image
  turned the readout off. The reading colour can be changed for pictures that white doesn't suit, and
  text over a picture gets a shadow so it stays legible on a pale one. The picture is cropped to the
  panel once, when it's chosen, rather than being decoded every few seconds forever.
- **Cooler screens can show up to four readings at once.** Tick what you want from CPU and GPU
  temperature, motherboard temperature, CPU and GPU usage, CPU speed, fan speed and the time, and the
  layout adjusts to how many are ticked. Choices are stored as what you asked for rather than as
  sensor ids, so a saved layout survives installing or stopping HWiNFO or LibreHardwareMonitor. The
  layout is horizontal bands rather than a grid, because several of these panels are round and a grid
  puts a tile where there is no glass.
- **Pictures can be sent to Lian Li AIO screens.** Galahad II LCD, Galahad II LCD (Vision) and the
  three HydroShift LCD variants take a still image, brightness and rotation, and there is always a
  button to hand the screen back to the cooler's own display. Animation isn't built yet and the app
  says so rather than sending one frame and calling it a GIF. Transcribed from
  `sgtaziz/lian-li-linux` (MIT); the protocol is written down in
  `docs/LIAN-LI-LCD-PROTOCOL.md` and checked packet by packet against a simulated cooler. Like the
  NZXT driver, it has not been run against the hardware itself.
- **Lian Li screens are detected.** Galahad II LCD, Galahad II Vision, HydroShift LCD (all three
  variants) and the UNI FAN TL LCD now appear in Widgets & Screens with their real names and
  resolutions instead of not appearing at all. HARE can't draw on them yet and says so rather than
  offering controls that would do nothing; `docs/LIAN-LI-LCD-PROTOCOL.md` has everything needed to
  add that.
- **HARE won't start a hardware scan while another RGB app is running.** Armoury Crate, RGB Fusion,
  Polychrome, iCUE and the rest drive motherboard, memory and GPU lighting over a bus that takes one
  program at a time — a second one scanning it can leave a controller in a bad state. That scan was
  already going to come back empty, so this costs nothing and replaces a blank device list with the
  name of the program to close. **Scan anyway** is right there if you disagree.
- **A plain notice on first run**, and again in Settings → About: HARE talks to hardware directly, is
  provided as-is, and Ravitz Computers isn't responsible for damage.

### Changed

- **Widget Engine is now "Widgets & Screens"**, which is what the tab actually holds — the second
  screen, and cooler and case displays.
- **Contact address.** Everything that shows an address — Report a Bug, Settings → About, the issue
  template, the GPL written offer of source, the security contact and the package metadata — now
  points at support@ravitzcomputers.com instead of a personal inbox. The address is checked in one
  place (`test/verify-release-hygiene.mjs`), so a stale copy can't survive in a corner of the app.

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
