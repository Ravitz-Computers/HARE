# Testing HARE without Windows or real RGB hardware

`npm run test:openrgb` verifies HARE's real OpenRGB backend
(`electron/backend/openrgbBackend.ts`) against a lineup of simulated, real,
well-known RGB products — a Corsair keyboard with an actual LED matrix, a
multi-zone NZXT cooler, Corsair RAM, a Logitech mouse, an ASUS motherboard,
and a 3-fan NZXT hub — without needing Windows, a real OpenRGB installation,
or any physical hardware plugged in.

```bash
npm run test:openrgb
```

## How it works

HARE never talks to Windows APIs or vendor drivers directly — it only speaks
the OpenRGB SDK's TCP wire protocol (a 16-byte header + a binary
device/zone/mode payload) to whatever OpenRGB server is listening on
`localhost:6742`. That means the *real* code that needs testing —
`openrgbBackend.ts`'s parsing of devices, zones, modes, and its
color-setting calls — can be exercised completely independent of the OS or
the hardware, by speaking that same protocol from a small script instead of
a real OpenRGB binary.

- `fake-openrgb-server.mjs` is a minimal TCP server that speaks just enough
  of that protocol to report six simulated devices, with the field layout
  (mode flags, zone/matrix byte offsets, LED/color arrays) derived
  byte-for-byte from `openrgb-sdk`'s own parser
  (`node_modules/openrgb-sdk/dist/device.js`), not guessed.
- `verify-openrgb-backend.mjs` connects HARE's actual compiled
  `OpenRgbBackend` class to that server and asserts on the result: device
  names/vendors/types, zone and LED counts, the keyboard's matrix
  dimensions (including a couple of deliberately-missing keys, to prove
  gaps in a matrix are handled), which modes correctly support direct
  per-LED color vs. which don't, and that `setDeviceColor` /
  `setZoneColor` / `setLedColors` all succeed against real (simulated)
  devices — including pushing a full color frame across all 130 LEDs of
  the matrix keyboard.
- `run-openrgb-verification.mjs` just wires the two together: start the
  fake server, run the checks, tear the server down, exit with the
  verification's exit code either way.

This is also the same technique that caught a real, previously-undetected
bug in `openrgbBackend.ts` (a broken CJS/ESM import that meant HARE could
never have connected to real OpenRGB hardware — see the git history / the
main README for details): running the actual code against a real protocol
implementation catches bugs that reading the code, or the browser-only dev
fixture backend, cannot.

## Adding another simulated device

Add an entry to the `DEVICES` array in `fake-openrgb-server.mjs` (vendor,
device type number, zones, modes — see the existing entries for the shape)
and, if you want assertions on it specifically, add checks in
`verify-openrgb-backend.mjs`. No other wiring needed.

## `npm run test:manager` — Ambient Sync / Music Reactive / Reactive-effect wiring

```bash
npm run test:manager
```

`smoke-live-effects.mjs` exercises the live-signal effects — Screen Sync
(`ambient-sync`), Music Reactive (`music-reactive`) and Reactive — against
the real compiled `dist-electron/backend/` output, using `FixtureBackend` (a
`BackendManager.testBackend` override, dev/test-only — the real app never
constructs one) so it needs no real hardware, OpenRGB, screen capture, audio
device or Windows.

These three react to something happening outside HARE right now (your
screen, your audio, your keystrokes) rather than purely to elapsed time, so
each is fed by a module-level reporter in `effectsEngine.ts` — see its "Live
signals" section. Screen Sync and Music Reactive used to be global on/off
toggles in Settings, backed by an exclusive "override mode" that seized every
device at once and wiped whatever per-device effects were assigned; they're
ordinary per-device effects now, which is what this file's central check
guards: running Screen Sync on one device must leave an unrelated effect on
another device completely alone. It also covers the live signal actually
reaching the LEDs and updating when it changes, `isEffectActive()` being
accurate (it's what gates the screen sampler in `main.ts` and the renderer's
audio capture in `store.ts` — a wrong answer means either a dead effect or a
capture left running with nothing using it), out-of-range/NaN audio levels
being clamped rather than trusted across the IPC boundary, and a manual color
pick still taking a device back.

