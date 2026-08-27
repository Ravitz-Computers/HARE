// A stand-in OpenRGB SDK server that simulates a small lineup of real,
// well-known RGB products (by public spec — not an emulation of the
// vendors' actual firmware/protocols) so HARE's device-mapping code
// (electron/backend/openrgbBackend.ts) can be exercised against realistic
// variety without needing real Windows or real hardware: multiple zones,
// a real matrix-keyboard layout, and several different mode-flag
// combinations.
//
// Field layout was derived byte-for-byte from openrgb-sdk's own parser
// (node_modules/openrgb-sdk/dist/device.js), not guessed — see
// test/README.md for how this was verified.
//
// Used by `npm run test:openrgb` (test/run-openrgb-verification.mjs starts
// this, runs test/verify-openrgb-backend.mjs against it, then tears it
// down) — not meant to be run standalone, though it works fine that way too
// for manual poking (`node test/fake-openrgb-server.mjs`).
import net from "node:net";

const PORT = Number(process.env.HARE_TEST_OPENRGB_PORT) || 6743;
const HEADER_SIZE = 16;
const PROTOCOL_VERSION = 5;

function header(deviceId, commandId, length) {
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.write("ORGB", 0, "ascii");
  buf.writeUInt32LE(deviceId, 4);
  buf.writeUInt32LE(commandId, 8);
  buf.writeUInt32LE(length, 12);
  return buf;
}

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const str = (s) => { const body = Buffer.from(s + "\0", "ascii"); return Buffer.concat([u16(body.length), body]); };

// Mode flag bits, per openrgb-sdk's own flags array (device.js):
// ["speed","directionLR","directionUD","directionHV","brightness",
//  "perLedColor","modeSpecificColor","randomColor","manualSave","automaticSave"]
const FLAG = {
  speed: 1 << 0,
  brightness: 1 << 4,
  perLedColor: 1 << 5,
  modeSpecificColor: 1 << 6,
};

function encodeMode(mode) {
  const parts = [];
  parts.push(str(mode.name));
  parts.push(u32(mode.value ?? 0));
  parts.push(u32(mode.flags ?? 0));
  parts.push(u32(mode.speedMin ?? 0));
  parts.push(u32(mode.speedMax ?? 0));
  parts.push(u32(mode.brightnessMin ?? 0));
  parts.push(u32(mode.brightnessMax ?? 0));
  parts.push(u32(mode.colorMin ?? 0));
  parts.push(u32(mode.colorMax ?? 0));
  parts.push(u32(mode.speed ?? 0));
  parts.push(u32(mode.brightness ?? 0));
  parts.push(u32(mode.direction ?? 0));
  parts.push(u32(mode.colorMode ?? 0));
  parts.push(u16(0)); // colorLength = 0 (no mode-specific palette needed for this test)
  return Buffer.concat(parts);
}

function encodeZone(zone) {
  const parts = [];
  parts.push(str(zone.name));
  parts.push(u32(zone.type ?? 0));
  parts.push(u32(zone.ledsMin ?? zone.ledsCount));
  parts.push(u32(zone.ledsMax ?? zone.ledsCount));
  parts.push(u32(zone.ledsCount));
  if (zone.matrix) {
    const { height, width, keys } = zone.matrix;
    // matrix.size on the client side is computed as matrixSize/4 - 2, i.e.
    // matrixSize itself only needs to be nonzero and internally consistent —
    // the client re-derives height/width straight from the buffer anyway.
    const matrixSize = 4 * (height * width) + 8;
    parts.push(u16(matrixSize));
    parts.push(u32(height));
    parts.push(u32(width));
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const v = keys[r][c];
        parts.push(u32(v === undefined ? 0xffffffff : v));
      }
    }
  } else {
    parts.push(u16(0));
  }
  parts.push(u16(0)); // segment count (protocol v4+) — none needed here
  parts.push(u32(0)); // zone flags (protocol v5+)
  return Buffer.concat(parts);
}

