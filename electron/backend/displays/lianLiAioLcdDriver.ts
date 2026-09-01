import { createRequire } from "node:module";
import type { KLDisplayDevice } from "../types.js";

const require = createRequire(import.meta.url);

/**
 * Write path for Lian Li AIO screens — Galahad II LCD, Galahad II LCD
 * (Vision), and the three HydroShift LCD variants.
 *
 * ============================ READ THIS FIRST ============================
 * Like the NZXT driver beside it, this has never been run against the
 * hardware it drives. Every byte below is transcribed from
 * `sgtaziz/lian-li-linux` (MIT), an open-source replacement for L-Connect 3 —
 * specifically `crates/lianli-devices/src/hydroshift_lcd/protocol.rs` and
 * `controller.rs`. The full transcription, with the reasoning, is in
 * docs/LIAN-LI-LCD-PROTOCOL.md.
 *
 * WHAT MAKES THIS SAFER THAN THE NZXT ONE
 *
 * There is no onboard flash anywhere in this protocol. The Kraken stores
 * uploaded images in "buckets" — real persistent storage with a finite number
 * of write cycles, which is why HARE never re-uploads a frame on a timer
 * there. These panels take a frame and draw it. Nothing is stored, nothing
 * wears out, and a live readout that redraws every second is fine.
 *
 * It is also plain HID. The Kraken needs a second raw USB bulk endpoint for
 * pixels; everything here goes down one HID channel.
 *
 * THE SAFEGUARDS, WHICH SHOULD NOT BE REMOVED CASUALLY
 *
 *  - Nothing is written unless the user asks for it.
 *  - The handshake is sent first and its reply is checked. A panel that
 *    doesn't answer is not written to.
 *  - `handBack()` returns the screen to the cooler's own display and is
 *    offered in the UI as an always-available escape hatch.
 *  - Images are re-encoded to the panel's exact size before sending, so a
 *    wrong-sized picture can't be handed to the firmware.
 * =========================================================================
 */

export type LcdResult = { ok: true } | { ok: false; message: string };

interface HidLike {
  write(data: number[]): number;
  readTimeout(ms: number): number[];
  close(): void;
}

// --- Packet shapes, per protocol.rs --------------------------------------

/** Short control messages. 64 bytes, 6-byte header. */
const REPORT_A = 0x01;
const A_PACKET_SIZE = 64;
const A_HEADER_LEN = 6;

/** Anything with a payload. 1024 bytes, 11-byte header, so 1013 bytes each. */
const REPORT_B = 0x02;
const B_PACKET_SIZE = 1024;
const B_HEADER_LEN = 11;
const B_MAX_PAYLOAD = B_PACKET_SIZE - B_HEADER_LEN;

const CMD_HANDSHAKE = 0x81;
const CMD_LCD_CONTROL = 0x0c;
const CMD_SEND_JPEG = 0x0e;
/** Asks whether this interface has the LCD behind it. Read-only. */
const CMD_LCD_AVAILABLE = 0x17;

/**
 * LCD control modes.
 *
 * 0 hands the panel back to its own UI and 1 is "we are driving it" — but 4 is
 * the one the reference implementation uses for a brightness or rotation
 * change on a panel it is already driving. Sending mode 1 for those, as HARE
 * did, re-claims the screen on every drag of a slider.
 */
const MODE_LOCAL_UI = 0;
const MODE_APPLICATION = 1;
const MODE_LCD_SETTING = 4;

const HANDSHAKE_TIMEOUT_MS = 3000;
const ACK_TIMEOUT_MS = 20;

/**
 * How long to wait for a reply to an LCD-control message.
 *
 * Longer than the acknowledgement after a picture, because here the reply is
 * the only evidence there is. A panel that is going to answer answers well
 * inside this; a panel that isn't costs a third of a second, once, on a
 * button the user pressed deliberately.
 */
const CONTROL_REPLY_TIMEOUT_MS = 300;

/** How many queued replies to look through for the one being waited on. */
const REPLY_SEARCH_LIMIT = 8;

/**
 * The largest image this will send, in bytes.
 *
 * A 480x480 JPEG is a few tens of kilobytes. Anything approaching a megabyte
 * means something upstream produced the wrong thing, and pushing thousands of
 * packets at a cooler to find that out is not a good way to discover it.
 */
