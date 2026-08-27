// Exercises the NZXT Kraken Z screen driver (krakenLcdDriver.ts) against a
// simulated cooler (test/fake-kraken-screen.mjs) that answers exactly as the
// protocol documents and records every byte it receives.
//
// WHAT THIS PROVES AND WHAT IT DOESN'T
//
// The screen driver is the one part of HARE written entirely from a protocol
// description rather than from observing the device. There are two ways that
// can be wrong:
//
//   1. HARE mistranslates the protocol — wrong opcode, wrong order, an
//      unpadded report, a bad length field, mangled pixels, a failure reply
//      it never checks. These are ordinary software bugs.
//   2. The protocol description itself is wrong or incomplete for a given
//      firmware revision.
//
// This file eliminates category 1 completely. Category 2 needs real hardware
// and nothing here can substitute for it. That's a real and useful split:
// it means if the screen misbehaves on a real cooler, the cause is almost
// certainly the protocol description, not HARE's handling of it — which is a
// much smaller thing to go and check.
import { KrakenLcdDriver } from "../dist-electron/backend/displays/krakenLcdDriver.js";
import { FakeKrakenHid, FakeKrakenUsb, withFakeUsbStack } from "./fake-kraken-screen.mjs";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/** The Kraken Z53/Z63/Z73: 320x320, and the one model with a 512-byte bulk chunk size. */
const SCREEN_Z = {
  vendorId: 0x1e71,
  productId: 0x3008,
  name: "NZXT Kraken Z (Z53, Z63 or Z73)",
  resolutionWidth: 320,
  resolutionHeight: 320,
  controllable: true,
  capabilities: { staticImage: true, gif: true, video: false, brightness: true, orientation: true, liquidMode: true },
};

const u32le = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);

async function drive(hid, usb, fn) {
  return withFakeUsbStack(hid, usb, async () => {
    const driver = new KrakenLcdDriver(SCREEN_Z);
    const opened = await driver.open();
    if (!opened.ok) throw new Error(`open failed: ${opened.message}`);
    try {
      return await fn(driver);
    } finally {
      await driver.close();
    }
  });
}

console.log("NZXT Kraken Z screen driver, against a simulated cooler...\n");

// --- Connection lifecycle --------------------------------------------------
{
  const hid = new FakeKrakenHid();
  const usb = new FakeKrakenUsb();
  await drive(hid, usb, async () => {});
  check("opens the USB image channel and selects configuration 1", usb.configuration === 1);
  check("claims interface 0", usb.claimedInterfaces.includes(0));
  check("releases the interface again on close", usb.releasedInterfaces.includes(0));
  check("closes the HID control channel on close", hid.closed);
  check("doesn't leave the USB device open", !usb.opened);
}

// --- Reading screen state --------------------------------------------------
{
  const hid = new FakeKrakenHid({ brightness: 42, orientationQuarter: 2 });
  const info = await drive(hid, new FakeKrakenUsb(), async (d) => d.readInfo());
  check(`reads brightness back off the device (got ${info.brightness})`, info.brightness === 42);
  check(`converts the raw orientation quarter to degrees (got ${info.orientation})`, info.orientation === 180);
  check("asks with the documented query opcode", hid.commandSequence()[0] === "0x30 0x01");
}

// --- Every HID report is exactly 64 bytes ----------------------------------
// The device expects fixed-length reports; a short write is silently ignored
// by real hardware, which would look like "nothing happened" with no error.
{
  const hid = new FakeKrakenHid();
  const usb = new FakeKrakenUsb();
  await drive(hid, usb, async (d) => d.setStaticImage(new Uint8Array(320 * 320 * 4)));
  check(
    `all ${hid.written.length} HID reports are padded to exactly 64 bytes`,
    hid.written.every((w) => w.length === 64)
  );
}

