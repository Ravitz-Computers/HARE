import { listWindowsProcessNames } from "./vendorDetection.js";

/**
 * RGB applications that fight HARE for the same hardware bus.
 *
 * WHY THIS IS ITS OWN THING
 *
 * Motherboard, RAM and GPU lighting is reached over SMBus/I2C, and that bus
 * tolerates exactly one program at a time. OpenRGB's own documentation is
 * blunt about the consequence: running another RGB application alongside it
 * "can confuse the device or put it in an invalid state", which shows up not
 * as flickering but as **devices failing to appear at all**.
 *
 * That makes this the single most likely explanation for "HARE says no
 * devices detected but my motherboard definitely has RGB" — and it is
 * completely invisible unless something goes looking for it. So HARE looks,
 * and says so plainly, with the fix.
 *
 * This is deliberately NOT the modules list. A module is something the user
 * installs to gain a capability; this is a diagnosis with one action attached
 * ("close that app"). Listing these as modules would be exactly the kind of
 * inert "detected" row that tells nobody anything useful.
 *
 * PROCESS NAMES ARE BEST-EFFORT
 *
 * As with vendorDefinitions.ts, these come from public process databases and
 * community tooling rather than from a verified install of each application —
 * no Windows machine with these products was available. A false negative
 * (an app running under a name not listed here) is the realistic failure
 * mode, and it is harmless: HARE simply doesn't offer the hint. A false
 * positive would be worse, so the names are kept specific rather than broad.
 */

export interface ConflictingApp {
  id: string;
  /** What the user calls it. */
  name: string;
  /** Windows process image names, lowercase-compared. */
  processNames: string[];
  /** What it takes over, in the user's terms. */
  affects: string;
}

export const CONFLICTING_APPS: ConflictingApp[] = [
  {
    id: "asus-armoury",
    name: "Armoury Crate / Aura Sync",
    processNames: ["armourycrate.service.exe", "lightingservice.exe", "armourycrate.usersessionhelper.exe"],
    affects: "ASUS motherboards, GPUs and RAM",
  },
  {
    id: "gigabyte-fusion",
    name: "RGB Fusion / Gigabyte Control Center",
    processNames: ["rgbfusion.exe", "gcc.exe", "ledctrlservice.exe", "gigabytecontrolcenter.exe"],
    affects: "Gigabyte and Aorus motherboards and GPUs",
  },
  {
    id: "asrock-polychrome",
    name: "ASRock Polychrome RGB",
    processNames: ["asrrgbled.exe", "asrpolychromergb.exe", "rgbledservice.exe"],
    affects: "ASRock motherboards",
  },
  {
    id: "msi-center",
    name: "MSI Center / Dragon Center",
    processNames: ["msi center.exe", "dragon center.exe", "mystic_light_service.exe"],
    affects: "MSI motherboards and GPUs",
  },
  {
    id: "corsair-icue",
    name: "iCUE",
    processNames: ["icue.exe"],
    affects: "Corsair RAM and peripherals",
  },
  {
    id: "nzxt-cam",
    name: "NZXT CAM",
    processNames: ["nzxt cam.exe", "nzxtcam.exe"],
    affects: "NZXT coolers and lighting controllers",
  },
  {
    id: "lianli-lconnect",
    name: "L-Connect",
    processNames: ["l-connect 3.exe", "l-connect.exe", "lconnect.exe"],
    affects: "Lian Li fans and controllers",
  },
  {
    id: "evga-precision",
    name: "EVGA Precision X1",
    processNames: ["precisionx_x64.exe", "precisionx1.exe"],
    affects: "EVGA graphics cards",
  },
  {
    id: "zotac-firestorm",
    name: "ZOTAC FireStorm",
    processNames: ["firestorm.exe"],
    affects: "ZOTAC graphics cards",
  },
  {
    id: "signalrgb",
    name: "SignalRGB",
    processNames: ["signalrgb.exe"],
    affects: "everything — it drives the same buses HARE does",
  },
];

export interface DetectedConflict {
  id: string;
  name: string;
  affects: string;
}

/**
 * Which conflicting applications are running right now.
 *
 * Never throws and returns nothing off Windows — a detection failure must
 * degrade to "no hint offered", never to an error the user has to think
 * about.
 */
export async function detectConflicts(): Promise<DetectedConflict[]> {
  const running = await listWindowsProcessNames();
  if (running.size === 0) return [];
  return CONFLICTING_APPS.filter((app) =>
    app.processNames.some((name) => running.has(name.toLowerCase()))
  ).map(({ id, name, affects }) => ({ id, name, affects }));
}
