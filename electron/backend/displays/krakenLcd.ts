import type { KLDisplayCapabilities, KLDisplayDevice } from "../types.js";

/**
 * Finds AIO pump / case LCD screens over raw USB HID.
 *
 * OpenRGB never touches these: it's an LED lighting protocol library and
 * these are actual pixel displays, a completely different device class.
 * Detection here is a plain USB vendor/product ID match via `node-hid`'s
 * enumeration — no vendor software (NZXT CAM, Thermalright TRCC) needs to be
 * installed or running, unlike anything in vendors/.
 *
 * Every VID/PID below is transcribed from the open-source project that
 * reverse-engineered that hardware (cited per block in the table), not
 * guessed. Writing to a screen lives in krakenLcdDriver.ts; this module only
 * finds them and reports what each one can do.
 */
/**
 * `driver: "kraken"` marks the models HARE has an implemented write path for
 * (krakenLcdDriver.ts). Models without one are still detected and reported —
 * they're real, and saying so is useful — but they're reported as not
 * controllable so the UI never offers buttons that would do nothing.
 */
const LCD_MODELS: {
  vendorId: number;
  productId: number;
  name: string;
  width: number;
  height: number;
  driver: "kraken" | null;
}[] = [
  // NZXT Kraken Z-series — from liquidctl's KrakenZ3 `_MATCHES`.
  { vendorId: 0x1e71, productId: 0x3008, name: "NZXT Kraken Z (Z53, Z63 or Z73)", width: 320, height: 320, driver: "kraken" },
  { vendorId: 0x1e71, productId: 0x300c, name: "NZXT Kraken 2023 Elite", width: 640, height: 640, driver: "kraken" },
  { vendorId: 0x1e71, productId: 0x300e, name: "NZXT Kraken 2023", width: 240, height: 240, driver: "kraken" },
  { vendorId: 0x1e71, productId: 0x3012, name: "NZXT Kraken 2024 Elite RGB", width: 640, height: 640, driver: "kraken" },
  { vendorId: 0x1e71, productId: 0x3014, name: "NZXT Kraken 2024 Plus", width: 240, height: 240, driver: "kraken" },

  // Thermalright AIO screens — from the TRCC Linux port's device registry
  // (Lexonight1/thermalright-trcc-linux, src/trcc/core/registry.py). Only
  // its HID-wired panels are listed: that project also documents several
  // Thermalright screens that talk over USB mass-storage (SCSI passthrough)
  // or a vendor-specific bulk endpoint instead, and those device classes
  // don't enumerate through node-hid at all, so claiming to detect them
  // here would be a lie. The panels below report themselves under their
  // display controller's own USB vendor (Winbond, ALi) rather than
  // "Thermalright" — that's how the hardware actually identifies itself.
  { vendorId: 0x0416, productId: 0x5302, name: "Thermalright AIO screen (Winbond USBDISPLAY)", width: 240, height: 320, driver: null },
  { vendorId: 0x0418, productId: 0x5303, name: "Thermalright AIO screen (ALi)", width: 320, height: 320, driver: null },
  { vendorId: 0x0418, productId: 0x5304, name: "Thermalright AIO screen (ALi)", width: 320, height: 320, driver: null },
];

/** Enumerates connected AIO/case LCD screens HARE recognizes. Never throws — a missing/broken HID backend on this machine just means an empty list, the same "honest zero" discipline as the rest of HARE's device detection. */
export async function detectLcdDisplays(): Promise<KLDisplayDevice[]> {
  let devices: { vendorId: number; productId: number }[];
  try {
    const hid = await import("node-hid");
    devices = hid.devices();
  } catch (err) {
    console.warn("[HARE] Couldn't enumerate HID devices for LCD display detection:", err);
    return [];
  }

  const found: KLDisplayDevice[] = [];
  const seen = new Set<string>();
  for (const device of devices) {
    const model = LCD_MODELS.find(
      (m) => m.vendorId === device.vendorId && m.productId === device.productId
    );
    if (!model) continue;
    const key = `${model.vendorId}:${model.productId}`;
    if (seen.has(key)) continue; // A single physical device enumerates as several HID interfaces.
    seen.add(key);
    found.push({
      vendorId: model.vendorId,
      productId: model.productId,
      name: model.name,
      resolutionWidth: model.width,
      resolutionHeight: model.height,
      controllable: model.driver !== null,
      capabilities: capabilitiesFor(model.driver),
    });
  }
  return found;
}

/**
 * What each driver can do. Video is deliberately present and always false:
 * "can it play an MP4" is the first thing people ask about these screens, and
 * the honest answer is no — the firmware takes still images and GIFs, and
 * nothing else. Saying so explicitly beats leaving it unmentioned.
 */
function capabilitiesFor(driver: "kraken" | null): KLDisplayCapabilities {
  if (driver === "kraken") {
    return { staticImage: true, gif: true, video: false, brightness: true, orientation: true, liquidMode: true };
  }
  return { staticImage: false, gif: false, video: false, brightness: false, orientation: false, liquidMode: false };
}