function buildControllerData(spec) {
  const parts = [];
  parts.push(u32(0)); // leading size field the client skips (offset starts at 4)
  parts.push(u32(spec.type));
  parts.push(str(spec.name));
  parts.push(str(spec.vendor));
  parts.push(str(spec.description ?? ""));
  parts.push(str(spec.version ?? "1.0"));
  parts.push(str(spec.serial ?? "N/A"));
  parts.push(str(spec.location ?? "USB"));

  parts.push(u16(spec.modes.length));
  parts.push(u32(spec.activeMode ?? 0));
  for (const mode of spec.modes) parts.push(encodeMode(mode));

  parts.push(u16(spec.zones.length));
  let totalLeds = 0;
  for (const zone of spec.zones) {
    parts.push(encodeZone(zone));
    totalLeds += zone.ledsCount;
  }

  parts.push(u16(totalLeds));
  for (let i = 0; i < totalLeds; i++) {
    parts.push(str(`LED ${i + 1}`));
    parts.push(u32(0));
  }

  parts.push(u16(totalLeds));
  const [r, g, b] = spec.color ?? [40, 40, 40];
  for (let i = 0; i < totalLeds; i++) parts.push(Buffer.from([r, g, b, 0]));

  parts.push(u16(0)); // alternate LED names (protocol v5+) — none
  parts.push(u32(0)); // device flags (protocol v5+)

  return Buffer.concat(parts);
}

// Builds a rectangular matrix where every cell is populated in row-major LED
// order — a simplification of a real keyboard's matrix (real ones have gaps
// for irregular key shapes, encoded as 0xFFFFFFFF) — with a couple of gaps
// deliberately carved out so "no key here" cells get exercised too.
function buildKeyboardMatrix(rows, cols) {
  const keys = [];
  let ledIndex = 0;
  const gaps = new Set(["0,0", `${rows - 1},${cols - 1}`]);
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (gaps.has(`${r},${c}`)) {
        row.push(undefined);
      } else {
        row.push(ledIndex++);
      }
    }
    keys.push(row);
  }
  return { height: rows, width: cols, keys, ledCount: ledIndex };
}

const kbMatrix = buildKeyboardMatrix(6, 22); // roughly a real 104/105-key layout

