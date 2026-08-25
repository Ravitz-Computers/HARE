import {
  CircuitBoard,
  Keyboard,
  Mouse,
  Fan,
  MemoryStick,
  Cpu,
  Headphones,
  Speaker,
  Monitor,
  Gamepad2,
  Lightbulb,
  HardDrive,
  Layers,
  RectangleHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { KLDevice, KLDeviceType } from "../../electron/backend/types";
import { categoryForDevice, isLikelyFanOrCoolingController, type KLDeviceCategory } from "@/lib/deviceClassification";

export const DEVICE_ICONS: Record<KLDeviceType, LucideIcon> = {
  motherboard: CircuitBoard,
  keyboard: Keyboard,
  mouse: Mouse,
  mousemat: RectangleHorizontal,
  gpu: Cpu,
  cooler: Fan,
  ram: MemoryStick,
  "led-strip": Lightbulb,
  gamepad: Gamepad2,
  headset: Headphones,
  speaker: Speaker,
  storage: HardDrive,
  virtual: Layers,
  monitor: Monitor,
  unknown: Lightbulb,
};

/** Prefers the fan-controller-aware icon (a real device may report as "led-strip"/"unknown" but actually be a fan hub — see deviceClassification.ts). */
export function deviceIcon(device: KLDevice | KLDeviceType): LucideIcon {
  if (typeof device === "string") return DEVICE_ICONS[device] ?? Lightbulb;
  if (isLikelyFanOrCoolingController(device) && device.type !== "cooler") return Fan;
  return DEVICE_ICONS[device.type] ?? Lightbulb;
}

export const CATEGORY_ICONS: Record<KLDeviceCategory, LucideIcon> = {
  motherboard: CircuitBoard,
  memory: MemoryStick,
  cooling: Fan,
  input: Keyboard,
  lighting: Lightbulb,
  audio: Headphones,
  display: Monitor,
  other: HardDrive,
};

export function categoryIcon(category: KLDeviceCategory): LucideIcon {
  return CATEGORY_ICONS[category] ?? Lightbulb;
}

/** Convenience — categoryIcon(categoryForDevice(device)), for call sites that only have a device. */
export function deviceCategoryIcon(device: KLDevice): LucideIcon {
  return categoryIcon(categoryForDevice(device));
}
