// A stand-in Lian Li Galahad II / HydroShift AIO, at the HID packet level.
//
// Records every packet the driver writes and answers the one request that
// expects a reply, so the packet layout in lianLiAioLcdDriver.ts can be
// checked byte for byte without a cooler on the desk.
//
// Field layout is from sgtaziz/lian-li-linux's
// crates/lianli-devices/src/hydroshift_lcd/protocol.rs — the same source the
// driver was transcribed from, and the same one docs/LIAN-LI-LCD-PROTOCOL.md
// writes down. That means this fixture cannot catch a mistake in the
// *protocol*; what it catches is the driver drifting away from it, which is
// the failure that actually happens over time.

const REPORT_A = 0x01;
const REPORT_B = 0x02;
const CMD_HANDSHAKE = 0x81;
const CMD_LCD_CONTROL = 0x0c;
const CMD_LCD_AVAILABLE = 0x17;
const B_HEADER_LEN = 11;
/** Stands in for an acknowledgement from some earlier transfer still in the queue. */
const CMD_SEND_JPEG_ACK = 0x0e;

export class FakeLianLiHid {
  /**
   * `answersControl` is the interesting knob.
   *
   * A real Galahad II LCD (Vision) takes the LCD-control command, does nothing
   * with it, and says nothing back — pictures still arrive, but underneath the
   * cooler's own display, and handing the screen back has no effect. HARE
   * reported both as success because the reply was never read. Setting this
   * false reproduces that panel.
   */
  constructor({
    fanRpm = 1200,
    pumpRpm = 2400,
    coolantC = 31.4,
    tempValid = true,
    answersControl = true,
    /**
     * Answer a control message with the exact bytes it was sent.
     *
     * What a real Galahad II LCD (Vision) does. The reply reads as an
     * acknowledgement and the panel does nothing.
     */
    echoesControl = false,
    hasLcd = true,
    answersAvailable = true,
    /** Replies queued ahead of the real one, to prove the search doesn't take the first thing it sees. */
    decoyReplies = 0,
  } = {}) {
    this.answersControl = answersControl;
    this.echoesControl = echoesControl;
    this.hasLcd = hasLcd;
    this.answersAvailable = answersAvailable;
    this.decoyReplies = decoyReplies;
    this.queue = [];
    /** Every packet written, in order, as plain arrays. */
    this.written = [];
    this.closed = false;
    this.fanRpm = fanRpm;
    this.pumpRpm = pumpRpm;
    this.coolantC = coolantC;
    this.tempValid = tempValid;
    this.pendingReply = null;
  }

  write(data) {
    if (this.closed) throw new Error("write after close");
    if (data.length !== 64 && data.length !== 1024) {
      throw new Error(`unexpected packet size ${data.length}`);
    }
    this.written.push([...data]);

    if (data[0] === REPORT_A && data[1] === CMD_HANDSHAKE) {
      const reply = new Array(64).fill(0);
      reply[0] = REPORT_A;
      reply[1] = CMD_HANDSHAKE;
      reply[5] = 7; // payload length
      reply[6] = (this.fanRpm >> 8) & 0xff;
      reply[7] = this.fanRpm & 0xff;
      reply[8] = (this.pumpRpm >> 8) & 0xff;
      reply[9] = this.pumpRpm & 0xff;
      reply[10] = this.tempValid ? 1 : 0;
      reply[11] = Math.floor(this.coolantC);
      reply[12] = Math.round((this.coolantC % 1) * 10);
      this.pendingReply = reply;
    }

    // "Is the LCD behind this interface?" The status byte sits at the start of
    // the payload, per is_lcd_available in the reference implementation.
    if (data[0] === REPORT_B && data[1] === CMD_LCD_AVAILABLE && this.answersAvailable) {
      for (let i = 0; i < this.decoyReplies; i++) {
        const decoy = new Array(64).fill(0);
        decoy[0] = REPORT_B;
        decoy[1] = CMD_SEND_JPEG_ACK;
        this.queue.push(decoy);
      }
      const reply = new Array(64).fill(0);
      reply[0] = REPORT_B;
      reply[1] = CMD_LCD_AVAILABLE;
      reply[9] = 0;
      reply[10] = 1;
      reply[B_HEADER_LEN] = this.hasLcd ? 1 : 0;
      this.queue.push(reply);
    }

    // A panel that won't be driven sends the request straight back.
    if (data[0] === REPORT_B && data[1] === CMD_LCD_CONTROL && this.echoesControl) {
      this.pendingReply = [...data.slice(0, 64)];
      return data.length;
    }

    // A panel that accepts being driven acknowledges the control message.
    if (data[0] === REPORT_B && data[1] === CMD_LCD_CONTROL && this.answersControl) {
      const reply = new Array(64).fill(0);
      reply[0] = REPORT_B;
      reply[1] = CMD_LCD_CONTROL;
      reply[5] = 1;
      reply[6] = 1; // accepted
      this.pendingReply = reply;
    }
    return data.length;
  }

