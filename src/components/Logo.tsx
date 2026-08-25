import ravitzLogo from "../assets/ravitz-logo.png";
import vinnyBadge from "../assets/vinny/badge-rgb.png";

interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  /**
   * `hare` is Vinny in the RGB badge — the app's own mark, and what Windows
   * shows for it. `ravitz` is the Ravitz Computers medallion, which is the
   * company's mark rather than this program's, and belongs where authorship
   * is being stated (Settings → About) rather than on every screen.
   */
  variant?: "hare" | "ravitz";
}

/**
 * HARE's mark: Vinny the hare inside the RGB strip badge, from the character
 * sheet supplied by Ravitz Computers.
 *
 * Every asset is cut from that sheet by scripts/extract_vinny.py rather than
 * by hand, so a revised sheet regenerates them all identically — see that
 * script for how the sprites are separated from the backdrop.
 */
export function Logo({ size = 36, withWordmark = false, className = "", variant = "hare" }: LogoProps) {
  const isRavitz = variant === "ravitz";
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src={isRavitz ? ravitzLogo : vinnyBadge}
        alt={isRavitz ? "Ravitz Computers" : "HARE"}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="shrink-0 object-contain drop-shadow-[0_0_10px_rgba(255,46,122,0.35)]"
      />
      {withWordmark && (
        <span className="font-display font-bold text-xl tracking-tight text-hare-text">HARE</span>
      )}
    </div>
  );
}