// Real, well-known RGB products (by public spec), used purely as realistic
// test fixtures for HARE's device-mapping code.
export const DEVICES = [
  {
    name: "ROG STRIX B550-F GAMING",
    vendor: "ASUSTeK COMPUTER INC.",
    type: 0, // motherboard
    zones: [
      { name: "Motherboard", ledsCount: 8 },
      // An ARGB header: resizable, and empty until told how long the strip
      // is. This is the shape that made a real ASUS board look broken.
      { name: "Aura Addressable 1", ledsCount: 0, ledsMin: 0, ledsMax: 240 },
    ],
    modes: [
      { name: "Direct", flags: FLAG.perLedColor },
      { name: "Static", flags: FLAG.modeSpecificColor },
      { name: "Rainbow", flags: FLAG.speed, speedMin: 0, speedMax: 255, speed: 128 },
    ],
    color: [255, 0, 60],
  },
  {
    // The board that produced the bug this fixture exists for. Two things
    // make it different from every other device here, and both are real:
    //
    //   - It boots sitting in one of its own firmware effects, not in Direct.
    //   - Its Direct mode is not mode 0.
    //
    // Write colour to it while it is still in "Spectrum Cycle" and the
    // firmware keeps animating underneath: the two composite and every HARE
    // effect comes out wrong. Switching it to "Off" instead stops the output
    // entirely, so that is not a way out either.
    name: "ASRock B650 Polychrome",
    vendor: "ASRock",
    type: 0, // motherboard
    zones: [
      { name: "RGB LED 1", ledsCount: 4 },
      { name: "Addressable 1", ledsCount: 0, ledsMin: 0, ledsMax: 100 },
    ],
    activeMode: 3,
    modes: [
      { name: "Off", flags: 0 },
      { name: "Static", flags: FLAG.modeSpecificColor },
      { name: "Direct", flags: FLAG.perLedColor },
      { name: "Spectrum Cycle", flags: FLAG.speed, speedMin: 0, speedMax: 255, speed: 128 },
    ],
    color: [10, 200, 90],
  },
  {
    name: "Vengeance RGB Pro",
    vendor: "Corsair",
    type: 1, // ram
    zones: [{ name: "RGB RAM", ledsCount: 10 }],
    modes: [
      { name: "Direct", flags: FLAG.perLedColor },
      { name: "Static", flags: FLAG.modeSpecificColor },
      { name: "Rainbow Wave", flags: FLAG.speed, speedMin: 0, speedMax: 255, speed: 100 },
    ],
    color: [0, 180, 255],
  },
  {
    name: "Kraken Z63",
    vendor: "NZXT",
    type: 3, // cooler
    zones: [
      { name: "Pump Ring", ledsCount: 24 },
      { name: "Fan LEDs", ledsCount: 8 },
    ],
    modes: [
      { name: "Direct", flags: FLAG.perLedColor },
      { name: "Spectrum Cycle", flags: FLAG.speed | FLAG.brightness, speedMin: 0, speedMax: 255, speed: 150, brightnessMin: 0, brightnessMax: 100, brightness: 80 },
    ],
    color: [120, 0, 255],
  },
  {
    name: "K95 RGB PLATINUM",
    vendor: "Corsair",
    type: 5, // keyboard
    zones: [{ name: "Keyboard", ledsCount: kbMatrix.ledCount, matrix: kbMatrix }],
    modes: [
      { name: "Direct", flags: FLAG.perLedColor },
      { name: "Static", flags: FLAG.modeSpecificColor },
      { name: "Rainbow Wave", flags: FLAG.speed, speedMin: 0, speedMax: 255, speed: 90 },
      { name: "Reactive", flags: FLAG.modeSpecificColor | FLAG.speed, speedMin: 0, speedMax: 255, speed: 200 },
    ],
    color: [255, 255, 255],
  },
  {
    name: "G502 HERO",
    vendor: "Logitech",
    type: 6, // mouse
    zones: [
      { name: "Logo", ledsCount: 1 },
      { name: "DPI Indicator", ledsCount: 1 },
    ],
    modes: [
      { name: "Direct", flags: FLAG.perLedColor },
      { name: "Breathing", flags: FLAG.speed | FLAG.modeSpecificColor, speedMin: 0, speedMax: 255, speed: 60 },
      { name: "Color Cycle", flags: FLAG.speed, speedMin: 0, speedMax: 255, speed: 120 },
    ],
    color: [0, 255, 120],
  },
  {
    name: "AER RGB 2 (x3 fans)",
    vendor: "NZXT",
    type: 4, // led-strip (fan headers grouped through a hub, matches how OpenRGB reports NZXT HUE2 fan chains)
    zones: [
      { name: "Fan 1", ledsCount: 8 },
      { name: "Fan 2", ledsCount: 8 },
      { name: "Fan 3", ledsCount: 8 },
    ],
    modes: [
      { name: "Direct", flags: FLAG.perLedColor },
      { name: "Static", flags: FLAG.modeSpecificColor },
    ],
    color: [255, 140, 0],
  },
];