  readTimeout() {
    if (this.queue.length > 0) return this.queue.shift();
    const reply = this.pendingReply;
    this.pendingReply = null;
    return reply ?? [];
  }

  close() {
    this.closed = true;
  }

  /** Packets carrying one command, in order. */
  packetsFor(cmd) {
    return this.written.filter((p) => p[1] === cmd && p[0] === REPORT_B);
  }

  /** Reassembles the payload of a chunked B-command back into one buffer. */
  payloadFor(cmd) {
    const packets = this.packetsFor(cmd);
    const out = [];
    for (const p of packets) {
      const len = (p[9] << 8) | p[10];
      out.push(...p.slice(11, 11 + len));
    }
    return Uint8Array.from(out);
  }
}

/**
 * Swaps node-hid for the fake while `run` executes.
 *
 * The driver reaches node-hid through `createRequire`, so the module cache is
 * where the substitution has to happen — the same approach the Kraken screen
 * fixture uses.
 */
/**
 * Swaps node-hid for a set of interfaces, the way a real composite cooler
 * enumerates.
 *
 * `interfaces` is a list of FakeLianLiHid instances; each becomes one path the
 * driver can open, in order. This is what makes it possible to check that HARE
 * finds the one with the screen behind it rather than taking whichever the
 * operating system happened to list first.
 */
export async function withFakeLianLiInterfaces(interfaces, run) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const hidPath = require.resolve("node-hid");
  const saved = require.cache[hidPath];
  const byPath = new Map(interfaces.map((h, i) => [`fake-lianli-${i}`, h]));

  require.cache[hidPath] = {
    id: hidPath,
    filename: hidPath,
    loaded: true,
    exports: {
      devices: () => [...byPath.keys()].map((path) => ({ path })),
      HID: class {
        constructor(path) {
          this.target = byPath.get(path);
          if (!this.target) throw new Error(`no such interface ${path}`);
          this.target.opened = true;
        }
        write(d) {
          return this.target.write(d);
        }
        readTimeout(ms) {
          return this.target.readTimeout(ms);
        }
        close() {
          this.target.close();
        }
      },
    },
  };

  try {
    return await run();
  } finally {
    if (saved) require.cache[hidPath] = saved;
    else delete require.cache[hidPath];
  }
}

export async function withFakeLianLiHid(hid, run) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const hidPath = require.resolve("node-hid");
  const saved = require.cache[hidPath];

  require.cache[hidPath] = {
    id: hidPath,
    filename: hidPath,
    loaded: true,
    exports: {
      devices: () => [{ path: "fake-lianli" }],
      HID: class {
        write(d) {
          return hid.write(d);
        }
        readTimeout(ms) {
          return hid.readTimeout(ms);
        }
        close() {
          hid.close();
        }
      },
    },
  };

  try {
    return await run();
  } finally {
    if (saved) require.cache[hidPath] = saved;
    else delete require.cache[hidPath];
  }
}