const MAX_JPEG_BYTES = 4 * 1024 * 1024;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Builds a B-command packet. Header layout per `build_lcd_packet`. */
function buildLcdPacket(cmd: number, totalSize: number, packetNum: number, payload: Uint8Array): number[] {
  const pkt = new Array<number>(B_PACKET_SIZE).fill(0);
  pkt[0] = REPORT_B;
  pkt[1] = cmd;
  // Total size of the whole transfer, big-endian, repeated on every packet.
  pkt[2] = (totalSize >>> 24) & 0xff;
  pkt[3] = (totalSize >>> 16) & 0xff;
  pkt[4] = (totalSize >>> 8) & 0xff;
  pkt[5] = totalSize & 0xff;
  // Packet number, big-endian 24-bit, from zero.
  pkt[6] = (packetNum >>> 16) & 0xff;
  pkt[7] = (packetNum >>> 8) & 0xff;
  pkt[8] = packetNum & 0xff;
  // How much of this packet is payload.
  pkt[9] = (payload.length >>> 8) & 0xff;
  pkt[10] = payload.length & 0xff;
  for (let i = 0; i < payload.length; i++) pkt[B_HEADER_LEN + i] = payload[i];
  return pkt;
}

/** What the cooler reports about itself in its handshake reply. */
export interface LianLiAioStatus {
  fanRpm: number;
  pumpRpm: number;
  /** Coolant temperature in °C, or null when the cooler says its reading isn't valid. */
  coolantC: number | null;
}

/**
 * Whether a reply is just the request coming back.
 *
 * Compared across the header and the whole payload rather than a byte or two,
 * because a genuine status reply that happens to share a prefix would
 * otherwise be thrown away as an echo.
 */
function isEcho(reply: number[], cmd: number, payload: Uint8Array): boolean {
  if (reply.length < B_HEADER_LEN + payload.length) return false;
  if (reply[1] !== cmd) return false;
  // Header: total size, packet number and payload length, exactly as sent.
  const total = payload.length;
  if (reply[2] !== ((total >>> 24) & 0xff) || reply[3] !== ((total >>> 16) & 0xff)) return false;
  if (reply[4] !== ((total >>> 8) & 0xff) || reply[5] !== (total & 0xff)) return false;
  if (reply[6] !== 0 || reply[7] !== 0 || reply[8] !== 0) return false;
  if (reply[9] !== ((total >>> 8) & 0xff) || reply[10] !== (total & 0xff)) return false;
  for (let i = 0; i < payload.length; i++) {
    if (reply[B_HEADER_LEN + i] !== payload[i]) return false;
  }
  return true;
}

export class LianLiAioLcdDriver {
  private hid: HidLike | null = null;
  /**
   * Set once the cooler has answered a control message with its own bytes.
   *
   * Read by `wouldNotBeDriven` so the caller can stop trying rather than
   * reopening the device every few seconds for the rest of the session.
   */
  private echoed = false;

  /** Whether this cooler has demonstrated it won't be driven by HARE. */
  get refusesToBeDriven(): boolean {
    return this.echoed;
  }

  constructor(private readonly device: KLDisplayDevice) {}

  // --- connection ---------------------------------------------------------

