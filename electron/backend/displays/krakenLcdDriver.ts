import { createRequire } from "node:module";
import type { KLDisplayDevice } from "../types.js";

const require = createRequire(import.meta.url);

/**
 * Write path for NZXT Kraken Z-series LCD screens.
 *
 * ============================ READ THIS FIRST ============================
 * This is the one part of HARE that has never been run against the hardware
 * it drives. There is no Kraken Z in this project's development environment,
 * so every byte sequence below is transcribed from liquidctl's KrakenZ3
 * driver (liquidctl/driver/kraken3.py) — the community reference
 * implementation that reverse-engineered this protocol — rather than
 * confirmed by observation.
 *
 * It also writes to the cooler's onboard flash ("buckets"), which is real
 * persistent storage on the device. The safeguards below exist because of
 * that, and should not be removed casually:
 *
 *  - Nothing is ever written unless the user explicitly asks for it.
 *  - Every reply the device sends back is checked before moving to the next
 *    step; a failed step aborts the upload instead of pressing on blindly.
 *  - `setLiquidMode()` puts the screen back to its stock liquid-temperature
 *    display and is offered in the UI as an always-available escape hatch.
 *  - Uploads are size-checked against the device's own reported memory
 *    before any write begins.
 *
 * The protocol needs two separate channels to the same physical device:
 *  - a HID channel (node-hid) for the 64-byte command/response messages, and
 *  - a raw USB bulk endpoint (libusb via `usb`) for the image payload.
 * That split is the device's design, not a choice made here — which is why
 * detection alone (which only needs HID) could never have driven the screen.
 * =========================================================================
 */

const WRITE_LENGTH = 64;
const READ_LENGTH = 64;
/** Total onboard image memory, in 1 KiB pages, per liquidctl's `_LCD_TOTAL_MEMORY`. */
const LCD_TOTAL_MEMORY = 24320;
const BUCKET_COUNT = 16;
const MAX_READ_ATTEMPTS = 12;

/** Fixed preamble on the first bulk packet of every transfer. */
const BULK_HEADER_PREFIX = [0x12, 0xfa, 0x01, 0xe8, 0xab, 0xcd, 0xef, 0x98, 0x76, 0x54, 0x32, 0x10];

/** Payload kind, the first byte of the bulk info block. */
const PAYLOAD_GIF = 0x01;
const PAYLOAD_STATIC = 0x02;

export interface LcdScreenInfo {
  brightness: number;
  /** 0, 90, 180 or 270 degrees. */
  orientation: number;
}

export type LcdResult = { ok: true } | { ok: false; message: string };

interface HidLike {
  write(data: number[]): number;
  readTimeout(ms: number): number[];
  close(): void;
}

interface UsbLike {
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  nativeTransferOut(endpointNumber: number, timeout: number, data: Uint8Array): Promise<number>;
}

/** Per-model transfer chunk size, from liquidctl's `bulk_buffer_size`. */
function bulkBufferSize(productId: number): number {
  return productId === 0x3008 ? 512 : 2 * 1024 * 1024;
}

export class KrakenLcdDriver {
  private hid: HidLike | null = null;
  private usb: UsbLike | null = null;
  private usbClaimed = false;

  constructor(private readonly device: KLDisplayDevice) {}

  // --- connection ---------------------------------------------------------

  async open(): Promise<LcdResult> {
    try {
      const nodeHid = require("node-hid") as {
        devices: (vid: number, pid: number) => { path?: string }[];
        HID: new (path: string) => HidLike;
      };
      const entries = nodeHid.devices(this.device.vendorId, this.device.productId).filter((d) => d.path);
      if (entries.length === 0) return { ok: false, message: "The screen isn't connected any more." };
      this.hid = new nodeHid.HID(entries[0].path!);
    } catch (err) {
      return { ok: false, message: `Couldn't open the screen's control channel: ${describe(err)}` };
    }

    try {
      const { usb } = require("usb") as {
        usb: { findDeviceByIds(vid: number, pid: number): Promise<UsbLike | null> };
      };
      const found = await usb.findDeviceByIds(this.device.vendorId, this.device.productId);
      if (!found) {
        await this.close();
        return { ok: false, message: "Found the screen's controls but not its image channel." };
      }
      this.usb = found;
      await this.usb.open();
      await this.usb.selectConfiguration(1);
      await this.usb.claimInterface(0);
      this.usbClaimed = true;
    } catch (err) {
      await this.close();
      return {
        ok: false,
        message:
          `Couldn't open the screen's image channel: ${describe(err)}. ` +
          "On Windows this usually means NZXT CAM is running and holding the device — close it and try again.",
      };
    }

    return { ok: true };
  }

