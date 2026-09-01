import net from "node:net";

/**
 * HARE's own reader for one OpenRGB device, used only when openrgb-sdk can't
 * read that device.
 *
 * ============================ WHY THIS EXISTS ============================
 * A real machine reported three devices and openrgb-sdk could parse two. The
 * third — a Lian Li fan controller — threw:
 *
 *   The value of "offset" is out of range. It must be >= 0 and <= 1735.
 *   Received 2147
 *
 * at every protocol version, with the target offset identical each time while
 * the reply itself shrank. A constant target across shrinking replies means
 * the parser loses its place *before* any version-specific field, so stepping
 * down to an older protocol can never reach it.
 *
 * The likely culprit, and the one thing this reader does differently:
 * **`matrix_len`**. OpenRGB prefixes a zone's matrix with the length of the
 * matrix block in bytes, and openrgb-sdk ignores it — it reads `height` and
 * `width` out of the block and then reads `height * width` more values on
 * trust. A zone whose declared size and declared dimensions disagree walks
 * the parser off the end of the buffer, and the ~408-byte overshoot seen on
 * that machine is about the size of a 100-key matrix that isn't there.
 *
 * So this reader skips the matrix by its declared length. Every other read is
 * bounds-checked, and running out of buffer returns what was understood
 * rather than throwing.
 *
 * ============================= WHAT IT IS NOT ============================
 * Not a replacement for openrgb-sdk, and deliberately not on the normal path.
 * The SDK reads almost every device correctly and is what HARE uses; this
 * runs for one device, after that device has already failed, so a bug in here
 * can only affect hardware that was otherwise invisible. That is the whole
 * design: the fallback can improve the outcome and cannot make it worse.
 * =========================================================================
 */

const MAGIC = Buffer.from("ORGB", "ascii");
const HEADER_SIZE = 16;
const CMD_SET_CLIENT_NAME = 50;
const CMD_REQUEST_CONTROLLER_DATA = 1;
const CMD_UPDATE_MODE = 1101;
const CMD_SAVE_MODE = 1102;

/**
 * One mode exactly as the controller described it.
 *
 * Every field matters on the way back out. `value` is the *vendor's* own
 * identifier for the effect — OpenRGB passes it straight through to the
 * hardware — and `flags` is what tells the controller which of the fields
 * after it mean anything. Neither can be reconstructed, guessed, or defaulted:
 * sending zeros for them told a Lian Li hub to run vendor effect 0 at
 * brightness 0, so every one of its eighteen modes turned the fans off.
 */
export interface RawOrgbMode {
  id: number;
  name: string;
  value: number;
  flags: number;
  speedMin: number;
  speedMax: number;
  speed: number;
  colorMode: number;
  colors: { red: number; green: number; blue: number }[];
  flagList: string[];
  direction: number;
  colorMin: number;
  colorMax: number;
  brightnessMin?: number;
  brightnessMax?: number;
  brightness?: number;
}

/** Matches the subset of openrgb-sdk's device shape that mapDevice() reads. */
export interface RawOrgbDevice {
  deviceId: number;
  type: number;
  name: string;
  vendor?: string;
  activeMode: number;
  modes: RawOrgbMode[];
  zones: {
    id: number;
    name: string;
    type: number;
    ledsMin: number;
    ledsMax: number;
    ledsCount: number;
    resizable: boolean;
    matrix?: { size: number; height: number; width: number; keys: (number | undefined)[][] };
  }[];
  leds: { name: string; value: number }[];
  colors: { red: number; green: number; blue: number }[];
}

/** Thrown when the reply runs out. Carries how far it got, which is the useful part in a log. */
class OutOfBuffer extends Error {
  constructor(readonly at: number, readonly length: number) {
    super(`ran out of data at byte ${at} of ${length}`);
  }
}

/**
 * A cursor that refuses to read past the end.
 *
 * The entire class of failure this file exists for is a parser walking off the
 * end of a buffer, so every read goes through one place that checks.
 */
class Cursor {
  offset = 0;
  constructor(private readonly buf: Buffer) {}

