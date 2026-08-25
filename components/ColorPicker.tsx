import { Pipette } from "lucide-react";
import type { KLColor } from "../../electron/backend/types";

export const PRESET_COLORS: { name: string; color: KLColor }[] = [
  { name: "Imp Pink", color: { r: 255, g: 46, b: 122 } },
  { name: "Chaos Violet", color: { r: 139, g: 63, b: 251 } },
  { name: "Cyan", color: { r: 34, g: 211, b: 238 } },
  { name: "Amber", color: { r: 255, g: 180, b: 87 } },
  { name: "Blood Rose", color: { r: 255, g: 77, b: 109 } },
  { name: "Green", color: { r: 61, g: 220, b: 151 } },
  { name: "White", color: { r: 255, g: 255, b: 255 } },
  { name: "Red", color: { r: 255, g: 59, b: 48 } },
];

function toHex(c: KLColor): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function fromHex(hex: string): KLColor {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function sameColor(a: KLColor, b: KLColor) {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * Whether to draw an icon on top of this color in black or white.
 * Rec. 601 luma, which tracks perceived brightness well enough that the
 * eyedropper stays readable on every color the picker can produce —
 * including pure white and pure black.
 */
function contrastInk(c: KLColor): string {
  const luma = (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
  return luma > 150 ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.85)";
}

export function ColorPicker({
  value,
  onChange,
  compact = false,
  rainbow = false,
  onRainbowChange,
}: {
  value: KLColor;
  onChange: (color: KLColor) => void;
  compact?: boolean;
  /**
   * "Every colour, slowly cycling" instead of a fixed one. Offered only where
   * the caller can actually carry it through to the hardware — pass
   * onRainbowChange to show the swatch.
   */
  rainbow?: boolean;
  onRainbowChange?: (rainbow: boolean) => void;
}) {
  const size = compact ? "h-6 w-6" : "h-8 w-8";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {onRainbowChange && (
        <button
          title="Rainbow — cycles through every color"
          aria-label="Rainbow"
          aria-pressed={rainbow}
          onClick={() => onRainbowChange(!rainbow)}
          className={`relative rounded-full transition-transform hover:scale-110 ${size}`}
          style={{
            // A real spectrum wheel rather than a gradient bar, so it reads as
            // "all colours" at swatch size next to the solid dots.
            backgroundImage:
              "conic-gradient(#ff2e7a, #ffb457, #3ddc97, #22d3ee, #8b3ffb, #ff2e7a)",
            boxShadow: "0 0 12px 0 rgba(255,255,255,0.35), inset 0 0 0 1px rgba(0,0,0,0.22)",
            outline: rainbow ? "2px solid #8b3ffb" : undefined,
            outlineOffset: rainbow ? "2px" : undefined,
          }}
        />
      )}
      {PRESET_COLORS.map((preset) => {
        // A fixed colour can't also be the selected one while rainbow is on.
        const active = !rainbow && sameColor(preset.color, value);
        return (
          <button
            key={preset.name}
            title={preset.name}
            aria-label={preset.name}
            aria-pressed={active}
            onClick={() => {
              onRainbowChange?.(false);
              onChange(preset.color);
            }}
            className={`relative rounded-full transition-transform hover:scale-110 ${size}`}
            style={{
              backgroundColor: toHex(preset.color),
              // The hairline is what makes pale swatches (White, light amber)
              // visible at all against the light theme's near-white card;
              // without it they read as empty space, which is what made the
              // last visible dot look like a stuck red indicator.
              //
              // It has to live in this same box-shadow rather than a Tailwind
              // `ring-*` class: Tailwind implements rings as box-shadow too,
              // so an inline boxShadow silently replaces them outright.
              boxShadow: `0 0 12px 0 ${toHex(preset.color)}80, inset 0 0 0 1px rgba(0,0,0,0.22)`,
              // Selection uses outline for the same reason — it's a separate
              // property, so it can't be clobbered by the glow.
              outline: active ? "2px solid #8b3ffb" : undefined, // glow.violet in tailwind.config.js
              outlineOffset: active ? "2px" : undefined,
            }}
          />
        );
      })}

      <span className={`mx-0.5 w-px self-stretch bg-hare-border ${compact ? "" : "my-1"}`} aria-hidden />

      {/*
        The currently selected color, which doubles as the custom-color
        picker. This used to be a plain dashed "+" outline that never showed
        the chosen color, so after picking a custom hex there was nothing on
        screen reflecting it — the nearest colored dot (the Red preset) read
        as a broken indicator instead.
      */}
      <label
        className={`relative flex items-center justify-center rounded-full cursor-pointer transition-transform hover:scale-110 ${size}`}
        style={{
          backgroundColor: toHex(value),
          boxShadow: `0 0 12px 0 ${toHex(value)}80, inset 0 0 0 1px rgba(0,0,0,0.22)`,
        }}
        title={`Selected color ${toHex(value)} — click to pick a custom one`}
      >
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => {
            onRainbowChange?.(false);
            onChange(fromHex(e.target.value));
          }}
          aria-label="Custom color"
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <Pipette size={compact ? 11 : 13} style={{ color: contrastInk(value) }} />
      </label>

      {!compact && (
        <span className="text-xs text-hare-muted font-mono ml-1">{rainbow ? "Rainbow" : toHex(value)}</span>
      )}
    </div>
  );
}
