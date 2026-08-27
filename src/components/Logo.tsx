import { Vinny } from "./Vinny";

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
 * HARE's mark: Vinny in his badge, drawn from the vector supplied by Ravitz
 * Computers, so it is as sharp at 16 pixels as at 400.
 */
export function Logo({ size = 36, withWordmark = false, className = "", variant = "hare" }: LogoProps) {
  const isRavitz = variant === "ravitz";
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Vinny
        pose={isRavitz ? "logo-with-words" : "hare-logo-1"}
        size={size}
        alt={isRavitz ? "Ravitz Computers" : "HARE"}
        className="shrink-0 drop-shadow-[0_0_10px_rgba(255,46,122,0.35)]"
      />
      {withWordmark && (
        <span className="font-display font-bold text-xl tracking-tight text-hare-text">HARE</span>
      )}
    </div>
  );
}