  private need(n: number): void {
    if (this.offset + n > this.buf.length) throw new OutOfBuffer(this.offset + n, this.buf.length);
  }

  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  /** A length-prefixed, NUL-terminated string, exactly as OpenRGB writes them. */
  str(): string {
    const len = this.u16();
    this.need(len);
    const text = this.buf.toString("ascii", this.offset, this.offset + Math.max(0, len - 1));
    this.offset += len;
    return text;
  }

  color(): { red: number; green: number; blue: number } {
    this.need(4);
    const red = this.buf[this.offset];
    const green = this.buf[this.offset + 1];
    const blue = this.buf[this.offset + 2];
    this.offset += 4; // The fourth byte is padding, not alpha.
    return { red, green, blue };
  }

  skip(n: number): void {
    this.need(n);
    this.offset += n;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }
}

const MODE_FLAG_NAMES = [
  "speed",
  "directionLR",
  "directionUD",
  "directionHV",
  "brightness",
  "perLedColor",
  "modeSpecificColor",
  "randomColor",
  "manualSave",
  "automaticSave",
];

/** Decodes a bitfield, ignoring bits with no name rather than dying on them. */
function decodeFlags(value: number, names: string[]): string[] {
  const out: string[] = [];
  for (let bit = 0; bit < names.length; bit++) {
    if (value & (1 << bit)) out.push(names[bit]);
  }
  return out;
}

/**
 * Parses one device's controller data.
 *
 * Field order is transcribed from openrgb-sdk's own parser, which is the same
 * order OpenRGB writes. The differences are the bounds checks and the matrix.
 */
export function parseControllerData(
  buffer: Buffer,
  deviceId: number,
  protocolVersion: number
): RawOrgbDevice {
  const c = new Cursor(buffer);
  c.skip(4); // Leading size field; the body starts after it.

  const type = c.i32();
  const name = c.str();
  const vendor = protocolVersion >= 1 ? c.str() : undefined;
  c.str(); // description
  c.str(); // version
  c.str(); // serial
  c.str(); // location

  const modeCount = c.u16();
  const activeMode = c.i32();
  const modes: RawOrgbDevice["modes"] = [];
  for (let i = 0; i < modeCount; i++) {
    const modeName = c.str();
    const value = c.i32();
    const flags = c.u32();
    const speedMin = c.u32();
    const speedMax = c.u32();
    const brightnessMin = protocolVersion >= 3 ? c.u32() : undefined;
    const brightnessMax = protocolVersion >= 3 ? c.u32() : undefined;
    const colorMin = c.u32();
    const colorMax = c.u32();
    const speed = c.u32();
    const brightness = protocolVersion >= 3 ? c.u32() : undefined;
    const direction = c.u32();
    const colorMode = c.u32();
    const colorCount = c.u16();
    const colors: { red: number; green: number; blue: number }[] = [];
    for (let k = 0; k < colorCount; k++) colors.push(c.color());
    modes.push({
      id: i,
      name: modeName,
      value,
      flags,
      speedMin,
      speedMax,
      speed,
      colorMode,
      colors,
      flagList: decodeFlags(flags, MODE_FLAG_NAMES),
      direction,
      colorMin,
      colorMax,
      brightnessMin,
      brightnessMax,
      brightness,
    });
  }

  const zoneCount = c.u16();
  const zones: RawOrgbDevice["zones"] = [];
  for (let i = 0; i < zoneCount; i++) {
    const zoneName = c.str();
    const zoneType = c.i32();
    const ledsMin = c.u32();
    const ledsMax = c.u32();
    const ledsCount = c.u32();

    // THE DIFFERENCE THAT MATTERS.
    //
    // `matrixSize` is the length of the matrix block in bytes, and it is the
    // authority on how far to move. openrgb-sdk reads height and width out of
    // the block and then reads height*width values on trust; a zone where
    // those disagree with the declared size takes the whole device with it.
    //
    // Here the block is consumed by its own length no matter what is inside
    // it, and the keys are only decoded when the dimensions agree with that
    // length. A matrix HARE can't make sense of costs the matrix, not the
    // device.
    const matrixSize = c.u16();
    let matrix: RawOrgbDevice["zones"][number]["matrix"];
    if (matrixSize > 0) {
      const blockStart = c.offset;
      let dimensionBytes: number | null = null;
      try {
        const height = c.u32();
        const width = c.u32();
        const expected = 8 + height * width * 4;
        dimensionBytes = expected;
        if (expected === matrixSize && c.remaining >= height * width * 4) {
          const keys: (number | undefined)[][] = [];
          for (let row = 0; row < height; row++) {
            const cells: (number | undefined)[] = [];
            for (let col = 0; col < width; col++) {
              const led = c.u32();
              cells.push(led === 0xffffffff ? undefined : led);
            }
            keys.push(cells);
          }
          matrix = { size: matrixSize / 4 - 2, height, width, keys };
        }
      } catch {
        // Fall through to the skip below, which is the point.
      }
      // Land where the block actually ends.
      //
      // The declared length is the authority and is tried first. But a device
      // can be inconsistent in either direction: if the declared length runs
      // past the end of the reply while the dimensions fit inside it, the
      // dimensions are the believable pair. Whichever one lands inside the
      // buffer is the one used; if neither does, this device genuinely can't
      // be followed any further and the throw below says so.
      c.offset = blockStart;
      const byDimensions = dimensionBytes;
      if (c.remaining >= matrixSize) {
        c.skip(matrixSize);
      } else if (byDimensions !== null && c.remaining >= byDimensions) {
        c.skip(byDimensions);
      } else {
        c.skip(matrixSize); // Throws, with how far it got.
      }
    }

    if (protocolVersion >= 4) {
      const segmentCount = c.u16();
      for (let s = 0; s < segmentCount; s++) {
        c.str();
        c.skip(12); // type, start, length
      }
    }
    if (protocolVersion >= 5) c.u32(); // zone flags — read and ignored

    zones.push({
      id: i,
      name: zoneName,
      type: zoneType,
      ledsMin,
      ledsMax,
      ledsCount,
      resizable: ledsMin !== ledsMax,
      matrix,
    });
  }

  const ledCount = c.u16();
  const leds: { name: string; value: number }[] = [];
  for (let i = 0; i < ledCount; i++) leds.push({ name: c.str(), value: c.u32() });

  const colorCount = c.u16();
  const colors: { red: number; green: number; blue: number }[] = [];
  for (let i = 0; i < colorCount; i++) colors.push(c.color());

  return { deviceId, type, name, vendor, activeMode, modes, zones, leds, colors };
}

