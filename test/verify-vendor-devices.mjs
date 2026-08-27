// Vendor software as real devices.
//
// WHAT CHANGED, AND WHY IT NEEDED A TEST
//
// Vendor integrations used to be one "send a flat colour to everything" call
// behind a Test button. They produced no devices, so nothing else in HARE
// could see them: no effects, no Gallery, no persistence, no second screen.
//
// They are devices now, merged into the same list OpenRGB's come from. That
// merge is the risky part — an id collision would send a Razer frame to a
// motherboard, and a leaky route would silently drop writes — so this drives
// the composite directly with a fake OpenRGB backend and fake vendor clients
// and checks where every write actually lands.
import { CompositeBackend } from "../dist-electron/backend/compositeBackend.js";
import { VendorDeviceSource } from "../dist-electron/backend/vendors/vendorBackend.js";
import {
  dominantColor,
  vendorDeviceId,
  vendorForDeviceId,
  toKLDevice,
  VENDOR_ID_BASE,
} from "../dist-electron/backend/vendors/vendorDevices.js";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  OK: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/**
 * Long enough for a paced vendor write to have gone out.
 *
 * Writes to a vendor that takes one colour at a time are capped at 15 a
 * second, because these SDKs are another program on the other end of a socket
 * — Razer's is five HTTP requests per call, so the effect engine's 30fps was
 * 150 requests a second. Nothing is dropped: a frame that arrives too soon is
 * held and sent when the gap is up.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 140));

/** A vendor client that records what it was asked to do. */
function fakeClient({ connected = true, specs = null } = {}) {
  return {
    isConnected: connected,
    colors: [],
    frames: [],
    async connect() {
      return { ok: true };
    },
    async setColor(color) {
      this.colors.push(color);
      return { ok: true };
    },
    async disconnect() {},
    ...(specs ? { listDevices: () => specs } : {}),
  };
}

/** Stands in for OpenRGB. */
function fakePrimary(devices = []) {
  const writes = [];
  return {
    kind: "fixture",
    writes,
    async connect() {},
    async disconnect() {},
    async rescan() {},
    getStatus: () => "connected",
    getStatusMessage: () => undefined,
    getDevices: () => devices,
    async setDeviceColor(id, color) {
      writes.push({ kind: "color", id, color });
    },
    async setZoneColor(id, zoneId, color) {
      writes.push({ kind: "zone", id, zoneId, color });
    },
    async setLedColors(id, zoneId, colors) {
      writes.push({ kind: "leds", id, zoneId, count: colors.length });
    },
    async setNativeMode(id, modeId) {
      writes.push({ kind: "mode", id, modeId });
    },
    async updateModeParams(id) {
      writes.push({ kind: "params", id });
    },
    async setRawLedColors(id, colors) {
      writes.push({ kind: "raw", id, count: colors.length });
    },
    onDevicesChanged: () => () => {},
    onStatusChanged: () => () => {},
  };
}

console.log("Vendor software as real devices...\n");

// --- Ids can't collide with OpenRGB's --------------------------------------
{
  check("vendor ids start well above OpenRGB's small indices", vendorDeviceId("razer-chroma", 0) >= VENDOR_ID_BASE);
  check("an OpenRGB id is never mistaken for a vendor's", vendorForDeviceId(0) === null && vendorForDeviceId(42) === null);
  check("a vendor id maps back to its vendor", vendorForDeviceId(vendorDeviceId("corsair-icue", 2)) === "corsair-icue");
  check(
    "two vendors never share an id",
    vendorDeviceId("razer-chroma", 0) !== vendorDeviceId("corsair-icue", 0)
  );
  check(
    "one vendor's devices are numbered apart",
    vendorDeviceId("razer-chroma", 0) !== vendorDeviceId("razer-chroma", 1)
  );
}

