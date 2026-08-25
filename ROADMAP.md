# HARE status and roadmap

An honest account of what works, what's built but unproven, and what isn't
built at all. Kept accurate deliberately — a roadmap that overstates what's
done is worse than no roadmap.

Windows-only by design for now. macOS and Linux are out of scope.

| | Meaning |
| --- | --- |
| ✅ **Verified** | Built, and exercised by automated tests against real or simulated protocol partners. |
| 🟡 **Unproven** | Built and protocol-tested against a simulator, but never run against the real hardware or vendor software. |
| ⬜ **Not built** | Doesn't exist yet. |

---

## ✅ Verified

All covered by `npm test` — twenty suites, none needing real hardware,
OpenRGB, or Windows.

- **OpenRGB device control** — discovery, per-device and per-zone colour,
  native modes, and the full mode/zone data model, against a simulated
  OpenRGB server built byte-for-byte from the SDK's own parser.
- **Connection resilience** — a dropped connection falls back to an honest
  "no devices" state rather than crashing or lying. Tested with a real TCP
  reset.
- **18 effects, layering and sequencing** — shape, range, determinism, blend
  modes, opacity, ordering, loop windows with wrap-around and crossfade.
- **Live-signal effects** — Screen Sync, Music Reactive, Reactive, and the
  per-device independence that replaced the old global override system.
- **Per-device persistence** — lighting survives a restart. Devices are keyed
  by a fingerprint that outlives OpenRGB's shifting ids, with an ordinal so
  identical RAM sticks don't collapse onto one preference. Restore runs once
  per device per session, so it never overwrites a fresh choice.
- **Elevated-helper setup** — the argument construction for the scheduled
  task, including the three nested layers of quoting, and the probe that stops
  HARE launching a second OpenRGB.
- **Download integrity** — the verified-download layer, tested by standing up
  servers that behave like real attacks: substituted bytes, redirects to
  unlisted hosts, HTTPS downgrades, redirect loops, wrong sizes.
- **Manifest automation** — every approved-build digest is generated from the
  real bytes at build time, never written by hand. Guarded by checks that fail
  the build if a hash literal, a placeholder, or a missing regeneration step
  creeps back in. See `SIGNING.md`.
- **Module manager** — optional vendor modules install and uninstall from
  Settings, downloaded on demand through the same verified path as OpenRGB
  and unpacked with the same symlink guard. Everything lives under HARE's own
  data directory, so uninstalling HARE removes it with no special-casing, and
  the installer stays small until modules are actually added.
- **Idle resource cost** — identical frames are never written to hardware, so
  a motionless effect costs one write rather than 30 a second. Renderer
  previews share one animation clock that stops entirely when the window is
  hidden, so a tray-minimised HARE does no preview work at all.
- **Renderer hardening** — new windows denied, navigation away from the app
  blocked, webviews refused, and a Content-Security-Policy that forbids inline
  script, plugins and framing (the looser dev policy is confined to unpackaged
  builds).
- **Device database updates** — including a symlink-escape guard covering a
  known unpatched vulnerability in `extract-zip`.
- **Second-screen dashboard** — a fullscreen touch panel on a monitor of the
  user's choosing: clock, live per-device lighting, one-tap effects and
  colours, saved looks, an ambient wash, and status. It runs the same renderer
  bundle behind a `#dashboard` route, so there is one build, one preload and
  one store, and it receives every state broadcast the main window does.
  Tested on the parts that only misbehave on someone else's machine: a saved
  monitor that has since been unplugged, and a settings file written by a
  different version.
- **System sensors, without a driver of our own** — CPU and memory load from
  Windows, GPU temperature/load/fan/power from the vendor's own library
  (NVML, ADL) installed with the graphics driver, liquid temperature and pump
  speed straight from the AIO, and everything a real hardware monitor sees
  borrowed from LibreHardwareMonitor or HWiNFO when the user already runs one.
  Nothing polls while nothing is watching, and one failing source can't take
  the snapshot down. Feeds the **Thermal** effect and the dashboard.
