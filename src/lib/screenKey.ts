import type { KLDisplayDevice } from "../../electron/backend/types";

/**
 * How a screen's settings are filed.
 *
 * VID:PID rather than a list position, so unplugging one screen doesn't hand
 * its settings to another on the next boot.
 */
export function screenKey(screen: Pick<KLDisplayDevice, "vendorId" | "productId">): string {
  return `${screen.vendorId}:${screen.productId}`;
}