function header(deviceId: number, commandId: number, length: number): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(deviceId, 4);
  buf.writeUInt32LE(commandId, 8);
  buf.writeUInt32LE(length, 12);
  return buf;
}

/**
 * Asks the server for one device's data on a connection of HARE's own.
 *
 * A separate socket rather than the SDK's, because the SDK's reader owns its
 * stream and interleaving a raw request on it would corrupt whatever it is
 * waiting for. One short-lived connection for one device that has already
 * failed is a cheap way to keep the two completely apart.
 */
export function fetchControllerData(
  host: string,
  port: number,
  deviceId: number,
  protocolVersion: number,
  clientName = "HARE",
  timeoutMs = 4000
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let chunks = Buffer.alloc(0);
    let settled = false;

    const finish = (err: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(value!);
    };

    socket.setTimeout(timeoutMs, () => finish(new Error("OpenRGB didn't reply in time.")));
    socket.on("error", (err) => finish(err));

    socket.connect(port, host, () => {
      const nameBody = Buffer.concat([Buffer.from(clientName, "ascii"), Buffer.from([0])]);
      socket.write(Buffer.concat([header(0, CMD_SET_CLIENT_NAME, nameBody.length), nameBody]));

      const request = Buffer.alloc(4);
      request.writeUInt32LE(protocolVersion, 0);
      socket.write(
        Buffer.concat([header(deviceId, CMD_REQUEST_CONTROLLER_DATA, request.length), request])
      );
    });

    socket.on("data", (chunk: Buffer) => {
      chunks = Buffer.concat([chunks, chunk]);
      // Reassemble properly: a controller reply is routinely larger than one
      // TCP segment, and treating the first chunk as the whole message is its
      // own well-known way to produce exactly the bug this file exists for.
      while (chunks.length >= HEADER_SIZE) {
        if (!chunks.subarray(0, 4).equals(MAGIC)) {
          finish(new Error("OpenRGB sent something that isn't its own protocol."));
          return;
        }
        const length = chunks.readUInt32LE(12);
        if (chunks.length < HEADER_SIZE + length) return; // More to come.
        const body = chunks.subarray(HEADER_SIZE, HEADER_SIZE + length);
        const command = chunks.readUInt32LE(8);
        if (command === CMD_REQUEST_CONTROLLER_DATA) {
          finish(null, Buffer.from(body));
          return;
        }
        chunks = chunks.subarray(HEADER_SIZE + length);
      }
    });
  });
}