- **Vendor software as real devices** — Chroma, iCUE, G HUB, Aura, GameSense
  and Mystic Light now appear in the device list and are driven by the same
  effect runner as everything else, so effects, layers, saved looks,
  restore-on-boot and the second screen all work on them. Writes route by
  device id, tested against a fake OpenRGB backend and fake vendor clients so
  a frame can never land on the wrong source.
- **Rainbow as a colour** — not a separate effect: choosing it makes Breathing
  a rainbow breath, Comet a rainbow comet, and so on, for every effect that
  uses a colour. Verified across all of them at once.
- **One-time hardware permission** — asked on first run, remembered whichever
  way it's answered, and re-applied at every launch so granted really means
  granted. Never asked twice.
- **Screen Sync as real bias lighting** — the screen is sampled into a row of
  colours rather than averaged into one, so a strip shows the left of the
  picture on its left and a bright corner lights that corner instead of
  washing everything in the average. Single-LED devices still get one colour.
  Which monitor to follow is selectable.
- **A crash-isolated input hook.** The Reactive effect's global hook runs in
  its own process, because `uIOhook.start()` can `abort()` from native code
  where no try/catch can reach it — it has done exactly that here. A crash now
  costs the effect, not the app: HARE restarts it twice, then gives up and
  says why.
- **Music Reactive as a spectrum** — eight logarithmic frequency bands plus
  beat detection, so a strip shows bass at one end and treble at the other and
  flashes on the beat, instead of every LED pulsing with one loudness number.
  Single-LED devices keep the old behaviour.
- **Opt-in diagnostic logging** — off by default, written only to the user's
  own PC, deleted after three days, and removed entirely on uninstall. It
  captures what HARE already reports, so a problem on hardware nobody here can
  test against leaves evidence.
- **Vinny throughout** — the RGB badge is the app icon and the in-app mark,
  the outline variant is the tray icon (a detailed badge is unreadable at
  32px), the waving pose greets you on first run, and the Ravitz Computers
  medallion sits in About where authorship is actually being stated. Assets
  are cut from the character sheet by a script, not by hand.
- **Settings, Gallery, backup/restore, theming.**

## 🟡 Built but unproven on real hardware

Each of these is a **translation layer**: HARE's intent in one end, a
vendor's byte sequence or call shape out the other. Simulators verify HARE's
side completely; they cannot verify that the protocol description HARE was
written from matches the real firmware.

So a passing test here means: **if it misbehaves on real hardware, the fault
is in the protocol description, not in HARE's handling of it.**

| Integration | Simulated by | Still unknown |
| --- | --- | --- |
| **NZXT Kraken Z screens** | Fake HID + USB bulk endpoint, 38 checks | Whether liquidctl's protocol description holds for every firmware revision |
| **Razer Chroma** | A real local HTTP server | The port Synapse actually listens on (54235, then 1337), and the per-category effect body |
| **Corsair iCUE** | Fake `cue-sdk` module | Whether `cue-sdk` builds on the target machine |
| **Logitech G HUB** | Fake `koffi` binding | Which DLL name G HUB installs (HARE tries two) |
| **ASUS Aura Sync** | Fake `winax` COM automation | Whether winax marshals COM collection indexing as expected |
| **SteelSeries GameSense** | A real local HTTP server, plus a real coreProps.json | Which device categories a given GG install accepts |
| **MSI Mystic Light** | Fake `koffi` binding incl. BSTR/SAFEARRAY | Whether the SAFEARRAY layout holds across SDK versions |
| **Elevated OpenRGB task** | Recording command runner | Whether Task Scheduler accepts the task as constructed |
| **NVIDIA sensors (NVML)** | Unit conversions and call sequence under test | Whether this driver revision matches the published API |
| **AMD sensors (ADL)** | Unit conversions, both Overdrive generations | Which Overdrive call a given card actually answers |
| **AIO liquid temperature** | Crafted status reports, 6 checks | Whether liquidctl's byte offsets hold for every firmware |

