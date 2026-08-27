import { useEffect, useRef } from "react";
import { useHareStore } from "@/state/store";
import { subscribeToPreviewTicker } from "@/lib/previewTicker";
import type { KLColor } from "../../../electron/backend/types";

/**
 * A slow wash of whatever colors your gear is currently showing — something
 * for the screen to be doing when nobody's using it.
 *
 * Drawn on a canvas rather than with animated CSS gradients: it's a handful
 * of blurred circles per frame at 24fps on the shared preview clock, which
 * costs less than the equivalent stack of compositor layers and stops
 * outright when the window isn't visible.
 */
export function AmbientWidget() {
  const { state } = useHareStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorsRef = useRef<KLColor[]>([]);

  colorsRef.current = state.devices
    .flatMap((d) => d.colors.slice(0, 3))
    .filter((c) => c.r + c.g + c.b > 24)
    .slice(0, 6);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const draw = (elapsed: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      // Kept at CSS pixels rather than devicePixelRatio: this is a blurred
      // wash, so the extra resolution would buy nothing and cost fill rate.
      if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const palette = colorsRef.current.length ? colorsRef.current : [{ r: 90, g: 60, b: 160 }];
      const t = reduceMotion ? 0 : elapsed / 4000;

      palette.forEach((c, i) => {
        const phase = t + (i * Math.PI * 2) / palette.length;
        const x = canvas.width * (0.5 + 0.34 * Math.cos(phase));
        const y = canvas.height * (0.5 + 0.34 * Math.sin(phase * 0.8));
        const radius = Math.max(canvas.width, canvas.height) * 0.45;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0.55)`);
        gradient.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      });
    };

    draw(0);
    if (reduceMotion) return;
    return subscribeToPreviewTicker(draw);
  }, []);

  return (
    <div className="hr-card p-6 flex flex-col overflow-hidden h-full">
      <h2 className="font-display font-semibold text-lg mb-4 shrink-0">Ambient Glow</h2>
      <canvas ref={canvasRef} className="w-full flex-1 min-h-[8rem] rounded-2xl" />
    </div>
  );
}
