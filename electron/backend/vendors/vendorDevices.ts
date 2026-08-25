import type { KLColor, KLDevice, KLDeviceType, VendorId } from "../types.js";

/**
 * Turning vendor software into devices HARE can actually drive.
 *
 * WHAT THIS REPLACES
 *
 * Vendor integrations used to be a single "send one flat colour to
 * everything" call, reachable only from a Test button in Settings. They
 * produced no devices, so they were invisible to the effect engine, the
 * Gallery, per-device persistence and the dashboard — a Razer keyboard could
 * not run Comet, could not be saved into a look, and forgot everything on
 * restart. That is not control; it is a light switch.
 *
 * Now each vendor reports real devices with real zones, and every one of them
 * is an ordinary KLDevice. Everything downstream — effects, layering, the
 * Gallery, restore-on-boot, the second screen — works on them without
 * knowing a vendor is involved.
 *
 * WHAT EACH VENDOR CAN ACTUALLY DO
 *
 * The vendor SDKs are not equal, and pretending otherwise would produce
 * confident nonsense:
 *
 *   - Razer Chroma takes a full per-key grid, so a Razer keyboard gets real
 *     per-LED frames.
 *   - The rest take one colour per device (or per device category). For those
 *     a frame is reduced to its dominant colour before it's sent.
 *
 * A reduced frame is still real control: effects run, colours change live,
 * looks apply and persist. It just can't show a gradient across one keyboard.
 * `resolution` below records which is which, so the UI can say so plainly
 * rather than implying per-key on hardware that hasn't got it.
 */

export type VendorResolution = "per-led" | "whole-device";

export interface VendorDeviceSpec {
  /** Stable within a vendor — used to build the device id and to address writes. */
  key: string;
  name: string;
  type: KLDeviceType;
  /** How many LEDs HARE should render for it. */
  ledCount: number;
  resolution: VendorResolution;
  zones?: { name: string; ledCount: number }[];
}

/**
 * Device ids must not collide with OpenRGB's, which are small indices from
 * zero. Vendor devices are numbered from a high base, one block per vendor,
 * so an id is stable for as long as the vendor reports the same devices.
 */
export const VENDOR_ID_BASE = 100000;
const VENDOR_BLOCK = 1000;

const VENDOR_ORDER: VendorId[] = [
  "razer-chroma",
  "corsair-icue",
  "logitech-ghub",
  "asus-aura",
  "steelseries-gamesense",
  "msi-mystic-light",
];

export function vendorDeviceId(vendorId: VendorId, index: number): number {
  const block = Math.max(0, VENDOR_ORDER.indexOf(vendorId));
  return VENDOR_ID_BASE + block * VENDOR_BLOCK + index;
}

/** Which vendor a device id belongs to, or null if it isn't a vendor device at all. */
export function vendorForDeviceId(deviceId: number): VendorId | null {
  if (deviceId < VENDOR_ID_BASE) return null;
  const block = Math.floor((deviceId - VENDOR_ID_BASE) / VENDOR_BLOCK);
  return VENDOR_ORDER[block] ?? null;
}

/**
 * Builds a KLDevice from a vendor's description of one of its devices.
 *
 * The single native mode is deliberate: vendor SDKs expose no equivalent of
 * OpenRGB's onboard modes, and inventing a list would put controls on screen
 * that do nothing.
 */
export function toKLDevice(
  vendorId: VendorId,
  vendorName: string,
  spec: VendorDeviceSpec,
  index: number
): KLDevice {
  const id = vendorDeviceId(vendorId, index);
  const ledCount = Math.max(1, spec.ledCount);
  const zones = (spec.zones ?? [{ name: "All", ledCount }]).map((zone, zoneIndex) => ({
    id: zoneIndex,
    name: zone.name,
    ledStart: 0,
    ledCount: Math.max(1, zone.ledCount),
    // Vendor SDKs expose none of OpenRGB's resize machinery, so the zone is
    // exactly the size it reports and no more.
    // 0 is OpenRGB's "linear" zone type, which is what a strip or a single
    // block of keys is.
    type: 0,
    ledsMin: Math.max(1, zone.ledCount),
    ledsMax: Math.max(1, zone.ledCount),
    resizable: false,
  }));

  // ledStart has to accumulate, or two zones would both write from index 0.
  let start = 0;
  for (const zone of zones) {
    zone.ledStart = start;
    start += zone.ledCount;
  }

  return {
    id,
    name: spec.name,
    vendor: vendorName,
    type: spec.type,
    zones,
    leds: Array.from({ length: ledCount }, (_, i) => ({ id: i, name: `LED ${i + 1}` })),
    // One mode, because that is the truth: vendor SDKs have no equivalent of
    // OpenRGB's onboard modes, and listing invented ones would put controls
    // on screen that do nothing.
    modes: [
      {
        id: 0,
        name: "Direct",
        supportsDirectColor: true,
        flagList: ["perLedColor"],
        direction: 0,
        colorMode: 0,
        colors: [],
        colorMin: 0,
        colorMax: 0,
      },
    ],
    activeModeId: 0,
    colors: new Array(ledCount).fill({ r: 0, g: 0, b: 0 }),
    activeEffectId: null,
  };
}

/**
 * Reduces a frame to the one colour a whole-device vendor can accept.
 *
 * A plain channel average washes out to grey on a rainbow, which is the
 * worst possible answer — it makes a working effect look broken. Taking the
 * brightest LED instead keeps the frame's character: a comet reads as its
 * head colour, a breathing effect keeps breathing, and a rainbow cycles
 * through vivid colours rather than sitting on mud.
 */
export function dominantColor(colors: KLColor[]): KLColor {
  if (colors.length === 0) return { r: 0, g: 0, b: 0 };
  let best = colors[0];
  let bestScore = -1;
  for (const color of colors) {
    // Perceived brightness, so a saturated red beats a dim white.
    const score = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
    if (score > bestScore) {
      bestScore = score;
      best = color;
    }
  }
  return best;
}