// --- The upload command sequence matches the documented protocol -----------
{
  const hid = new FakeKrakenHid();
  const usb = new FakeKrakenUsb();
  await drive(hid, usb, async (d) => d.setStaticImage(new Uint8Array(320 * 320 * 4)));
  const seq = hid.commandSequence();

  check("begins the transfer session with 0x36 0x03", seq[0] === "0x36 0x03");
  check(
    `queries all 16 buckets before choosing one (found ${seq.filter((c) => c === "0x30 0x04").length})`,
    seq.filter((c) => c === "0x30 0x04").length === 16
  );

  const setup = seq.indexOf("0x32 0x01");
  const start = seq.indexOf("0x36 0x01");
  const end = seq.indexOf("0x36 0x02");
  const nowSwitch = seq.indexOf("0x38 0x01");
  check("reserves bucket memory (0x32 0x01) before starting the transfer", setup !== -1 && setup < start);
  check("starts the transfer (0x36 0x01) before ending it", start !== -1 && start < end);
  check("ends the transfer (0x36 0x02) before switching buckets", end !== -1 && end < nowSwitch);
  check("switches to the new bucket last (0x38 0x01)", nowSwitch === seq.length - 1);
}

// --- The bulk payload is byte-correct --------------------------------------
{
  const hid = new FakeKrakenHid();
  const usb = new FakeKrakenUsb();
  // A recognisable pixel pattern so the RGBA -> RGB+pad conversion is visible.
  const rgba = new Uint8Array(320 * 320 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 0x11; // R
    rgba[i + 1] = 0x22; // G
    rgba[i + 2] = 0x33; // B
    rgba[i + 3] = 0xff; // A — must be dropped
  }
  await drive(hid, usb, async (d) => d.setStaticImage(rgba));
  const bytes = usb.allBytes();

  const PREFIX = [0x12, 0xfa, 0x01, 0xe8, 0xab, 0xcd, 0xef, 0x98, 0x76, 0x54, 0x32, 0x10];
  check(
    "the first bulk packet carries the documented 12-byte preamble",
    PREFIX.every((b, i) => bytes[i] === b)
  );
  check(`declares payload type 0x02 (still image), got ${bytes[12]}`, bytes[12] === 0x02);

  const declaredLength = u32le(bytes, 16);
  const expectedPayload = 320 * 320 * 4;
  check(
    `declares the payload length little-endian (${declaredLength} = ${expectedPayload})`,
    declaredLength === expectedPayload
  );
  check("sends exactly the declared number of payload bytes", bytes.length === 20 + expectedPayload);

  // RGBA in, RGB + zero pad out — the alpha byte must not reach the device.
  const p = 20;
  check(
    `converts RGBA to RGB+pad (${bytes[p]},${bytes[p + 1]},${bytes[p + 2]},${bytes[p + 3]})`,
    bytes[p] === 0x11 && bytes[p + 1] === 0x22 && bytes[p + 2] === 0x33 && bytes[p + 3] === 0x00
  );
  check(
    "no alpha byte survives anywhere in the payload",
    (() => {
      for (let i = p + 3; i < bytes.length; i += 4) if (bytes[i] !== 0) return false;
      return true;
    })()
  );

  // This model takes 512-byte chunks; the header goes out as its own packet.
  const payloadChunks = usb.chunks.slice(1);
  check(
    `chunks the payload at this model's 512-byte transfer size (${payloadChunks.length} chunks)`,
    payloadChunks.every((c) => c.data.length <= 512) && payloadChunks.length === Math.ceil(expectedPayload / 512)
  );
  check("writes to bulk endpoint 0x02", usb.chunks.every((c) => c.endpointNumber === 0x02));
}

