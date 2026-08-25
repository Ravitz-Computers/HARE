import { useEffect, useState } from "react";
import { computeEffectFrame } from "../../electron/backend/effectsEngine";
import { subscribeToPreviewTicker } from "@/lib/previewTicker";
import type { EffectId, KLColor } from "../../electron/backend/types";

/**
 * A tiny 12-dot animated strip that shows what an effect actually looks
 * like, computed with the exact same math the real backend uses. This is
 * what makes the Effects gallery feel alive instead of a plain list.
 */
export function EffectPreviewSwatch({
  effectId,
  color = { r: 255, g: 46, b: 122 },
  rainbow = false,
  secondaryColor,
  dots = 12,
  speed = 45,
  className = "",
}: {
  effectId: EffectId;
  /** Draws the effect with the cycling rainbow colour rather than a fixed one. */
  rainbow?: boolean;
  color?: KLColor;
  /** Only meaningful for two-color effects (EffectDefinition.params.usesSecondaryColor); left undefined, the engine derives one — see secondaryOf() in effectsEngine.ts. */
  secondaryColor?: KLColor;
  dots?: number;
  speed?: number;
  className?: string;
}) {
  const [colors, setColors] = useState<KLColor[]>(() => new Array(dots).fill(color));

  // Driven by one shared clock rather than a timer per swatch — the Effects
  // page shows 18 of these at once, and they stop entirely while the window
  // is hidden. See previewTicker.ts.
  useEffect(() => {
    return subscribeToPreviewTicker((elapsed) => {
      setColors(
        computeEffectFrame(
          { deviceId: 0, zoneId: null, effectId, color, secondaryColor, speed, brightness: 100 },
          dots,
          elapsed
        )
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectId, rainbow, color.r, color.g, color.b, secondaryColor?.r, secondaryColor?.g, secondaryColor?.b, speed, dots]);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {colors.map((c, i) => (
        <span
          key={i}
          className="h-2.5 w-2.5 rounded-full"
          style={{
            backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})`,
            boxShadow: `0 0 6px 0 rgba(${c.r}, ${c.g}, ${c.b}, 0.7)`,
          }}
        />
      ))}
    </div>
  );
}