  async close(): Promise<void> {
    try {
      this.hid?.close();
    } catch {
      /* already gone */
    }
    this.hid = null;
    try {
      if (this.usbClaimed) await this.usb?.releaseInterface(0);
      await this.usb?.close();
    } catch {
      /* already gone */
    }
    this.usbClaimed = false;
    this.usb = null;
  }

  // --- low-level transport -------------------------------------------------

  private write(data: number[]): void {
    if (!this.hid) throw new Error("not connected");
    this.hid.write([...data, ...new Array(Math.max(0, WRITE_LENGTH - data.length)).fill(0)]);
  }

  /** Writes a command, then reads until a reply with the expected two-byte prefix arrives. */
  private writeThenRead(data: number[], expect: [number, number]): number[] {
    this.write(data);
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
      const msg = this.hid!.readTimeout(500);
      if (!msg || msg.length < READ_LENGTH) continue;
      if (msg[0] === expect[0] && msg[1] === expect[1]) return msg;
    }
    throw new Error(`the screen didn't answer command ${hex(data[0])} ${hex(data[1])}`);
  }

  private async bulkWrite(bytes: Uint8Array): Promise<void> {
    if (!this.usb) throw new Error("not connected");
    await this.usb.nativeTransferOut(0x02, 5000, bytes);
  }

  // --- screen state --------------------------------------------------------

  /** Reads the screen's current brightness and orientation. Also the cheapest way to confirm the device is really answering. */
  readInfo(): LcdScreenInfo {
    const msg = this.writeThenRead([0x30, 0x01], [0x31, 0x01]);
    return { brightness: msg[0x18], orientation: msg[0x1a] * 90 };
  }

  setBrightness(percent: number): LcdResult {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    try {
      const { orientation } = this.readInfo();
      this.write([0x30, 0x02, 0x01, value, 0x0, 0x0, 0x1, orientation / 90]);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describe(err) };
    }
  }

  setOrientation(degrees: 0 | 90 | 180 | 270): LcdResult {
    try {
      const { brightness } = this.readInfo();
      this.write([0x30, 0x02, 0x01, brightness, 0x0, 0x0, 0x1, degrees / 90]);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describe(err) };
    }
  }

  /**
   * Returns the screen to its stock liquid-temperature display. This is the
   * "put it back how it was" action, and the reason it's safe to experiment
   * with uploading images at all.
   */
  setLiquidMode(): LcdResult {
    try {
      this.write([0x38, 0x1, 0x2, 0x0]);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describe(err) };
    }
  }

  // --- image upload --------------------------------------------------------

  /**
   * Uploads a still image. `rgba` must already be exactly
   * `resolutionWidth * resolutionHeight` pixels — the renderer does the
   * decode and resize on a canvas, so any format the app can display works
   * and no image library ships in the main process.
   */
  async setStaticImage(rgba: Uint8Array): Promise<LcdResult> {
    const { resolutionWidth: w, resolutionHeight: h } = this.device;
    const expected = w * h * 4;
    if (rgba.length !== expected) {
      return { ok: false, message: `Expected a ${w}x${h} image (${expected} bytes), got ${rgba.length}.` };
    }
    // Standard firmware wants RGB888 with a padding byte per pixel.
    const payload = new Uint8Array(w * h * 4);
    for (let i = 0, p = 0; i < rgba.length; i += 4) {
      payload[p++] = rgba[i];
      payload[p++] = rgba[i + 1];
      payload[p++] = rgba[i + 2];
      payload[p++] = 0;
    }
    return this.sendData(payload, PAYLOAD_STATIC);
  }

  /** Uploads an animated GIF. The device decodes the file itself, so this sends the raw bytes untouched. */
  async setGif(gifBytes: Uint8Array): Promise<LcdResult> {
    return this.sendData(gifBytes, PAYLOAD_GIF);
  }

  private async sendData(data: Uint8Array, kind: number): Promise<LcdResult> {
    try {
      const bulkInfo = [kind, 0x0, 0x0, 0x0, ...u32le(data.length)];
      const header = [...BULK_HEADER_PREFIX, ...bulkInfo];
      const pages = Math.ceil((header.length + data.length) / 1024);

      if (pages >= LCD_TOTAL_MEMORY) {
        return { ok: false, message: "That image is larger than the screen's memory." };
      }

      this.writeThenRead([0x36, 0x03], [0x37, 0x03]);

      const buckets = this.queryBuckets();
      const firstFree = this.findUnoccupiedBucket(buckets);
      const bucketIndex = this.prepareBucket(firstFree === -1 ? 0 : firstFree, firstFree === -1);

      let memoryStart = this.bucketMemoryOffset(buckets, bucketIndex, pages);
      if (memoryStart === null) {
        this.deleteAllBuckets();
        memoryStart = [0x0, 0x0];
      }

      if (!this.setupBucket(bucketIndex, bucketIndex + 1, memoryStart, u16le(pages))) {
        return { ok: false, message: "The screen refused to reserve memory for the image." };
      }

      this.writeThenRead([0x36, 0x01, bucketIndex], [0x37, 0x01]);

      await this.bulkWrite(new Uint8Array(header));
      const chunk = bulkBufferSize(this.device.productId);
      for (let i = 0; i < data.length; i += chunk) {
        await this.bulkWrite(data.subarray(i, Math.min(i + chunk, data.length)));
      }

      this.write([0x36, 0x02]);

      if (!this.switchBucket(bucketIndex)) {
        return { ok: false, message: "The image uploaded but the screen wouldn't switch to it." };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: describe(err) };
    }
  }

  // --- bucket bookkeeping --------------------------------------------------
  // "Buckets" are the 16 slots of onboard flash the screen stores images in.
  // Every helper below mirrors liquidctl's equivalent; the byte offsets are
  // its documented response layout, not guesses.

  private queryBuckets(): Record<number, number[]> {
    const out: Record<number, number[]> = {};
    for (let i = 0; i < BUCKET_COUNT; i++) {
      out[i] = this.writeThenRead([0x30, 0x04, i], [0x31, 0x04]);
    }
    return out;
  }

  /** A bucket is free when every byte from offset 15 on is zero. */
  private findUnoccupiedBucket(buckets: Record<number, number[]>): number {
    for (let i = 0; i < BUCKET_COUNT; i++) {
      if (buckets[i].slice(15).every((b) => b === 0)) return i;
    }
    return -1;
  }

  /** A delete that reports failure means "try the next slot"; a slot that had data needs deleting twice. */
  private prepareBucket(index: number, wasFilled: boolean): number {
    let i = index;
    let filled = wasFilled;
    for (let guard = 0; guard < BUCKET_COUNT * 2; guard++) {
      if (i >= BUCKET_COUNT) throw new Error("the screen has no free image slots left");
      const deleted = this.deleteBucket(i);
      if (!deleted) {
        i += 1;
        filled = true;
        continue;
      }
      if (filled) {
        filled = false;
        continue;
      }
      return i;
    }
    throw new Error("couldn't prepare an image slot on the screen");
  }

  private deleteBucket(index: number): boolean {
    this.write([0x32, 0x02, index]);
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
      const msg = this.hid!.readTimeout(500);
      if (!msg || msg.length < READ_LENGTH) continue;
      if (msg[0] === 0x33 && msg[1] === 0x02) return msg[14] === 0x01;
    }
    return false;
  }

  private deleteAllBuckets(): void {
    this.switchBucket(0, 0x2); // back to liquid mode first, so nothing is displaying from flash
    for (let i = 0; i < BUCKET_COUNT; i++) this.deleteBucket(i);
  }

  private switchBucket(index: number, mode = 0x4): boolean {
    const msg = this.writeThenRead([0x38, 0x01, mode, index], [0x39, 0x01]);
    return msg[14] === 0x01;
  }

  private setupBucket(start: number, end: number, memoryStart: number[], sizePages: number[]): boolean {
    const msg = this.writeThenRead(
      [0x32, 0x01, start, end, memoryStart[0], memoryStart[1], sizePages[0], sizePages[1], 0x01],
      [0x33, 0x01]
    );
    return msg[14] === 0x01;
  }

  /**
   * Picks where in flash this upload should live, preferring not to disturb
   * anything already stored. Returns null when the only remaining option is
   * to wipe every slot and start over.
   */
  private bucketMemoryOffset(
    buckets: Record<number, number[]>,
    bucketIndex: number,
    pages: number
  ): number[] | null {
    const current = buckets[bucketIndex];
    const currentOffset = current[17] | (current[18] << 8);
    const currentSize = current[19] | (current[20] << 8);

    // Already big enough — reuse it as-is.
    if (pages <= currentSize) return [current[17], current[18]];

    let minOccupied = currentOffset;
    let maxOccupied = 0;
    let overlaps = false;
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const b = buckets[i];
      const start = b[17] | (b[18] << 8);
      const end = start + (b[19] | (b[20] << 8));
      if (end > maxOccupied) maxOccupied = end;
      if (start < minOccupied) minOccupied = start;
      if (
        (start > currentOffset && start < currentOffset + pages) ||
        (start < currentOffset && end > start) ||
        (start === currentOffset && i !== bucketIndex)
      ) {
        overlaps = true;
      }
    }

    if (!overlaps) return [current[17], current[18]];
    if (maxOccupied + pages < LCD_TOTAL_MEMORY) return u16le(maxOccupied);
    if (pages < minOccupied) return [0x0, 0x0];
    return null;
  }
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

function hex(n: number): string {
  return `0x${n.toString(16).padStart(2, "0")}`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
