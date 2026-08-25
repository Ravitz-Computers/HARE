import type { VendorId } from "../types.js";

export interface VendorDefinition {
  id: VendorId;
  name: string;
  /**
   * Windows process names (case-insensitive) that indicate this vendor's
   * software is installed and running. Sourced from public process
   * databases (file.net and similar) and community SDK wrappers, NOT from
   * Windows registry uninstall keys — those weren't reliably confirmable
   * without a real Windows install to check against, so process-name
   * detection is the more conservative, verifiable signal to build on.
   * False negatives (the vendor's software running under an unlisted
   * process name) are the realistic failure mode here, not false
   * positives — acceptable for a "detected" badge, not something control
   * logic depends on.
   */
  processNames: string[];
  /**
   * Whether HARE has an actual implemented control path for this vendor.
   * Kept in one place so the Settings panel and vendorManager.ts can never
   * disagree about which vendors are real vs. detection-only.
   */
  controllable: boolean;
  /** Shown in the Settings panel for vendors HARE can't control yet — the specific, accurate technical reason, not a vague "coming soon". */
  notControllableReason?: string;
  /**
   * Set to false for a `controllable: true` vendor whose control path has
   * never actually been exercised against the real vendor software/hardware
   * (no Windows/macOS machine, no vendor install, no hardware to test
   * against in HARE's own dev environment) — as opposed to Razer Chroma,
   * whose plain HTTP REST API this project's history has more confidence
   * in. Omit (defaults to true) once someone's confirmed it works for real.
   * Drives the Settings panel's wording so an unverified integration never
   * reads as equally trustworthy as a confirmed one.
   */
  verified?: boolean;
}

export const VENDOR_DEFINITIONS: VendorDefinition[] = [
  {
    id: "razer-chroma",
    name: "Razer Synapse / Chroma",
    processNames: ["RazerCentralService.exe", "RzSDKService.exe", "RzActionSvc.exe"],
    controllable: true,
  },
  {
    id: "corsair-icue",
    name: "Corsair iCUE",
    processNames: ["iCUE.exe"],
    controllable: true,
    verified: false,
  },
  {
    id: "logitech-ghub",
    name: "Logitech G HUB",
    processNames: ["lghub.exe", "lghub_agent.exe"],
    controllable: true,
    verified: false,
  },
  {
    id: "msi-mystic-light",
    name: "MSI Mystic Light",
    processNames: ["MSI Center.exe", "Mystic_Light_Service.exe", "MysticLightController.exe", "Dragon Center.exe"],
    controllable: true,
    verified: false,
  },
  {
    id: "steelseries-gamesense",
    name: "SteelSeries GG",
    processNames: ["SteelSeriesGG.exe", "SteelSeriesEngine3.exe", "SteelSeries GG Client.exe"],
    controllable: true,
    verified: false,
  },
  {
    id: "asus-aura",
    name: "ASUS Aura Sync",
    processNames: ["LightingService.exe", "ArmouryCrate.Service.exe"],
    controllable: true,
    verified: false,
  },
];
