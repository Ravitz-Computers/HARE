import { useHareStore } from "@/state/store";

/**
 * Vinny, the face of Ravitz Computers and of HARE.
 *
 * These are vectors. The same file is the 16-pixel tray icon and the 300-pixel
 * welcome, drawn sharp at both — which is the whole reason they replaced the
 * cut-out bitmaps, one of which had been silently upscaled from 141 pixels.
 *
 * Every pose ships twice, because a drawing that reads on one background
 * disappears on the other: the dark set carries a white outline, the light set
 * a black one. Which is used follows the resolved theme, so nothing on any
 * screen has to think about it.
 */

const lightPack = import.meta.glob("../assets/vinny/light/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const darkPack = import.meta.glob("../assets/vinny/dark/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function byName(pack: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(pack)) {
    out[path.slice(path.lastIndexOf("/") + 1, -4)] = url;
  }
  return out;
}

const LIGHT = byName(lightPack);
const DARK = byName(darkPack);

/** Every pose there is. Typed, so a misspelling is a build error rather than a blank space. */
export type VinnyPose =
  | "all-set-nice"
  | "angry"
  | "confident"
  | "confused"
  | "determined"
  | "excited"
  | "focused"
  | "happy"
  | "hare-logo-1"
  | "hare-logo-2"
  | "hare-taskbar-icon"
  | "hello"
  | "idea"
  | "idea-tip"
  | "investigating"
  | "investigating-with-headphones"
  | "logo-no-words"
  | "logo-with-words"
  | "love"
  | "music"
  | "nice"
  | "peeking"
  | "reading-learning"
  | "running"
  | "setup-configuration"
  | "sitting"
  | "sleeping"
  | "surprised"
  | "teaching"
  | "thank-you"
  | "thinking"
  | "tip-note"
  | "troubleshoot"
  | "warning"
  | "welcome"
  | "working";

/** The file for a pose, for the few places that need a URL rather than an element. */
export function vinnyUrl(pose: VinnyPose, theme: "light" | "dark"): string {
  const pack = theme === "dark" ? DARK : LIGHT;
  return pack[pose] ?? LIGHT[pose] ?? "";
}

export function Vinny({
  pose,
  size,
  className,
  alt = "",
}: {
  pose: VinnyPose;
  /** Rendered box in pixels. Square — every pose is drawn to fit one. */
  size: number;
  className?: string;
  /** Empty by default: Vinny sits beside text that already says the thing. */
  alt?: string;
}) {
  const effective = useHareStore((s) => s.theme.effective);
  return (
    <img
      src={vinnyUrl(pose, effective)}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
      className={`object-contain ${className ?? ""}`}
    />
  );
}
