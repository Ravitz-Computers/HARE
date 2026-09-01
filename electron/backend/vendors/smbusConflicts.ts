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
 * WHY A SECOND OPENRGB ISN'T LISTED HERE
 *
 * Two OpenRGB instances genuinely do conflict — they can't both hold a USB
 * device, and the second one's writes are accepted, echoed back on read, and
 * reach no hardware. That really was the cause of a real bug.
 *
 * But HARE *launches* OpenRGB, so `openrgb.exe` is always running, and
 * matching on the process name flagged HARE's own copy on a perfectly healthy
 * system. Detecting this properly means counting instances (or excluding the
 * child HARE started by its process id) rather than asking whether the name
 * appears at all — until that exists, no warning is better than a wrong one.
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

/**
 * One sentence naming what's holding the bus, for a person to act on.
 *
 * Deliberately says what to do, not what went wrong: "close X" is the whole
 * fix, and anything about buses or detection sweeps is detail nobody needs
 * in order to close a program.
 */
export function conflictMessage(conflicts: DetectedConflict[]): string {
  const names = conflicts.map((c) => c.name);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "is" : "are"} running. Close ${
    names.length === 1 ? "it" : "them"
  } and scan again.`;
}

/**
 * Whether it is safe to start a fresh hardware scan right now.
 *
 * WHY A SCAN IS THE THING BEING GUARDED, AND NOT COLOUR WRITES
 *
 * Colour goes to controllers that have already been found. A *scan* is the
 * part that walks raw SMBus addresses asking what's there, and SMBus
 * tolerates one master at a time. Two programs sweeping it at once is the
 * documented way to put a controller in an invalid state — and on DDR5 it is
 * the shape of an open OpenRGB report where the SPD EEPROM on a stick of RAM
 * ends up corrupted and the machine stops booting.
 *
 * Nothing here is speculative about HARE's own code: HARE speaks the OpenRGB
 * SDK over TCP and has no way to address the bus at all. What it can do is
 * decline to *start* a scan while another RGB application owns the bus, which
 * is the one moment the danger is both real and knowable in advance.
 *
 * A scan blocked here was also a scan that was going to fail: with a vendor
 * app holding the bus, detection returns nothing or garbage. So this costs no
 * working functionality — it replaces a silent empty device list with a
 * sentence naming the program to close.
 */
export async function scanBlockedBy(): Promise<DetectedConflict[]> {
  return detectConflicts();
}