  /**
   * Opens the interface that has the screen behind it.
   *
   * These coolers enumerate as several HID interfaces under one vendor and
   * product id — the pump and fans on one, the panel on another. HARE used to
   * take the first the operating system listed, which is an arbitrary choice
   * that happens to work whenever the LCD is first and silently addresses the
   * wrong endpoint whenever it isn't. The symptom of getting it wrong is not
   * an error: writes succeed, the handshake answers, and nothing appears on
   * the screen.
   *
   * So each interface is asked. `0x17` is the reference implementation's own
   * "is the LCD there" query — read-only, no state changed — and the first
   * interface that says yes is the one used. Every candidate and its answer
   * goes to the log, because "which interface" is the question a screen that
   * won't respond always comes down to.
   *
   * If none of them answers, the first is used anyway rather than refusing:
   * that is exactly what HARE did before, so a panel that works today cannot
   * be broken by this becoming more careful.
   */
  async open(): Promise<LcdResult> {
    let entries: { path?: string }[];
    let nodeHid: { HID: new (path: string) => HidLike };
    try {
      nodeHid = require("node-hid") as {
        devices: (vid: number, pid: number) => { path?: string }[];
        HID: new (path: string) => HidLike;
      };
      entries = (
        nodeHid as unknown as { devices: (v: number, p: number) => { path?: string }[] }
      )
        .devices(this.device.vendorId, this.device.productId)
        .filter((d) => d.path);
    } catch (err) {
      return { ok: false, message: `Couldn't look for the cooler: ${describe(err)}` };
    }
    if (entries.length === 0) return { ok: false, message: "The screen isn't connected any more." };

    let fallback: HidLike | null = null;
    for (const entry of entries) {
      let candidate: HidLike;
      try {
        candidate = new nodeHid.HID(entry.path!);
      } catch (err) {
        console.warn(`[HARE] ${this.device.name}: couldn't open ${entry.path}: ${describe(err)}`);
        continue;
      }

      this.hid = candidate;
      const present = this.lcdAvailable();
      console.log(
        `[HARE] ${this.device.name}: interface ${entry.path} — ` +
          (present === null ? "no answer" : present ? "has the screen" : "no screen behind it")
      );
      if (present) {
        fallback?.close();
        return this.greet();
      }

      // Keep the first one that opened at all, in case nothing claims the LCD.
      if (!fallback) fallback = candidate;
      else candidate.close();
      this.hid = null;
    }

    if (!fallback) {
      return {
        ok: false,
        message:
          "Couldn't open the cooler. On Windows this usually means L-Connect is running and " +
          "holding it — close it and try again.",
      };
    }

    console.warn(
      `[HARE] ${this.device.name}: no interface said it has the screen, so HARE is using the ` +
        "first one. If nothing appears on the panel, this is why."
    );
    this.hid = fallback;
    return this.greet();
  }

  /**
   * Say hello before writing anything. A panel that doesn't answer is a panel
   * HARE has no business sending pixels to.
   */
  private async greet(): Promise<LcdResult> {
    const hello = this.handshake();
    if (!hello.ok) {
      await this.close();
      return hello;
    }
    return { ok: true };
  }

  /**
   * Asks the open interface whether the LCD is behind it.
   *
   * Returns null when nothing came back at all, which is a different answer
   * from "no" and worth keeping apart in the log: a silent interface may be
   * the fan controller, or may be a panel that doesn't implement the query.
   *
   * The reply is looked for across several reads rather than one, because the
   * acknowledgement from an earlier transfer can still be sitting in the queue
   * and would otherwise be mistaken for this one.
   */
  private lcdAvailable(): boolean | null {
    const sent = this.sendBCommand(CMD_LCD_AVAILABLE, new Uint8Array(0), CONTROL_REPLY_TIMEOUT_MS, {
      matchCommand: CMD_LCD_AVAILABLE,
    });
    if (!sent.ok) return null;
    const reply = sent.reply ?? [];
    if (reply.length <= B_HEADER_LEN) return null;
    return reply[B_HEADER_LEN] !== 0;
  }

  async close(): Promise<void> {
    try {
      this.hid?.close();
    } catch {
      // Already gone. Nothing to do, and nothing worth telling anyone.
    }
    this.hid = null;
  }

  // --- control ------------------------------------------------------------

  /**
   * Asks the cooler how it's doing, and confirms it's listening.
   *
   * The reply carries fan and pump speed and the coolant temperature, which
   * is worth more than the handshake itself — it's a sensor source that
   * doesn't need a driver or elevation.
   */
  handshake(): LcdResult & { status?: LianLiAioStatus } {
    const reply = this.sendACommand(CMD_HANDSHAKE, [], HANDSHAKE_TIMEOUT_MS);
    if (!reply.ok) return reply;

    const data = reply.data;
    const len = data[5] ?? 0;
    if (len < 4) {
      return { ok: false, message: "The cooler answered, but not with anything HARE could read." };
    }
    const body = data.slice(A_HEADER_LEN);
    const tempValid = len >= 5 && body[4] !== 0;
    const coolantC =
      len >= 7 && tempValid ? body[5] + (body[6] % 10) / 10 : null;

    return {
      ok: true,
      status: {
        fanRpm: (body[0] << 8) | body[1],
        pumpRpm: (body[2] << 8) | body[3],
        coolantC,
      },
    };
  }

