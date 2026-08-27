import type { KLDevice, KLDeviceType } from "../../electron/backend/types";

/**
 * A presentation-layer grouping on top of OpenRGB's raw device types — pure
 * UI classification, not part of the IPC contract, so it lives here rather
 * than in electron/backend/types.ts. Every KLDeviceType maps to exactly one
 * category; the goal is a Dashboard that stays organized whether HARE finds
 * 3 devices or 30.
 */
export type KLDeviceCategory =
  | "motherboard"
  | "memory"
  | "cooling"
  | "input"
  | "lighting"
  | "audio"
  | "display"
  | "other";

interface CategoryMeta {
  label: string;
  /** One-line explanation shown under the section heading on the Dashboard. */
  blurb: string;
}

const CATEGORY_META: Record<KLDeviceCategory, CategoryMeta> = {
  motherboard: {
    label: "Motherboard",
    blurb: "Onboard RGB headers — each zone is a physical ARGB/RGB header on the board itself.",
  },
  memory: {
    label: "Memory",
    blurb: "RAM sticks — each one is its own device with its own onboard LEDs.",
  },
  cooling: {
    label: "Cooling",
    blurb: "AIO coolers and USB fan hubs, with full per-channel control.",
  },
  input: {
    label: "Input & Peripherals",
    blurb: "Keyboards, mice, mousepads, and controllers.",
  },
  lighting: {
    label: "Lighting",
    blurb: "Standalone LED strips, panels, and light controllers.",
  },
  audio: {
    label: "Audio",
    blurb: "Headsets and speakers.",
  },
  display: {
    label: "Displays",
    blurb: "Monitors with controllable RGB lighting.",
  },
  other: {
    label: "Other Devices",
    blurb: "Everything else HARE found.",
  },
};

const CATEGORY_ORDER: KLDeviceCategory[] = [
  "motherboard",
  "memory",
  "cooling",
  "input",
  "lighting",
  "audio",
  "display",
  "other",
];

// Fan hubs, AIO pumps, and standalone RGB fan/lighting controllers (Corsair
// Commander/Lighting Node, NZXT RGB Controller, Lian Li controllers, etc.)
// usually surface from OpenRGB as device type "cooler" — but some vendor
// plugins report them as generic "led-strip" or even "unknown" instead.
// There's no explicit "this is a fan controller" flag in the OpenRGB SDK
// protocol, so this name-based heuristic is how HARE tells "a real
// USB/I2C-driven fan controller" (full per-channel control, since it's its
// own device) apart from "just an RGB LED strip/panel" for those two
// ambiguous types. type === "cooler" is always trusted outright since
// OpenRGB only ever assigns it to real cooling hardware.
const FAN_CONTROLLER_HINT = /\b(fan|hub|commander|lighting\s*node|node\s*(pro|core)|aio|kraken|radiator|pump)\b/i;

/**
 * True when this device is a genuine dedicated fan/cooling controller (its
 * own USB or motherboard-SMBus-enumerated device) rather than just a header
 * or a plain light. Every device HARE lists is already, by construction,
 * something OpenRGB found as its own controller — the one exception is a
 * motherboard's own onboard headers, which are zones *within* the
 * motherboard device, never devices of their own. So in practice: any fan
 * hardware that shows up as its own entry here already has "full control"
 * in the sense the user cares about (independent per-zone/per-fan color) —
 * this just decides whether to badge/label it as cooling hardware.
 */
export function isLikelyFanOrCoolingController(device: KLDevice): boolean {
  if (device.type === "cooler") return true;
  if ((device.type === "led-strip" || device.type === "unknown") && FAN_CONTROLLER_HINT.test(device.name)) {
    return true;
  }
  return false;
}

