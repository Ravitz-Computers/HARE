import type { VendorId } from "../types.js";

/**
 * What add-on modules exist, and what each one is for.
 *
 * WHAT A MODULE IS
 *
 * A module is an optional native binding that lets HARE drive some other
 * company's RGB software. They're separate downloads rather than part of the
 * installer for one reason: HARE should stay small. Most people need none of
 * these — their hardware is already driven directly through OpenRGB — so
 * shipping every native binding to everyone would inflate the download for no
 * benefit to the majority.
 *
 * HOW MODULES RELATE TO OPENRGB
 *
 * This is the important part, and the thing most likely to be misunderstood.
 *
 * OpenRGB talks to hardware **directly**, over USB and SMBus, with no vendor
 * software installed or running. That's HARE's primary path and it covers the
 * overwhelming majority of devices, including most MSI, NZXT and Lian Li gear.
 *
 * A module talks to the **vendor's own application**, which in turn talks to
 * the hardware. That means a module and OpenRGB are two different routes to
 * the same lights, and for any single device they are mutually exclusive in
 * practice — not because HARE can't do both, but because the vendor's
 * software and OpenRGB will fight each other for the same controller.
 *
 * So `overlapsOpenRgb` isn't a footnote; it's the thing the UI has to be
 * honest about. A module worth installing is one that reaches devices OpenRGB
 * *can't*, or exposes control OpenRGB doesn't. Installing one to duplicate
 * what already works is how people end up with flickering lights and no idea
 * why.
 */

export type ModuleId = "corsair-icue" | "asus-aura" | "msi-mystic-light" | "steelseries-gamesense";

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  /** The vendor integration this module powers, if it maps to one. */
  vendorId?: VendorId;
  /** One line, in the user's terms, on what installing this actually gets them. */
  summary: string;
  /**
   * The npm package (or bundled payload) this module provides. Empty when the
   * module needs no download because its dependency already ships with HARE —
   * see `koffi` below.
   */
  packageName: string | null;
  /**
   * True when this module's devices are, for most people, already driven by
   * OpenRGB. The UI says so plainly, because installing an overlapping module
   * usually makes things worse rather than better.
   */
  overlapsOpenRgb: boolean;
  /** What the module gets you that OpenRGB doesn't — the honest reason to install it anyway. */
  worthItWhen: string;
  /** Vendor software that must also be installed and running for the module to do anything. */
  requiresVendorApp: string | null;
}

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    id: "corsair-icue",
    name: "Corsair iCUE",
    vendorId: "corsair-icue",
    summary: "Drive Corsair lighting through iCUE.",
    packageName: "cue-sdk",
    overlapsOpenRgb: true,
    worthItWhen:
      "Some Corsair peripherals and newer devices only expose lighting through iCUE. If OpenRGB already lists your Corsair gear, you don't need this.",
    requiresVendorApp: "iCUE",
  },
  {
    id: "asus-aura",
    name: "ASUS Aura Sync",
    vendorId: "asus-aura",
    summary: "Drive ASUS lighting through Aura Sync.",
    packageName: "winax",
    overlapsOpenRgb: true,
    worthItWhen:
      "Some Aura devices — certain laptops and AIO boards — aren't reachable over SMBus. If OpenRGB already lists your ASUS gear, you don't need this.",
    requiresVendorApp: "Armoury Crate or Aura Sync",
  },
  {
    id: "msi-mystic-light",
    name: "MSI Mystic Light",
    vendorId: "msi-mystic-light",
    summary: "Drive MSI lighting through MSI Center.",
    // Uses koffi, which already ships with HARE, plus MSI's own DLL, which
    // comes from the user's MSI Center install. Nothing to download.
    packageName: null,
    overlapsOpenRgb: true,
    worthItWhen:
      "Most MSI motherboards already work through OpenRGB with nothing installed. This is for MSI devices OpenRGB can't see, or for keeping Mystic Light's own effects in sync.",
    requiresVendorApp: "MSI Center or Dragon Center",
  },
  {
    id: "steelseries-gamesense",
    name: "SteelSeries",
    summary: "Drive SteelSeries lighting through GameSense.",
    // GameSense is a local HTTP API, like Razer's — no native binding at all.
    packageName: null,
    overlapsOpenRgb: false,
    worthItWhen:
      "OpenRGB's SteelSeries coverage is thin, so this is usually the only way to reach SteelSeries gear.",
    requiresVendorApp: "SteelSeries GG",
  },
];

export function moduleById(id: string): ModuleDefinition | null {
  return MODULE_DEFINITIONS.find((m) => m.id === id) ?? null;
}

/** Modules that need nothing downloaded — everything they rely on already ships with HARE or comes from the vendor's own install. */
export function isBuiltInModule(def: ModuleDefinition): boolean {
  return def.packageName === null;
}