  /**
   * Puts the panel under HARE's control and sets how it looks.
   *
   * Mode 1 is what stops the cooler drawing its own interface underneath —
   * the same shape of problem as an RGB device left in a firmware effect,
   * and skipping it is how you get a picture fighting a clock.
   */
  setDisplay(brightnessPercent: number, rotationDegrees: 0 | 90 | 180 | 270): LcdResult {
    const brightness = Math.max(0, Math.min(100, Math.round(brightnessPercent)));
    const rotation = ({ 0: 0, 90: 1, 180: 2, 270: 3 } as const)[rotationDegrees];
    const payload = new Uint8Array(8);
    payload[0] = MODE_APPLICATION;
    payload[1] = brightness;
    payload[2] = rotation;
    payload[7] = 0; // video fps; nothing is being streamed
    return this.sendControl("take the screen over", payload);
  }

  /**
   * Changes brightness or rotation without re-claiming the screen.
   *
   * Mode 4 rather than mode 1, matching what the reference implementation
   * sends for exactly this. HARE used mode 1 for both, so every drag of the
   * brightness slider re-announced that an application was taking the panel
   * over — a heavier message than the change being asked for.
   */
  setLcdSetting(brightnessPercent: number, rotationDegrees: 0 | 90 | 180 | 270): LcdResult {
    const brightness = Math.max(0, Math.min(100, Math.round(brightnessPercent)));
    const rotation = ({ 0: 0, 90: 1, 180: 2, 270: 3 } as const)[rotationDegrees];
    const payload = new Uint8Array(8);
    payload[0] = MODE_LCD_SETTING;
    payload[1] = brightness;
    payload[2] = rotation;
    payload[7] = 0;
    return this.sendControl("change the screen's settings", payload);
  }

  /**
   * Gives the screen back to the cooler.
   *
   * The equivalent of the Kraken driver's liquid mode, and the same reason
   * for existing: whatever HARE has put on someone's cooler, there has to be
   * one button that undoes it.
   */
  handBack(): LcdResult {
    const payload = new Uint8Array(8);
    payload[0] = MODE_LOCAL_UI;
    payload[1] = 100;
    return this.sendControl("hand the screen back", payload);
  }

  /**
   * Sends an LCD-control message and records what the panel said about it.
   *
   * Split out from the two callers because this one command is the one that
   * demonstrably does nothing on a real Galahad II LCD (Vision): pictures
   * arrive and are drawn *underneath* the cooler's own display, and handing
   * the screen back changes nothing at all. Both go through here.
   *
   * The transfer itself is fire-and-forget in the reference implementation,
   * which is fine for a JPEG — the frame is either drawn or it isn't, and you
   * can see which. It is not fine here: with nothing read back, HARE reported
   * "Done." for a command the panel was ignoring, which is how this went two
   * rounds without anyone being able to tell whether the message was arriving
   * at all. So the reply is read on a real timeout, logged raw, and its
   * absence is reported rather than painted over.
   */
  private sendControl(what: string, payload: Uint8Array): LcdResult {
    const sent = this.sendBCommand(CMD_LCD_CONTROL, payload, CONTROL_REPLY_TIMEOUT_MS);
    if (!sent.ok) return sent;

    const reply = sent.reply ?? [];

    // An echo is not an acknowledgement.
    //
    // A Galahad II LCD (Vision) answers every control message with the exact
    // bytes it was sent — header, packet number, payload and all — and does
    // nothing. That reply looks like success from every angle except this one:
    // the same interface returns nothing at all for the "is the LCD there"
    // query, and the panel keeps drawing its own display. It is one HID
    // interface (MI_01) on a device whose screen is somewhere else entirely.
    //
    // Reading a reply was what made this visible. Comparing it to what was
    // sent is what makes it decidable.
    if (isEcho(reply, CMD_LCD_CONTROL, payload)) {
      this.echoed = true;
      console.warn(
        `[HARE] ${this.device.name}: asked to ${what}; the cooler sent the same bytes straight ` +
          "back and did nothing. This interface isn't the screen."
      );
      return {
        ok: false,
        message:
          "This cooler repeats the command back instead of acting on it, so HARE can't drive its " +
          "screen. The screen isn't on the connection HARE can reach — only L-Connect can change " +
          "it for now.",
      };
    }

    if (reply.length === 0) {
      console.warn(
        `[HARE] ${this.device.name}: sent the command to ${what} ` +
          `(${[...payload].map((b) => b.toString(16).padStart(2, "0")).join(" ")}) ` +
          "and the screen said nothing back. It may not support being driven this way."
      );
      return {
        ok: false,
        message:
          "The screen took the command but didn't answer, and nothing changed on it. " +
          "This cooler may not accept being driven by anything other than L-Connect.",
      };
    }

    console.log(
      `[HARE] ${this.device.name}: asked to ${what}, screen replied ` +
        `${reply.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join(" ")}.`
    );
    return { ok: true };
  }

