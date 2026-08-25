// A stand-in NZXT Kraken Z screen: a fake HID control channel and a fake USB
// bulk endpoint that together answer the same way the real cooler does, and
// record every byte HARE sends them.
//
// This is not an emulation of NZXT's firmware. It answers the specific
// command/response exchange documented in liquidctl's KrakenZ3 driver
// (liquidctl/driver/kraken3.py), which is the same source HARE's own driver
// was written from. That's exactly what makes it useful: if HARE's
// translation layer and liquidctl's agree on the byte sequence, the part
// most likely to be wrong — the protocol, not the wiring — has been checked.
//
// It cannot tell us the protocol description itself is right. Only real
// hardware can do that. What it can do is catch every mistake on HARE's side
// of the conversation: wrong opcodes, wrong ordering, unpadded reports, bad
// length encoding, mangled pixel conversion, ignored failure replies.
//
// Used by test/verify-kraken-screen.mjs.

const REPORT_LENGTH = 64;

/** Builds a 64-byte reply with the given two-byte prefix. */
function reply(a, b, mutate) {
  const msg = new Array(REPORT_LENGTH).fill(0);
  msg[0] = a;
  msg[1] = b;
  mutate?.(msg);
  return msg;
}

export class FakeKrakenHid {
  /**
   * @param {object} [opts]
   * @param {number} [opts.brightness] what the screen reports for brightness
   * @param {number} [opts.orientationQuarter] 0..3, i.e. degrees / 90
   * @param {Set<string>} [opts.failCommands] "0x32:0x01"-style keys to answer with failure
   */
  constructor(opts = {}) {
    this.brightness = opts.brightness ?? 60;
    this.orientationQuarter = opts.orientationQuarter ?? 1;
    this.failCommands = opts.failCommands ?? new Set();
    /** Every report HARE wrote, in order. */
    this.written = [];
    this.closed = false;
    this._pending = [];
  }

  write(bytes) {
    this.written.push([...bytes]);
    const key = `${hex(bytes[0])}:${hex(bytes[1])}`;
    const fails = this.failCommands.has(key);
    const ok = fails ? 0x0 : 0x1;

    switch (key) {
      case "0x30:0x01": // query screen info
        this._pending.push(
          reply(0x31, 0x01, (m) => {
            m[0x18] = this.brightness;
            m[0x1a] = this.orientationQuarter;
          })
        );
        break;
      case "0x36:0x03": // begin transfer session
        this._pending.push(reply(0x37, 0x03));
        break;
      case "0x30:0x04": // query bucket N — all-zero body means "unoccupied"
        this._pending.push(reply(0x31, 0x04));
        break;
      case "0x32:0x02": // delete bucket
        this._pending.push(reply(0x33, 0x02, (m) => (m[14] = ok)));
        break;
      case "0x32:0x01": // reserve bucket memory
        this._pending.push(reply(0x33, 0x01, (m) => (m[14] = ok)));
        break;
      case "0x36:0x01": // start data transfer
        this._pending.push(reply(0x37, 0x01));
        break;
      case "0x38:0x01": // switch active bucket
        this._pending.push(reply(0x39, 0x01, (m) => (m[14] = ok)));
        break;
      // 0x30:0x02 (set brightness/orientation) and 0x36:0x02 (end transfer)
      // are fire-and-forget on real hardware too — no reply.
      default:
        break;
    }
    return bytes.length;
  }

  readTimeout() {
    return this._pending.shift() ?? [];
  }

  close() {
    this.closed = true;
  }

  /** Every command HARE sent, as "0xNN 0xNN" strings — the thing assertions read. */
  commandSequence() {
    return this.written.map((w) => `${hex(w[0])} ${hex(w[1])}`);
  }
}

export class FakeKrakenUsb {
  constructor() {
    this.chunks = [];
    this.opened = false;
    this.claimedInterfaces = [];
    this.releasedInterfaces = [];
    this.configuration = null;
  }

  async open() {
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  async selectConfiguration(value) {
    this.configuration = value;
  }
  async claimInterface(n) {
    this.claimedInterfaces.push(n);
  }
  async releaseInterface(n) {
    this.releasedInterfaces.push(n);
  }
  async nativeTransferOut(endpointNumber, _timeout, data) {
    this.chunks.push({ endpointNumber, data: Uint8Array.from(data) });
    return data.length;
  }

  /** Everything written to the bulk endpoint, concatenated. */
  allBytes() {
    const total = this.chunks.reduce((n, c) => n + c.data.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c.data, at);
      at += c.data.length;
    }
    return out;
  }
}

/**
 * Installs fakes for `node-hid` and `usb` so the driver under test picks them
 * up instead of the real native modules.
 *
 * The driver resolves both with `require()` at call time (see the
 * `createRequire` at the top of krakenLcdDriver.ts), so intercepting
 * Module._load is enough — no changes to the driver, and nothing about its
 * real code path is bypassed.
 */
export async function withFakeUsbStack(hid, usbDevice, run) {
  const { default: Module } = await import("node:module");
  const realLoad = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === "node-hid") {
      return {
        devices: () => [{ path: "fake-kraken-path", vendorId: 0x1e71, productId: 0x3008 }],
        HID: function FakeHid() {
          return hid;
        },
      };
    }
    if (request === "usb") {
      return { usb: { findDeviceByIds: async () => usbDevice } };
    }
    return realLoad.call(this, request, ...rest);
  };
  try {
    return await run();
  } finally {
    Module._load = realLoad;
  }
}

function hex(n) {
  return `0x${(n ?? 0).toString(16).padStart(2, "0")}`;
}