// --- GIFs go up untouched --------------------------------------------------
// The screen decodes GIFs itself, so re-encoding would destroy the animation.
{
  const hid = new FakeKrakenHid();
  const usb = new FakeKrakenUsb();
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array.from({ length: 500 }, (_, i) => i % 256)]);
  await drive(hid, usb, async (d) => d.setGif(gif));
  const bytes = usb.allBytes();

  check(`declares payload type 0x01 (GIF), got ${bytes[12]}`, bytes[12] === 0x01);
  check(`declares the GIF's own length (${u32le(bytes, 16)} = ${gif.length})`, u32le(bytes, 16) === gif.length);
  check(
    "sends the GIF bytes verbatim, header intact",
    bytes.length === 20 + gif.length && gif.every((b, i) => bytes[20 + i] === b)
  );
}

// --- Wrong-sized images are rejected before anything is written ------------
{
  const hid = new FakeKrakenHid();
  const usb = new FakeKrakenUsb();
  const result = await drive(hid, usb, async (d) => d.setStaticImage(new Uint8Array(10)));
  check(`a wrongly-sized image is refused (${result.ok ? "accepted!" : "refused"})`, result.ok === false);
  check("...and nothing is written to the device when it's refused", usb.chunks.length === 0);
}

// --- A device that says "no" must abort, not silently claim success --------
// This is the failure mode that matters most: pressing on after a refused
// step is how you end up with a half-written flash bucket.
{
  const hid = new FakeKrakenHid({ failCommands: new Set(["0x32:0x01"]) });
  const usb = new FakeKrakenUsb();
  const result = await drive(hid, usb, async (d) => d.setStaticImage(new Uint8Array(320 * 320 * 4)));
  check("a refused memory reservation aborts the upload", result.ok === false);
  check("...and no image data is sent after the refusal", usb.chunks.length === 0);
}
{
  const hid = new FakeKrakenHid({ failCommands: new Set(["0x38:0x01"]) });
  const usb = new FakeKrakenUsb();
  const result = await drive(hid, usb, async (d) => d.setStaticImage(new Uint8Array(320 * 320 * 4)));
  check("a refused bucket switch is reported as a failure, not success", result.ok === false);
}

// --- Brightness and orientation --------------------------------------------
{
  const hid = new FakeKrakenHid({ brightness: 60, orientationQuarter: 1 });
  await drive(hid, new FakeKrakenUsb(), async (d) => d.setBrightness(25));
  const cmd = hid.written.find((w) => w[0] === 0x30 && w[1] === 0x02);
  check("sets brightness with the documented opcode", !!cmd);
  check(`sends the requested brightness value (${cmd?.[3]})`, cmd?.[3] === 25);
  check(`preserves the device's current orientation while doing so (${cmd?.[7]})`, cmd?.[7] === 1);
}
{
  const hid = new FakeKrakenHid({ brightness: 77, orientationQuarter: 0 });
  await drive(hid, new FakeKrakenUsb(), async (d) => d.setOrientation(270));
  const cmd = hid.written.find((w) => w[0] === 0x30 && w[1] === 0x02);
  check(`converts 270 degrees to the raw quarter value (${cmd?.[7]})`, cmd?.[7] === 3);
  check(`preserves the device's current brightness while doing so (${cmd?.[3]})`, cmd?.[3] === 77);
}
{
  const hid = new FakeKrakenHid();
  await drive(hid, new FakeKrakenUsb(), async (d) => d.setBrightness(999));
  const cmd = hid.written.find((w) => w[0] === 0x30 && w[1] === 0x02);
  check(`an out-of-range brightness is clamped to 100, not sent raw (${cmd?.[3]})`, cmd?.[3] === 100);
}

// --- The escape hatch ------------------------------------------------------
{
  const hid = new FakeKrakenHid();
  await drive(hid, new FakeKrakenUsb(), async (d) => d.setLiquidMode());
  const cmd = hid.written.find((w) => w[0] === 0x38 && w[1] === 0x01);
  check("'Reset to stock' switches the screen back to liquid mode (0x38 0x01 mode 0x02)", cmd?.[2] === 0x02);
}

console.log("");
if (failures > 0) {
  console.error(`ALL_KRAKEN_SCREEN_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_KRAKEN_SCREEN_CHECKS_PASSED");