The Reactive effect's global-input-hook half of this wiring
(`electron/backend/inputHook.ts`, wrapping `uiohook-napi`) isn't covered
here — in this project's Linux dev sandbox, actually starting the hook
outside of a real X server hard-`abort()`s the whole process (X11-specific;
see the comment in `inputHook.ts`), which a plain Node script can't safely
work around. It was however verified manually end-to-end inside an actual
Electron window running under Xvfb: applying Reactive doesn't crash the
app, the idle glow renders, and the OS-level hook starts cleanly with no
warnings. That path needs real Windows for full confidence, same as
`openrgbBackend.ts` needs real OpenRGB.

## A second real bug this technique caught: the preload script never loaded

Testing the actual compiled output (rather than just reading the code) also
caught a second, much more serious pre-existing bug this same pass: HARE's
`package.json` sets `"type": "module"`, so `tsc` compiled
`electron/preload.ts` to a plain ESM `dist-electron/preload.js` — but
Electron's preload scripts load in a CommonJS-only context and can't run
ESM `import` syntax there. The failure was completely silent from the
app's point of view: Electron logs `Unable to load preload script ...
Cannot use import statement outside a module` and just... continues,
without `window.hare` ever existing. That meant the renderer silently fell
back to its browser/dev-only stand-in (`src/lib/browserBackend.ts`)
*every single time*, including in a fully packaged, working-OpenRGB build —
none of `main.ts`'s real backend, effects, or settings code was ever
actually reachable from the UI. Fixed by bundling `preload.ts` into a
self-contained CommonJS `dist-electron/preload.cjs` with esbuild (see
`scripts/build-preload.mjs`) instead of relying on `tsc`'s project-wide ESM
output for it. Confirmed fixed by running the real packaged app end-to-end
under Xvfb and watching real IPC data (an actual OpenRGB connection-failure
reason, a real Device Database status) reach the Settings page, instead of
the browser fallback's hardcoded placeholder values.

## A third real bug this technique caught: an ECONNRESET crashed the whole app

A real Windows run (reported by an actual user, not found in testing) threw
this on startup: `Uncaught exception: Error: read ECONNRESET at
TCP.onStreamRead (node:internal/stream_base_commons:218:20)`, and took the
entire Electron main process down with it. Root cause: `openrgb-sdk`'s
`Client` re-emits its underlying TCP socket's `"error"` event as its own
`"error"` event, and Node's `EventEmitter` treats an `"error"` event with no
listener as special — it throws as an uncaught exception instead of just
being silently dropped like any other unlistened event. `openrgbBackend.ts`'s
`connect()` retry loop created a `Client` and successfully connected it, but
never attached a listener for that client's `"error"` event — so a
connection that drops *after* a successful connect (OpenRGB closing,
crashing, a network hiccup) crashed the whole app instead of just failing
that one connection. This is distinct from the initial-connect-refused case
(`ECONNREFUSED` while no OpenRGB server is running yet), which was already
handled safely via `Client.connect()`'s own internal timeout race — that's
why this bug didn't show up during the normal "no OpenRGB installed" empty
path most testing exercises, only on a connection that was genuinely live
and then died.

Fixed with a permanent `client.on("error", ...)` handler
(`handleClientError` in `openrgbBackend.ts`) that reports a clean `"error"`
status instead of letting the event throw, plus `BackendManager` now
auto-falls-back to an honest "no devices detected" state — with the real
reason carried through to the UI — the instant that happens (`setBackend`'s
status listener in `backendManager.ts`), instead of leaving the app stuck
silently reporting a dead connection until restarted. `main.ts` also gained
process-wide
`uncaughtException`/`unhandledRejection` handlers as a last-resort safety
net, so any *other* unforeseen error of this shape logs instead of crashing.

This was reproduced for real, not just patched and hoped: two new regression
tests, `verify-openrgb-error-recovery.mjs` and
`verify-manager-error-recovery.mjs`, connect a real `OpenRgbBackend` (and,
one layer up, a real `BackendManager`) to a real TCP server, then call
`socket.resetAndDestroy()` on the accepted connection — which sends an
actual TCP RST, producing a genuine `ECONNRESET`, not a simulated one. Both
tests install their own `process.on("uncaughtException", ...)` that fails
the test immediately if the crash reappears, and both reproduced the exact
error text from the real report before the fix, then passed cleanly after
it. They run automatically as phases 2 and 3 of `npm run test:openrgb` (see
`run-openrgb-verification.mjs`).

## Symlink-escape guard (`verify-symlink-escape-guard.mjs`)

Phase 4. `extract-zip` (used by `deviceDatabase.ts` to unpack OpenRGB's
auto-update download) has an unpatched symlink path-traversal vulnerability
with no fixed release available — see the main `README.md`'s npm-upgrade
section for the full explanation. `deviceDatabase.ts` closes it at the
application level with `assertNoSymlinkEscapes()`, run immediately after
every extraction. This test builds both a malicious extracted tree (a real
symlink pointing outside the extraction directory, exactly what a crafted
zip's extracted symlink entry would produce on disk) and a legitimate one
(including an in-bounds symlink, which must still be allowed), and confirms
the guard rejects only the former.

## Effect frame math (`effects-frames.mjs`)

```bash
npm run test:effects
```

Runs every built-in effect in `EFFECTS` through `computeEffectFrame()` at a
range of LED counts (including the degenerate 0 and 1, which real devices do
report for single-LED zones) and timestamps, against the real compiled
`dist-electron/backend/` output. No hardware, OpenRGB or Windows needed —
these are pure functions of `(assignment, ledCount, elapsedMs)` by design,
which is both what makes them testable and what makes the on-screen previews
provably identical to what gets pushed to a device.

Effects that need randomness (Fire, Twinkle, Rain) hash a seed rather than
calling `Math.random()`, specifically so this property holds.

It guards:

- **Frame shape** — exactly `ledCount` colors back, every time. A mismatch
  would desync the array written to hardware.
- **Channel sanity** — every channel an integer in 0–255. OpenRGB packs
  these into bytes, where a `NaN` silently becomes 0 and a value over 255
  wraps.
- **Determinism** — identical inputs give byte-identical frames, so a
  preview can't lie about what the hardware is doing.
- **Brightness 0 means off** (except Reactive, which keeps a dim idle glow
  by design).
- **Animated effects actually animate** — catches an effect that is in range
  and deterministic but silently frozen, e.g. a speed factor multiplied to
  zero.
- **Two-color effects survive a missing `secondaryColor`**, which is exactly
  what a Gallery look saved before those effects existed looks like.
- **An unknown effect id falls back to the solid color, not black** — a look
  exported by a newer build and imported here should never make a device
  look dead.
- **Nothing in `EFFECTS` silently falls through to the default branch** —
  catches "added it to the list, forgot to implement the case", which would
  otherwise render as a flat color while claiming to be an animation.

## Second-screen dashboard (`verify-dashboard.mjs`)

```bash
npm run test:dashboard
```

Opening a window on a chosen monitor needs Electron and real monitors,
neither of which exist here — but almost none of the risk is in that call.
The decisions that differ per machine are pure functions, and they are what
this covers, plus a set of static checks on wiring that is easy to lose in a
later edit.

It guards:

- **A saved monitor that's since been unplugged.** Windows renumbers displays
  whenever the set changes, so a stored id routinely names nothing. The
  dashboard must still open somewhere.
- **A settings file from another version of HARE**, or a half-written one:
  missing fields, wrong types, a widget this build doesn't have, duplicates.
  Choosing *no* widgets is respected rather than treated as missing data.
- **State reaching every window.** A broadcast addressed only to the main
  window leaves the dashboard showing whatever was true when it opened.
- **Quitting isn't mistaken for the user turning the feature off** — every
  window closes on quit, and recording that would mean it never came back.
- **The dashboard window is sandboxed and guarded** exactly like the main one.
- **A device carries the whole look it's running**, not just the effect's
  name, since effect frames go to the hardware and are never reported back —
  without it the dashboard would draw stale colours.

## System sensors (`verify-sensors.mjs`)

```bash
npm run test:sensors
```

There is no Windows, no NVIDIA or AMD GPU and no AIO here, so nothing in this
suite proves HARE reads a real sensor correctly. What it proves is everything
up to the hardware, which is where the bugs actually live.

It guards:

- **Unit conversions.** Milliwatts read as watts, millidegrees as degrees, two
  bytes assembled in the wrong order — each would display a confident wrong
  number rather than fail.
- **Plausibility.** A misread offset must produce "no reading", never a GPU at
  52,000 °C or a fan at 65,000 RPM.
- **The bridged parsers**, driven by real output shapes: PowerShell's habit of
  emitting a bare object instead of a one-element array, a sensor whose value
  is `null` (which `Number()` would turn into a plausible 0), a comma decimal
  separator, and `reg query`'s numbered label/value pairs.
- **Resource discipline** — the point of the whole design. Nothing polls
  before the first watcher; a second watcher doesn't start a second timer; the
  last release stops the timer *and* kills the bridge's child process;
  releasing the same watcher twice can't corrupt the count. This suite caught
  a real bug here: a watcher released while the hub was still probing left the
  timer to be installed afterwards, polling forever with nobody watching.
- **Isolation.** One source that throws is marked unavailable with its reason
  while every other source keeps reporting.
- **Overlap.** Two sources reporting the same sensor yield one reading, from
  whichever is listed first.
- **The Thermal effect** — cold reads blue, hot reads red, frames are
  deterministic, and no sensors at all falls back to the cold end rather than
  freezing at the last value seen.
- **PawnIO detection** — running, installed-but-stopped, and absent are told
  apart, and "service does not exist" is never mistaken for installed.

## Vendor software as devices (`verify-vendor-devices.mjs`)

```bash
npm run test:vendor-devices
```

Vendor integrations used to be one "flat colour to everything" call behind a
Test button, invisible to effects, the Gallery, persistence and the second
screen. They are ordinary devices now, merged into the same list OpenRGB's
come from — and that merge is the risky part, so this drives the composite
backend directly with a fake OpenRGB backend and fake vendor clients.

It guards:

- **Ids can't collide.** A vendor id must never be mistaken for an OpenRGB
  one, or a Razer frame would land on a motherboard.
- **Every write lands on exactly one source**, and never on both.
- **Frame reduction keeps its character.** A vendor that takes one colour gets
  the brightest LED in the frame, not a channel average — averaging a rainbow
  produces grey, which makes a working effect look broken.
- **A working vendor means "connected"**, even when OpenRGB found nothing.
- **Starting or closing vendor software mid-session** adds and removes the
  device, and announces it, rather than needing a restart.

## Input hook supervision (`verify-input-hook.mjs`)

```bash
npm run test:input-hook
```

`uIOhook.start()` can call `abort()` from native C++ code — not a throwable
exception, so no try/catch reaches it, and it kills whatever process it runs
in. It has actually done that in this project's Linux sandbox. The hook
therefore runs in a forked child, and this drives that supervision with a fake
child so the crash paths can be exercised without needing a real one.

The property under test states plainly: **a crash in an optional lighting
effect must never end the app.** It also guards that repeated crashes are
given up on rather than respawned forever, that an unsupported platform is
told apart from a crash, that keystrokes still reach the Reactive effect
across the process boundary, and that stopping releases the OS hook rather
than killing the process outright.

## Diagnostic logging (`verify-logging.mjs`)

```bash
npm run test:logging
```

The feature carries three promises, and this suite is what keeps them: it is
off until someone turns it on, it never leaves the PC, and it is deleted after
three days.

Retention is a pure function because it has real consequences in both
directions — too aggressive and the evidence is gone before anyone reads it,
too lax and a promise is quietly broken. The checks cover the cutoff day
itself, month and year boundaries, and the rule that files HARE didn't write
are never deleted however old they look. The rest covers: nothing is written
while logging is off, turning it on sweeps and creates a dated file whose
header states plainly that it stays local, the main process's own warnings are
captured with no call site changing, turning it off stops everything including
that capture, and an unwritable folder can never be the reason something else
fails.

## NSIS installer script (`verify-installer-script.mjs`)

```bash
npm run test:installer
```

A one-character mistake here broke three releases in a row and no existing
test could see it: `-Confirm:$false` inside a PowerShell command embedded in
NSIS. NSIS reads `$name` as one of *its* variables, so `$false` is an
unknown-variable warning — and electron-builder compiles NSIS with warnings
treated as errors, so the whole installer build fails. The app was fine; there
was simply nothing to install.

There is no NSIS here to compile against, so this is static analysis of the
one class of mistake that actually bit: a dollar sign NSIS will read as a
variable when it was meant as literal text for the shell command. Deliberately
narrow — a general "lint NSIS" would be guesswork, while this has a
reproduced failure behind it. It also checks the uninstaller still does its
job, since a syntactically valid script that removes nothing would otherwise
pass.
