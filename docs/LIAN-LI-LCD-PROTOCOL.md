# Lian Li AIO screens — the protocol, written down

How HARE draws on a Lian Li Galahad II LCD, Galahad II LCD (Vision) or
HydroShift LCD. Detection is in `electron/backend/displays/krakenLcd.ts`, the
write path is `lianLiAioLcdDriver.ts`, and both coolers are presented to the
rest of the app through `screenDriver.ts`.

This page is the transcription the driver was written from. It stays because
the driver has never been run against the hardware, so when something behaves
oddly the first question is whether the code or this page is wrong.

## Where this came from

[`sgtaziz/lian-li-linux`](https://github.com/sgtaziz/lian-li-linux) — an
open-source replacement for L-Connect 3 covering fans, RGB and LCD streaming.
**MIT licensed**, so unlike the liquidctl work behind the NZXT driver there is
no licence question here at all. The relevant files:

| What | File |
| --- | --- |
| Device table | `crates/lianli-shared/src/device_id.rs` |
| Screen geometry | `crates/lianli-shared/src/screen.rs` |
| Packet layout and commands | `crates/lianli-devices/src/hydroshift_lcd/protocol.rs` |
| Transfers, handshake, JPEG | `crates/lianli-devices/src/hydroshift_lcd/controller.rs` |

None of it has been run by this project against real hardware. The same
caveat that heads `krakenLcdDriver.ts` applies.

## Which devices

Plain HID, `node-hid` finds them today:

| VID:PID | Model | Screen |
| --- | --- | --- |
| `0416:7391` | Galahad II LCD | 480×480 |
| `0416:7395` | Galahad II Vision | 480×480 |
| `0416:7398` | HydroShift LCD | 480×480 |
| `0416:7399` | HydroShift LCD RGB | 480×480 |
| `0416:739A` | HydroShift LCD TL | 480×480 |
| `04FC:7393` | UNI FAN TL LCD | 400×400 |

The `1CBE` bulk family and the `1A86` desktop-mode family are separate work —
see the comment in `krakenLcd.ts` for why neither belongs in the HID table.

## Packets

Two shapes, distinguished by report id.

**A-command** — 64 bytes, report id `0x01`. Short control messages.

```
[0]      0x01          report id
[1]      cmd
[2..5]   0
[5]      payload length
[6..]    payload
```

**B-command** — 1024 bytes, report id `0x02`. Anything with a payload, split
across as many packets as it takes. Header is 11 bytes, so 1013 bytes of
payload per packet.

```
[0]      0x02          report id
[1]      cmd
[2..6]   total size    big-endian uint32, the size of the WHOLE transfer
[6..9]   packet number big-endian uint24, from 0
[9..11]  payload len   big-endian uint16, this packet only
[11..]   payload
```

Every packet in a transfer repeats the same total size and increments the
packet number. After the last one, read once with a short timeout (~20 ms) for
an acknowledgement — best-effort; the reference implementation ignores a
timeout there.

## Commands

| Command | Byte | Shape |
| --- | --- | --- |
| Handshake | `0x81` | A |
| Get firmware | `0x86` | A |
| Reset device | `0x8E` | A |
| LCD control | `0x0C` | B |
| Is the LCD there | `0x17` | B |
| Send JPEG | `0x0E` | B |
| Send H.264 frame | `0x0D` | B |

There is a third packet shape in the reference — a **C-command**, report id
`0x03`, 512 bytes, same 11-byte header. `build_lcd_packet` takes the report id
and packet size as arguments, and only the H.264 path ever passes the C form,
behind a `use_c_command` flag. JPEG and LCD control are both sent as B. HARE
sends no H.264, so it has no C path and does not need one.

### Handshake — `0x81`

Returns the response in the same 64-byte shape; `[5]` is the payload length,
payload starts at `[6]`:

```
[0..2]   fan RPM        big-endian uint16
[2..4]   pump RPM       big-endian uint16
[4]      temp valid     non-zero when the coolant reading is real
[5]      coolant temp   whole degrees
[6]      coolant temp   tenths (value % 10)
```

Worth noting for the sensors layer, not just the screen: this is coolant
temperature and pump RPM straight off the cooler.

### LCD control — `0x0C`

Eight bytes of payload:

```
[0]  mode        0 local UI, 1 application, 2 local H.264, 3 local AVI,
                 4 LCD setting, 5 LCD test
[1]  brightness
[2]  rotation    0, 1, 2, 3 = 0°, 90°, 180°, 270°
[7]  video fps
```

**Mode 1 (application) is the one to set before sending anything.** Without
it the panel keeps drawing its own UI.

**Mode 4 (LCD setting) is what a brightness or rotation change uses.** The
reference has three senders of `0x0C`: `apply_lcd_settings` sends mode 1 to
take the panel over, and `set_brightness` and `set_rotation` send mode 4 to
adjust one that is already being driven. HARE sent mode 1 for all three, so
every drag of a brightness slider re-announced an application claiming the
screen.

### Is the LCD there — `0x17`

A B-command with no payload. The reply's status byte sits at the start of its
payload — offset 11, after the same 11-byte header. Non-zero means the LCD is
behind this interface.

This matters more than it looks. These coolers enumerate as several HID
interfaces under one vendor and product id: the pump and fans on one, the panel
on another, and the order the operating system lists them in is not fixed.
HARE opened the first and hoped. Getting that wrong produces no error at all —
writes succeed, the handshake answers, and nothing appears on the screen, which
from the outside is identical to a panel that ignores the commands. So every
interface is asked this question and the one that says yes is the one used.

The reference reads replies in a loop until the command byte matches, rather
than taking whatever is at the front of the queue; an acknowledgement from an
earlier transfer is otherwise easily mistaken for the answer. HARE does the
same, with a fixed limit.

### Send JPEG — `0x0E`

A whole JPEG, chunked as B-commands. This is the important find: a still image
needs no video encoder, which is exactly what HARE's screen feature is — an
image, a GIF frame, or a rendered temperature readout.

H.264 (`0x0D`) is only for motion, and would pull ffmpeg into the app.

## What is built, and what isn't

Built: handshake, brightness, rotation, a still picture, and handing the
screen back to the cooler. JPEG encoding goes through Electron's own
`nativeImage` rather than a native image library, because this runs in the
packaged main process where every extra native module is one more thing that
can fail to unpack from the asar on someone else's PC.

Not built: **animation**. These panels take one still frame per message, so a
GIF means decoding it here and sending frames on a timer. That is safe on this
hardware in a way it is not on an NZXT panel — see below — but it isn't
written, and the capability flag says `gif: false` rather than sending one
frame and calling it done.

Also not built: the **UNI FAN TL LCD** (`04FC:7393`). It is a different family
in the reference implementation (`tl_lcd.rs`, not `hydroshift_lcd/`), so it is
detected and left alone rather than folded in on the assumption that it is
close enough.

Unlike the NZXT path there is **no onboard flash** in any of this — no
buckets, no wear budget, no persistent storage to exhaust. Frames go straight
to the panel, so a live readout that redraws every second is fine here in a
way it explicitly is not on a Kraken.