export function categoryForDevice(device: KLDevice): KLDeviceCategory {
  switch (device.type) {
    case "motherboard":
      return "motherboard";
    case "ram":
      return "memory";
    case "cooler":
      return "cooling";
    case "keyboard":
    case "mouse":
    case "mousemat":
    case "gamepad":
      return "input";
    case "headset":
    case "speaker":
      return "audio";
    case "monitor":
      return "display";
    case "led-strip":
      return isLikelyFanOrCoolingController(device) ? "cooling" : "lighting";
    case "gpu":
    case "storage":
    case "virtual":
    case "unknown":
    default:
      return isLikelyFanOrCoolingController(device) ? "cooling" : "other";
  }
}

const FRIENDLY_TYPE: Partial<Record<KLDeviceType, string>> = {
  motherboard: "Motherboard",
  ram: "RAM",
  keyboard: "Keyboard",
  mouse: "Mouse",
  mousemat: "Mouse Pad",
  gamepad: "Gamepad",
  headset: "Headset",
  speaker: "Speaker",
  gpu: "Graphics Card",
  storage: "Storage Device",
  monitor: "Monitor",
  virtual: "Software Controller",
};

/** A short, human label for this specific device — more specific than the raw KLDeviceType. */
export function friendlyDeviceType(device: KLDevice): string {
  if (device.type === "cooler") {
    return "AIO Cooler";
  }
  if (device.type === "led-strip" || device.type === "unknown") {
    return isLikelyFanOrCoolingController(device) ? "Fan / RGB Controller" : "LED Strip / Light";
  }
  return FRIENDLY_TYPE[device.type] ?? "RGB Device";
}

/**
 * A short explanation of how this device's zones map to physical reality —
 * shown on the device detail page so "how can I customize the lighting on
 * my X" has a straight answer instead of a bare zone list.
 */
export function controllerNote(device: KLDevice): string | null {
  switch (categoryForDevice(device)) {
    case "motherboard":
      return "Each zone below is a header on the board — everything plugged into it lights up as one zone.";
    case "cooling":
      return "Each zone below is independently controllable.";
    case "memory":
      return "This stick's own LEDs.";
    default:
      return null;
  }
}

export interface DeviceCategoryGroup {
  category: KLDeviceCategory;
  label: string;
  blurb: string;
  devices: KLDevice[];
}

/** Devices bucketed into UI sections, in a fixed sensible order, skipping empty categories. */
export function groupDevicesByCategory(devices: KLDevice[]): DeviceCategoryGroup[] {
  const buckets = new Map<KLDeviceCategory, KLDevice[]>();
  for (const device of devices) {
    const category = categoryForDevice(device);
    const bucket = buckets.get(category);
    if (bucket) bucket.push(device);
    else buckets.set(category, [device]);
  }
  return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
    category,
    label: CATEGORY_META[category].label,
    blurb: CATEGORY_META[category].blurb,
    devices: buckets.get(category) ?? [],
  }));
}

export interface RamKit {
  key: string;
  name: string;
  vendor: string;
  devices: KLDevice[];
}

/**
 * OpenRGB reports each RAM stick as its own controller — HARE groups sticks
 * that share a vendor+name (i.e. are almost certainly the same kit) so the
 * Dashboard can offer "match the whole kit" instead of one-stick-at-a-time.
 */
export function groupRamKits(devices: KLDevice[]): RamKit[] {
  const kits = new Map<string, KLDevice[]>();
  for (const device of devices) {
    if (device.type !== "ram") continue;
    const key = `${device.vendor}::${device.name}`;
    const bucket = kits.get(key);
    if (bucket) bucket.push(device);
    else kits.set(key, [device]);
  }
  return Array.from(kits.entries()).map(([key, devs]) => ({
    key,
    name: devs[0].name,
    vendor: devs[0].vendor,
    devices: devs.slice().sort((a, b) => a.id - b.id),
  }));
}

export function ramKitLabel(kit: RamKit): string {
  return kit.devices.length > 1 ? `${kit.name} (${kit.devices.length} sticks)` : kit.name;
}
