import { nativeImage } from "electron";
import type { KLDisplayDevice } from "../types.js";
import { KrakenLcdDriver, type LcdResult, type LcdScreenInfo } from "./krakenLcdDriver.js";
import { LianLiAioLcdDriver } from "./lianLiAioLcdDriver.js";

/**
 * One shape for every cooler screen, so the rest of HARE never asks which
 * brand it is talking to.
 *
 * The two protocols are not alike. The NZXT panel stores images in onboard
 * flash and reads its own brightness back; the Lian Li panel takes a JPEG per
 * frame, stores nothing, and has no way to be asked what brightness it is
 * currently at. Every one of those differences is absorbed here rather than
 * leaking into main.ts as a second set of IPC handlers, because the moment
 * there are two of those there will be three.
 */
export interface ScreenDriver {
  open(): Promise<LcdResult>;
  close(): Promise<void>;
  readInfo(): LcdScreenInfo;
  setBrightness(percent: number): LcdResult | Promise<LcdResult>;
  setOrientation(degrees: 0 | 90 | 180 | 270): LcdResult | Promise<LcdResult>;
  /** Hands the screen back to the cooler's own display. */
  setLiquidMode(): LcdResult | Promise<LcdResult>;
  setStaticImage(rgba: Uint8Array): Promise<LcdResult>;
  setGif(bytes: Uint8Array): Promise<LcdResult>;
}

/** Picks the driver for a screen, or null when HARE has no write path for it. */
export function createScreenDriver(device: KLDisplayDevice): ScreenDriver | null {
  if (device.driver === "kraken") return new KrakenLcdDriver(device);
  if (device.driver === "lianli-aio") return new LianLiAioLcdScreen(device);
  return null;
}

/**
 * The Lian Li AIO panel, presented the way the rest of HARE expects a screen.
 *
 * Two adaptations, both of them real differences rather than tidying:
 *
 * **Brightness and rotation arrive together.** The protocol sets them in one
 * message, so changing one means resending the other. They're remembered here
 * and both sent every time.
 *
 * **The panel takes a JPEG, not pixels.** Encoding happens through Electron's
 * own `nativeImage` rather than a native image library, because this runs in
 * the packaged main process where every extra native module is another thing
 * that can fail to unpack from the asar on someone else's PC.
 */
class LianLiAioLcdScreen implements ScreenDriver {
  private readonly driver: LianLiAioLcdDriver;
  /**
   * What was last asked for.
   *
   * This protocol has no "what brightness are you at" request, so unlike the
   * NZXT panel these are HARE's intentions rather than the cooler's answer.
   * They start at the firmware defaults.
   */
  private brightness = 100;
  private rotation: 0 | 90 | 180 | 270 = 0;

  constructor(private readonly device: KLDisplayDevice) {
    this.driver = new LianLiAioLcdDriver(device);
  }

  open(): Promise<LcdResult> {
    return this.driver.open();
  }

  close(): Promise<void> {
    return this.driver.close();
  }

  readInfo(): LcdScreenInfo {
    return { brightness: this.brightness, orientation: this.rotation };
  }

  // Mode 4, not mode 1: adjusting the panel is a different message from
  // taking it over, and sending the take-over on every slider drag is heavier
  // than the change being asked for. See setLcdSetting.
  setBrightness(percent: number): LcdResult {
    this.brightness = Math.max(0, Math.min(100, Math.round(percent)));
    return this.driver.setLcdSetting(this.brightness, this.rotation);
  }

  setOrientation(degrees: 0 | 90 | 180 | 270): LcdResult {
    this.rotation = degrees;
    return this.driver.setLcdSetting(this.brightness, this.rotation);
  }

  setLiquidMode(): LcdResult {
    return this.driver.handBack();
  }

  async setStaticImage(rgba: Uint8Array): Promise<LcdResult> {
    const { resolutionWidth: w, resolutionHeight: h } = this.device;
    const expected = w * h * 4;
    if (rgba.length !== expected) {
      return { ok: false, message: `Expected a ${w}x${h} image (${expected} bytes), got ${rgba.length}.` };
    }

    // nativeImage.createFromBitmap takes BGRA, and what arrives here is RGBA.
    // Getting this backwards doesn't fail — it silently swaps red and blue,
    // which is the kind of bug that survives review and gets reported as
    // "the colours are wrong on my cooler".
    const bgra = Buffer.allocUnsafe(expected);
    for (let i = 0; i < expected; i += 4) {
      bgra[i] = rgba[i + 2];
      bgra[i + 1] = rgba[i + 1];
      bgra[i + 2] = rgba[i];
      bgra[i + 3] = rgba[i + 3];
    }

    let jpeg: Buffer;
    try {
      jpeg = nativeImage.createFromBitmap(bgra, { width: w, height: h }).toJPEG(90);
    } catch (err) {
      return {
        ok: false,
        message: `Couldn't turn that picture into something the screen takes: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    if (jpeg.length === 0) {
      return { ok: false, message: "That picture came out empty, so HARE didn't send it." };
    }

    // Mode 1 first, every time. Without it the cooler keeps drawing its own
    // interface and the picture lands underneath it.
    //
    // Not fatal if the panel ignores it. On a real Galahad II LCD (Vision) it
    // is ignored and the picture still arrives — underneath, which is the
    // reported symptom. Refusing to send the picture because the claim went
    // unanswered would turn "the picture is behind the clock" into "nothing
    // happens", which is strictly worse and hides the evidence. So the frame
    // goes, and the message says the panel wouldn't hand the screen over.
    const claimed = this.driver.setDisplay(this.brightness, this.rotation);
    const drawn = this.driver.sendJpeg(jpeg);
    if (!drawn.ok) return drawn;
    if (!claimed.ok) {
      return {
        ok: false,
        message: `The picture was sent, but ${claimed.message.charAt(0).toLowerCase()}${claimed.message.slice(1)}`,
      };
    }
    return drawn;
  }

  async setGif(): Promise<LcdResult> {
    // Deliberately refused rather than faked. This panel takes one still
    // frame per message, so a GIF means decoding it here and sending frames
    // on a timer — which is safe on this hardware (nothing is written to
    // flash, unlike the NZXT one) but isn't built, and the capability flag
    // says so. Sending only the first frame would look like a bug.
    return {
      ok: false,
      message: "This cooler's screen takes still pictures. Animation isn't supported yet.",
    };
  }
}