  /** Draws a JPEG, already encoded at the panel's own size. */
  sendJpeg(jpeg: Uint8Array): LcdResult {
    if (jpeg.length === 0) return { ok: false, message: "There was no picture to send." };
    if (jpeg.length > MAX_JPEG_BYTES) {
      return {
        ok: false,
        message: `That picture is ${(jpeg.length / 1_048_576).toFixed(1)} MB, which is far larger than this screen takes.`,
      };
    }
    // JPEGs start FF D8. Checked because everything below this line is a
    // stream of packets at a cooler, and "what did we just send it" should
    // not be a question anyone has to ask afterwards.
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      return { ok: false, message: "That isn't a JPEG, so HARE didn't send it." };
    }
    return this.sendBCommand(CMD_SEND_JPEG, jpeg);
  }

  // --- transport ----------------------------------------------------------

  private sendACommand(
    cmd: number,
    payload: number[],
    timeoutMs: number
  ): ({ ok: true; data: number[] } | { ok: false; message: string }) {
    if (!this.hid) return { ok: false, message: "The cooler isn't open." };
    const maxPayload = A_PACKET_SIZE - A_HEADER_LEN;
    if (payload.length > maxPayload) {
      return { ok: false, message: "That command is too long for this cooler." };
    }
    const pkt = new Array<number>(A_PACKET_SIZE).fill(0);
    pkt[0] = REPORT_A;
    pkt[1] = cmd;
    pkt[5] = payload.length;
    for (let i = 0; i < payload.length; i++) pkt[A_HEADER_LEN + i] = payload[i];

    try {
      this.hid.write(pkt);
      const reply = this.hid.readTimeout(timeoutMs);
      if (!reply || reply.length === 0) {
        return { ok: false, message: "The cooler didn't answer." };
      }
      return { ok: true, data: reply };
    } catch (err) {
      return { ok: false, message: `The cooler stopped responding: ${describe(err)}` };
    }
  }

  /**
   * Sends a payload as however many 1024-byte packets it takes.
   *
   * The acknowledgement afterwards is read on a very short timeout and its
   * absence is not treated as failure — that is what the reference
   * implementation does, and a panel that has already drawn the frame is not
   * broken for staying quiet about it.
   */
  private sendBCommand(
    cmd: number,
    payload: Uint8Array,
    replyTimeoutMs = ACK_TIMEOUT_MS,
    expect?: { matchCommand: number }
  ): LcdResult & { reply?: number[] } {
    if (!this.hid) return { ok: false, message: "The cooler isn't open." };
    const total = payload.length;
    let offset = 0;
    let packetNum = 0;

    try {
      do {
        const chunk = payload.subarray(offset, Math.min(offset + B_MAX_PAYLOAD, total));
        this.hid.write(buildLcdPacket(cmd, total, packetNum, chunk));
        offset += chunk.length;
        packetNum++;
      } while (offset < total);

      let reply: number[] = [];
      try {
        if (expect) {
          // A reply left over from an earlier transfer can still be queued, and
          // reading once would take it for this one. The reference
          // implementation loops until the command byte matches; so does this,
          // with a hard limit so a chatty panel cannot hold the call open.
          for (let attempt = 0; attempt < REPLY_SEARCH_LIMIT; attempt++) {
            const next = this.hid.readTimeout(replyTimeoutMs) ?? [];
            if (next.length === 0) break;
            if (next[1] === expect.matchCommand) {
              reply = next;
              break;
            }
          }
        } else {
          reply = this.hid.readTimeout(replyTimeoutMs) ?? [];
        }
      } catch {
        // No acknowledgement. Expected often enough that it isn't a failure
        // here; the control path above decides what to make of an empty one.
      }
      return { ok: true, reply };
    } catch (err) {
      return { ok: false, message: `The cooler stopped accepting data: ${describe(err)}` };
    }
  }
}