**Proving these out**, in order of effort: install on a Windows machine with
the hardware; use Settings → Hardware → Modules → **Test** (a magenta flash);
for a Kraken, send a small still image first, with **Reset to stock** as the
undo. Failures name the step that failed, which maps onto one line in the
driver.

## ⬜ Not built

- **Now-playing, small games and a video player on the dashboard.**
  Now-playing needs Windows' media session API; the games and the player need
  no new plumbing, just writing. (System stats are done — see sensors above.)
- **CPU package temperature and case-fan RPM without help.** Those live behind
  ring-0 port I/O. HARE reads them through LibreHardwareMonitor or HWiNFO when
  either is running, and detects PawnIO — the driver OpenRGB itself moved to —
  but ships no kernel driver of its own and asks for no administrator rights
  at launch. That is a deliberate limit, not an oversight.
- **Thermalright screen control.** Detected with correct resolutions, but
  their panels use three transports, none of them the HID one already written.
- **Layout editor.** Drag-and-drop arrangement of a real desk setup.
- **A cooler screen shows one reading at a time.** The temperature readout
  draws a single number and a ring. Several readings at once, a graph over
  time, or a layout someone arranges themselves would all be better; this is
  the version that makes the screen useful rather than decorative.
- **Per-device vendor control.** A vendor is currently one device — "everything
  Chroma is driving" — because these SDKs accept writes to a category whether
  or not you own that hardware, and none of them will say what's actually
  connected. Listing five per-category devices would put hardware in the
  device list that may not exist, which is the fake-device problem HARE
  removed everywhere else. Per-key frames wait on an SDK that enumerates.
- **Community widgets.** The import button exists and deliberately declines: a
  widget is code HARE would run inside its own window. Before any of it can
  load, it needs a manifest describing what it does, a signature so a
  tampered file is refused, and a sandbox a widget cannot reach out of — no
  filesystem, no network, no IPC beyond a narrow read-only API. Until all
  three exist, importing does nothing, which is the correct behaviour rather
  than a limitation.
- **HARE self-update.** Deliberately deferred until code signing is in place —
  an unsigned auto-updater would reintroduce the exact risk the verified-
  download work just closed.
- **Code signing.** Documented and CI-ready — see `SIGNING.md`. Needs a
  SignPath Foundation application once the repo is public and has a release.

## Still missing, and worth saying plainly

> The user-facing version of this list is [`docs/STATUS.md`](docs/STATUS.md), which is what the README
> links to. Keep the two in step.

- **No per-app or per-game profiles, scheduling, hotkeys, multi-PC sync,
  third-party API, notifications, or smart-light support** (Hue, Nanoleaf,
  Govee, WLED). None of these have any code; they are listed so the absence
  is deliberate rather than discovered.

## Addressable headers

A motherboard cannot count the LEDs on a strip you plug into an ARGB header,
so OpenRGB reports those zones as **zero LEDs** until something tells it how
long the strip is. A zero-length zone accepts every colour and lights nothing.

HARE had no way to set that, which made a real ASUS PRIME H510M-A look
completely broken: HARE wrote to the board's two onboard LEDs, verified the
write came back correct, and left the header dark — while OpenRGB's own
window, which has a resize control, lit the same strip fine.

Device pages now show an **Addressable Headers** panel above everything else,
because no colour or effect chosen below it can show while a header is empty.
The length is remembered per device and re-applied on every connect, before
any saved lighting is restored — OpenRGB does not persist it.

## The PawnIO driver, installed with HARE

Motherboard and RAM lighting needs a signed kernel driver, and OpenRGB moved
to PawnIO for it. HARE ships that installer — digest-pinned at build time by
`scripts/pawnio-manifest.mjs` — and runs it **during HARE's own installation**,
where the installer is already elevated, so there is no second prompt and
nothing for the user to go and find.

