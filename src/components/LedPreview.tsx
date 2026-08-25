import type { KLColor } from "../../electron/backend/types";

function toCss(c: KLColor): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/**
 * Renders a device's live LED colors as a friendly strip of glowing dots.
 * Long strips (e.g. a 68-key keyboard) are sampled down so the row stays
 * readable instead of turning into a wall of tiny pixels.
 */
export function LedPreview({
  colors,
  maxDots = 18,
  size = "md",
}: {
  colors: KLColor[];
  maxDots?: number;
  size?: "sm" | "md" | "lg";
}) {
  const dotSize = size === "sm" ? "h-2 w-2" : size === "lg" ? "h-4 w-4" : "h-3 w-3";
  const gap = size === "sm" ? "gap-1" : "gap-1.5";

  if (colors.length === 0) {
    return <div className="h-3 w-full rounded-full bg-hare-panel2" />;
  }

  const step = Math.max(1, Math.ceil(colors.length / maxDots));
  const sampled = colors.filter((_, i) => i % step === 0).slice(0, maxDots);

  return (
    <div className={`flex items-center ${gap}`}>
      {sampled.map((c, i) => (
        <span
          key={i}
          className={`${dotSize} rounded-full shrink-0`}
          style={{
            backgroundColor: toCss(c),
            boxShadow: `0 0 8px 0 ${toCss(c)}99`,
          }}
        />
      ))}
    </div>
  );
}