// --- A vendor device is an ordinary device ---------------------------------
{
  const device = toKLDevice(
    "razer-chroma",
    "Razer Chroma",
    { key: "razer-chroma", name: "Razer Chroma lighting", type: "keyboard", ledCount: 16, resolution: "whole-device" },
    0
  );
  check("it has as many colours as LEDs", device.colors.length === 16 && device.leds.length === 16);
  check("it starts dark rather than at some invented colour", device.colors.every((c) => c.r === 0 && c.g === 0 && c.b === 0));
  check("it has a zone covering the whole device", device.zones.length === 1 && device.zones[0].ledCount === 16);
  check("it declares exactly one mode, because that's the truth", device.modes.length === 1);
  check("...which accepts direct colour, so the effect engine will drive it", device.modes[0].supportsDirectColor);
  check("it carries no active effect until one is applied", device.activeEffectId === null);

  const multi = toKLDevice(
    "corsair-icue",
    "iCUE",
    {
      key: "k",
      name: "Keyboard",
      type: "keyboard",
      ledCount: 10,
      resolution: "per-led",
      zones: [
        { name: "Left", ledCount: 4 },
        { name: "Right", ledCount: 6 },
      ],
    },
    0
  );
  check("multi-zone devices get accumulating LED offsets, not two zones at 0",
    multi.zones[0].ledStart === 0 && multi.zones[1].ledStart === 4);
}

// --- Reducing a frame for a vendor that takes one colour -------------------
{
  // A rainbow averaged channel-by-channel washes out to grey, which makes a
  // working effect look broken. The brightest LED keeps its character.
  const rainbow = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ];
  const reduced = dominantColor(rainbow);
  check("a reduced frame is a real colour from the frame, not grey mud",
    rainbow.some((c) => c.r === reduced.r && c.g === reduced.g && c.b === reduced.b));
  check("...and it's the brightest one", reduced.g === 255);
  check("an empty frame reduces to black rather than throwing",
    dominantColor([]).r === 0);
  check("a dim frame stays dim rather than being normalised up",
    dominantColor([{ r: 10, g: 0, b: 0 }, { r: 4, g: 0, b: 0 }]).r === 10);
}

// --- Routing: every write must land on exactly one source ------------------
{
  const chroma = fakeClient();
  const icue = fakeClient({ connected: false });
  const source = new VendorDeviceSource({ "razer-chroma": chroma, "corsair-icue": icue });
  const openRgbDevice = { id: 0, name: "Motherboard", vendor: "ASUS", type: "motherboard", zones: [], leds: [], modes: [], activeModeId: 0, colors: [], activeEffectId: null };
  const primary = fakePrimary([openRgbDevice]);
  const composite = new CompositeBackend(primary, source);

  await composite.connect();
  const devices = composite.getDevices();
  check("a connected vendor contributes a device", devices.length === 2);
  check("a vendor that isn't connected contributes nothing", !devices.some((d) => d.vendor === "iCUE"));
  check("the OpenRGB device is still first in the list", devices[0].id === 0);

  const vendorDevice = devices[1];
  await composite.setDeviceColor(vendorDevice.id, { r: 12, g: 34, b: 56 });
  check("a vendor write reaches the vendor client", chroma.colors.length === 1);
  check("...and never reaches OpenRGB", primary.writes.length === 0);

  await composite.setDeviceColor(0, { r: 1, g: 2, b: 3 });
  check("an OpenRGB write reaches OpenRGB", primary.writes.length === 1);
  check("...and never reaches the vendor", chroma.colors.length === 1);

  await composite.setLedColors(vendorDevice.id, null, [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 40, b: 0 },
  ]);
  // Writes to a whole-device vendor are paced — see VENDOR_MIN_WRITE_MS. A
  // frame arriving inside the gap is held and sent when it's up, so this
  // waits rather than asserting on the instant.
  await settle();
  check("an effect frame reaches the vendor", chroma.colors.length === 2);
  check(
    "...reduced to the brightest colour in it",
    chroma.colors[1].r === 255 && chroma.colors[1].g === 0
  );
  check(
    "the device's own colours reflect what was asked for",
    composite.getDevices()[1].colors[0].r === 255
  );

  // Modes are the one thing a vendor device genuinely hasn't got.
  await composite.setNativeMode(vendorDevice.id, 3);
  check("a mode change on a vendor device is a no-op, not an error", primary.writes.length === 1);

  await composite.setNativeMode(0, 3);
  check("...while OpenRGB mode changes still work", primary.writes.some((w) => w.kind === "mode"));
}