/** A length-prefixed, NUL-terminated string, the way OpenRGB writes them. */
function orgbString(text: string): Buffer {
  const body = Buffer.from(`${text}\0`, "ascii");
  const out = Buffer.alloc(2 + body.length);
  out.writeUInt16LE(body.length, 0);
  body.copy(out, 2);
  return out;
}

/** What a mode looks like on the wire. Only what the protocol asks for. */
export interface ModeToSend {
  index: number;
  name: string;
  value: number;
  flags: number;
  speedMin: number;
  speedMax: number;
  brightnessMin?: number;
  brightnessMax?: number;
  colorMin: number;
  colorMax: number;
  speed: number;
  brightness?: number;
  direction: number;
  colorMode: number;
  colors: { red: number; green: number; blue: number }[];
}

/**
 * Builds an update-mode message.
 *
 * The mode block is the same layout OpenRGB uses inside controller data, which
 * is why this lives next to the parser: the two have to agree, and the only
 * way to keep them agreeing is to have them read as one file.
 *
 * The leading size covers everything from itself onwards, which is how OpenRGB
 * finds the end of the block.
 */
export function buildUpdateModeBody(protocolVersion: number, mode: ModeToSend): Buffer {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    return b;
  };
  const i32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n | 0, 0);
    return b;
  };
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n, 0);
    return b;
  };

  const parts: Buffer[] = [
    orgbString(mode.name),
    i32(mode.value),
    u32(mode.flags),
    u32(mode.speedMin),
    u32(mode.speedMax),
  ];
  if (protocolVersion >= 3) {
    parts.push(u32(mode.brightnessMin ?? 0), u32(mode.brightnessMax ?? 0));
  }
  parts.push(u32(mode.colorMin), u32(mode.colorMax), u32(mode.speed));
  if (protocolVersion >= 3) parts.push(u32(mode.brightness ?? 0));
  parts.push(u32(mode.direction), u32(mode.colorMode), u16(mode.colors.length));
  for (const c of mode.colors) parts.push(Buffer.from([c.red, c.green, c.blue, 0]));

  const modeBlock = Buffer.concat(parts);
  // data size (4) + mode index (4) + the block itself.
  const size = 4 + 4 + modeBlock.length;
  return Buffer.concat([u32(size), u32(mode.index), modeBlock]);
}

/**
 * Sets a device's mode without going through openrgb-sdk.
 *
 * Needed because the SDK's own `updateMode` re-reads the whole device first —
 * so on a device its parser can't read, changing a mode throws before a single
 * byte is sent. On a real machine every one of a fan hub's eighteen built-in
 * modes failed that way while the device itself was perfectly fine.
 *
 * Fire and forget: OpenRGB does not acknowledge a mode change, so waiting for
 * a reply would only ever time out.
 */
export function sendUpdateMode(
  host: string,
  port: number,
  deviceId: number,
  protocolVersion: number,
  mode: ModeToSend,
  persist = false,
  clientName = "HARE",
  timeoutMs = 4000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(timeoutMs, () => finish(new Error("OpenRGB didn't accept the mode in time.")));
    socket.on("error", (err) => finish(err));

    socket.connect(port, host, () => {
      const nameBody = Buffer.concat([Buffer.from(clientName, "ascii"), Buffer.from([0])]);
      socket.write(Buffer.concat([header(0, CMD_SET_CLIENT_NAME, nameBody.length), nameBody]));

      const body = buildUpdateModeBody(protocolVersion, mode);
      const command = persist ? CMD_SAVE_MODE : CMD_UPDATE_MODE;
      socket.write(Buffer.concat([header(deviceId, command, body.length), body]));

      // Nothing comes back. Give the write a moment to leave the socket before
      // closing it, or the server can see a reset instead of the message.
      setTimeout(() => finish(), 150);
    });
  });
}