// Only actually start listening when run directly (`node
// test/fake-openrgb-server.mjs`) — the verification runner instead spawns
// this file as a child process, so this guard just avoids a double-listen
// if this module is ever imported for its DEVICES export elsewhere.
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export function startServer() {
  const server = net.createServer((socket) => {
    console.log("[fake-openrgb] client connected");
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= HEADER_SIZE) {
        const length = buf.readUInt32LE(12);
        if (buf.length < HEADER_SIZE + length) break;
        const deviceId = buf.readUInt32LE(4);
        const commandId = buf.readUInt32LE(8);
        const data = buf.subarray(HEADER_SIZE, HEADER_SIZE + length);
        buf = buf.subarray(HEADER_SIZE + length);

        if (commandId === 40) {
          const body = Buffer.alloc(4);
          body.writeUInt32LE(PROTOCOL_VERSION);
          socket.write(Buffer.concat([header(0, 40, 4), body]));
        } else if (commandId === 0) {
          const body = Buffer.alloc(4);
          body.writeUInt32LE(DEVICES.length);
          socket.write(Buffer.concat([header(0, 0, 4), body]));
          console.log(`[fake-openrgb] sent controller count = ${DEVICES.length}`);
        } else if (commandId === 1) {
          const spec = DEVICES[deviceId];
          if (!spec) {
            console.log(`[fake-openrgb] requestControllerData for unknown device ${deviceId}`);
            return;
          }
          const data = buildControllerData(spec);
          socket.write(Buffer.concat([header(deviceId, 1, data.length), data]));
          console.log(`[fake-openrgb] sent controller data for device ${deviceId} (${spec.name})`);
        } else if (commandId === 1000) {
          // resizeZone: two little-endian ints, zone id then new length. The
          // real server clamps to the zone's own range and re-lays-out the
          // device, so the simulator does too.
          const spec = DEVICES[deviceId];
          if (spec && data.length >= 8) {
            const zoneId = data.readInt32LE(0);
            const requested = data.readInt32LE(4);
            const zone = spec.zones[zoneId];
            if (zone) {
              const min = zone.ledsMin ?? 0;
              const max = zone.ledsMax ?? requested;
              zone.ledsCount = Math.max(min, Math.min(max, requested));
              console.log(`[fake-openrgb] resized zone ${zoneId} of device ${deviceId} to ${zone.ledsCount}`);
            }
          }
        } else if (commandId === 1050) {
          // updateLeds. Real OpenRGB stores what it was told in the
          // controller it then reports back, which is what lets HARE check
          // whether a write actually took. The simulator used to drop these
          // on the floor, which made every device look unresponsive — so it
          // now behaves the way the real server does.
          const spec = DEVICES[deviceId];
          // Body: 4-byte data size, 2-byte LED count, then RGBA per LED. The
          // fixture holds one colour for the whole device, so the first LED's
          // is what's kept — enough to prove a write was received and is
          // reported back, which is all the read-back check needs.
          if (spec && data.length >= 10) {
            spec.color = [data[6], data[7], data[8]];
          }
        } else if (commandId === 1101 || commandId === 1102) {
          // updateMode / saveMode. Applied rather than ignored, because the
          // whole point of the direct-mode switch is that the device really
          // leaves the firmware effect it was running — and a simulator that
          // accepts the request and changes nothing is exactly the controller
          // this is meant to catch.
          //
          // Body: 4-byte data size, then the mode index.
          const spec = DEVICES[deviceId];
          if (spec && data.length >= 8) {
            const modeIndex = data.readInt32LE(4);
            if (spec.modes[modeIndex]) {
              spec.activeMode = modeIndex;
              console.log(
                `[fake-openrgb] device ${deviceId} is now in mode ${modeIndex} ("${spec.modes[modeIndex].name}")`
              );
            }
          }
        } else if (commandId === 1100) {
          // setCustomMode. Deliberately does nothing here. Real controllers
          // vary: the request is fire-and-forget, and one that doesn't
          // implement it accepts it and keeps running its firmware effect.
          // That is the ASRock Polychrome behaviour HARE has to survive, so
          // the simulator behaves like the controllers that don't answer.
          console.log(`[fake-openrgb] setCustomMode for device ${deviceId} (ignored, as some real controllers do)`);
        } else {
          console.log(`[fake-openrgb] received command ${commandId} (ignored, no response)`);
        }
      }
    });
    socket.on("error", (e) => console.log("[fake-openrgb] socket error", e.message));
  });

  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[fake-openrgb] listening on 127.0.0.1:${PORT} with ${DEVICES.length} simulated devices`);
      resolve(server);
    });
  });
}