// --- Status: a working vendor means HARE is connected to something ---------
{
  const source = new VendorDeviceSource({ "razer-chroma": fakeClient() });
  const primary = fakePrimary([]);
  primary.getStatus = () => "error";
  const composite = new CompositeBackend(primary, source);
  await composite.connect();
  check(
    "a working vendor keyboard isn't reported as a total failure",
    composite.getStatus() === "connected"
  );

  const empty = new CompositeBackend(fakePrimary([]), new VendorDeviceSource({}));
  await empty.connect();
  const emptyPrimary = fakePrimary([]);
  emptyPrimary.getStatus = () => "disconnected";
  const alsoEmpty = new CompositeBackend(emptyPrimary, new VendorDeviceSource({}));
  await alsoEmpty.connect();
  check(
    "with nothing anywhere, the real status still shows",
    alsoEmpty.getStatus() === "disconnected"
  );
}

// --- A vendor connecting mid-session -------------------------------------
{
  const chroma = fakeClient({ connected: false });
  const source = new VendorDeviceSource({ "razer-chroma": chroma });
  const composite = new CompositeBackend(fakePrimary([]), source);
  await composite.connect();
  check("nothing is listed while the vendor is closed", composite.getDevices().length === 0);

  let announced = 0;
  composite.onDevicesChanged(() => announced++);
  chroma.isConnected = true;
  composite.refreshVendors();
  check("starting the vendor software makes the device appear", composite.getDevices().length === 1);
  check("...and the change is announced rather than waiting for a restart", announced === 1);

  chroma.isConnected = false;
  composite.refreshVendors();
  check("closing it takes the device away again", composite.getDevices().length === 0);
}

// --- The write budget -------------------------------------------------------
// A vendor SDK is another program reached over a socket, not a strip of LEDs.
// Feeding it the effect engine's full 30fps was pure cost: every frame of a
// rainbow reduces to the same dominant colour, so most of those writes said
// nothing at all.
{
  const { CompositeBackend } = await import("../dist-electron/backend/compositeBackend.js");
  const { VendorDeviceSource } = await import("../dist-electron/backend/vendors/vendorBackend.js");

  const chroma = fakeClient();
  const vendors = new VendorDeviceSource({ "razer-chroma": chroma });
  const composite = new CompositeBackend(fakePrimary([]), vendors);
  composite.refreshVendors();
  const device = composite.getDevices()[0];

  const frame = (r) => [{ r, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }];

  // Thirty frames, as one second of an effect would deliver.
  for (let i = 0; i < 30; i++) await composite.setLedColors(device.id, null, frame(10 + i));
  await settle();
  check(
    `a second of effect frames costs at most a handful of vendor writes (was ${chroma.colors.length})`,
    chroma.colors.length > 0 && chroma.colors.length <= 4
  );

  // The last frame must land. An animation that ends on a held colour stops
  // producing frames, so a dropped final write would leave the wrong colour
  // showing until something else happened.
  check(
    "...and the last colour sent is the last colour asked for",
    chroma.colors[chroma.colors.length - 1].r === 39
  );

  const before = chroma.colors.length;
  for (let i = 0; i < 10; i++) await composite.setLedColors(device.id, null, frame(39));
  await settle();
  check("a frame that reduces to the colour already showing is not sent again", chroma.colors.length === before);
}

console.log("");
if (failures > 0) {
  console.error(`ALL_VENDOR_DEVICE_CHECKS_FAILED (${failures} failing)`);
  process.exit(1);
}
console.log("ALL_VENDOR_DEVICE_CHECKS_PASSED");