The installer is packed, so which framework built it can't be read from the
file and the silent switch can't be known in advance. Each candidate
(`/quiet`, `/S`, `/VERYSILENT`) is therefore tried and then **checked** —
the driver either registered its service or it didn't. If nothing silent
works, it runs visibly rather than quietly doing nothing. A failure never
fails HARE's install: everything over USB works without it.

Uninstalling removes the driver **only if HARE installed it**. One the user
already had may be driving FanControl or a hardware monitor, and taking it
away would break them — "leave nothing behind" means nothing of ours.

## Where HARE installs, and why

The installer is **per-machine**: it puts HARE in Program Files and asks for
administrator rights once, at install time. That is the same trade made
everywhere else in this project — pay at install, so the app itself never
needs elevation to run.

Settings, the gallery, saved per-device lighting, installed modules and
diagnostic logs all live under the user's own `%APPDATA%\HARE` rather than
next to the executable, because Program Files is read-only for a standard
user. Writing there would put HARE straight back to needing administrator
rights on every launch.

## Privileges, startup and uninstall

HARE runs **unelevated**. It used to be marked `requireAdministrator`, which
prompted for UAC on every launch and silently broke launch-at-startup outright
— Windows will not auto-elevate an app from the Run key, so the registered
entry never usefully ran.

Nothing in HARE needs elevation. Only OpenRGB does, and only for SMBus
(motherboard and RAM), and HARE reaches it over a localhost socket where the
client's privilege level is irrelevant. So elevation is confined to **one
optional scheduled task** that starts OpenRGB at logon with highest
privileges, created from Settings → Hardware with a single UAC prompt, once.
Decline it and HARE still drives every USB device normally.

A scheduled task rather than a Windows service, deliberately: no service
binary, no SCM registration, no resident process of our own, and removal is a
single command.

Uninstall removes the task, the settings and gallery data, the cache, and the
Run-key entry — see `build/installer.nsh`.

## PawnIO, and why motherboard lighting may need it

Microsoft added **WinRing0** to its vulnerable-driver blocklist, and Defender
now flags it (CVE-2020-14979). That driver was how a long list of tools —
OpenRGB included — reached the SMBus. OpenRGB's answer, from 1.0rc2 onward,
was to move to **PawnIO**: a signed, open-source driver with modules for
SMBus, Super I/O and CPU registers.

So on a current build, PawnIO is what actually unlocks motherboard and RAM
lighting; the elevated OpenRGB task alone is no longer enough. HARE detects
whether it's installed and running, says what it unlocks, and — when a build
ships a verified installer — can fetch and run it, elevated and visibly, with
the digest generated at build time like everything else HARE downloads. It is
never installed silently.

The same driver would also unlock CPU package temperature and case-fan speeds.
HARE does not require it for either.

## Board and GPU makers

There is no module for ASRock, Gigabyte, Zotac or EVGA, and that's the right
answer rather than a gap. Their lighting runs over SMBus/I2C, which is
OpenRGB's home ground — it drives them directly with no vendor software
installed, which is strictly better than going through an SDK that needs the
vendor's app running.

Two real caveats, both surfaced in the app:

- **Their software actively breaks detection.** SMBus tolerates one program at
  a time, and a second can put a device into an invalid state rather than
  merely conflicting. HARE detects the common offenders and says so on My
  Devices — see `vendors/smbusConflicts.ts`.
- **GPU coverage is thinner than motherboard coverage.** OpenRGB's GPU
  support handles single-zone cards; multi-zone cards are often unsupported,
  and GPUs are the hardest RGB devices to reverse-engineer.

## Known constraints

- **Two programs can't drive one device.** iCUE, Armoury Crate, RGB Fusion,
  Polychrome, MSI Center, L-Connect, CAM or SignalRGB running will fight HARE
  for the same bus — and can stop devices appearing at all.
- **HARE's effects run while HARE runs.** Saved preferences restore them at
  startup; firmware modes survive independently.
- **OpenRGB's SDK port is unauthenticated by design.** Any local process can
  drive lighting while it's running. Keep it bound to `127.0.0.1`.
