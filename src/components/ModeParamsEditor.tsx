import { useEffect, useState } from "react";
import { ColorPicker } from "./ColorPicker";
import { useHareStore } from "@/state/store";
import type { KLDevice, KLColor, ModeParamsPatch } from "../../electron/backend/types";
import { MODE_DIRECTION_LABELS, MODE_COLOR_MODE_LABELS } from "../../electron/backend/types";

const DIRECTION_FLAG_GROUPS: { flag: string; options: number[] }[] = [
  { flag: "directionLR", options: [0, 1] },
  { flag: "directionUD", options: [2, 3] },
  { flag: "directionHV", options: [4, 5] },
];

const COLOR_MODE_FLAGS: { flag: string; value: number }[] = [
  { flag: "perLedColor", value: 1 },
  { flag: "modeSpecificColor", value: 2 },
  { flag: "randomColor", value: 3 },
];

/** Full per-mode parameter editing — direction, color mode, brightness, and a mode's own color slots — gated entirely by that mode's own reported flagList, so nothing here ever offers a control the device didn't say it supports. */
export function ModeParamsEditor({ device }: { device: KLDevice }) {
  const { updateModeParams } = useHareStore();
  const [modeId, setModeId] = useState(device.activeModeId);
  const mode = device.modes.find((m) => m.id === modeId) ?? device.modes[0];

  const [speed, setSpeed] = useState(mode?.speed ?? 0);
  const [brightness, setBrightness] = useState(mode?.brightness ?? 0);
  const [direction, setDirection] = useState(mode?.direction ?? 0);
  const [colorMode, setColorMode] = useState(mode?.colorMode ?? 0);
  const [colors, setColors] = useState<KLColor[]>(mode?.colors ?? []);
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = device.modes.find((mm) => mm.id === modeId);
    if (!m) return;
    setSpeed(m.speed ?? 0);
    setBrightness(m.brightness ?? 0);
    setDirection(m.direction ?? 0);
    setColorMode(m.colorMode ?? 0);
    setColors(m.colors ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeId, device.id]);

  if (!mode) return null;

  const hasSpeed = mode.flagList.includes("speed");
  const hasBrightness = mode.flagList.includes("brightness");
  const directionOptions = DIRECTION_FLAG_GROUPS.filter((g) => mode.flagList.includes(g.flag)).flatMap((g) => g.options);
  const colorModeOptions = COLOR_MODE_FLAGS.filter((c) => mode.flagList.includes(c.flag));
  const showColorSlots = colorMode === 2 && mode.colorMax > 0;

  const setColorSlot = (i: number, c: KLColor) => {
    setColors((prev) => {
      const next = [...prev];
      next[i] = c;
      return next;
    });
  };

  const handleApply = async () => {
    setBusy(true);
    try {
      const patch: ModeParamsPatch = {};
      if (hasSpeed) patch.speed = speed;
      if (hasBrightness) patch.brightness = brightness;
      if (directionOptions.length > 0) patch.direction = direction;
      if (colorModeOptions.length > 0) patch.colorMode = colorMode;
      if (showColorSlots) patch.colors = colors.slice(0, mode.colorMax);
      await updateModeParams(device.id, mode.id, patch, persist);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-hare-muted mb-2">Mode</p>
        <div className="flex flex-wrap gap-2">
          {device.modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setModeId(m.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                modeId === m.id
                  ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                  : "border-hare-border text-hare-muted hover:text-hare-text"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {hasSpeed && (
        <label className="block">
          <span className="text-xs text-hare-muted flex justify-between mb-1.5">
            <span>Speed</span>
            <span>{speed}</span>
          </span>
          <input
            type="range"
            min={mode.minSpeed ?? 0}
            max={mode.maxSpeed ?? 100}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-full"
          />
        </label>
      )}

      {hasBrightness && (
        <label className="block">
          <span className="text-xs text-hare-muted flex justify-between mb-1.5">
            <span>Brightness</span>
            <span>{brightness}</span>
          </span>
          <input
            type="range"
            min={mode.brightnessMin ?? 0}
            max={mode.brightnessMax ?? 100}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            className="w-full"
          />
        </label>
      )}

      {directionOptions.length > 0 && (
        <div>
          <p className="text-xs text-hare-muted mb-2">Direction</p>
          <div className="flex flex-wrap gap-2">
            {directionOptions.map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                  direction === d
                    ? "border-glow-pink/60 bg-glow-pink/10 text-glow-pink"
                    : "border-hare-border text-hare-muted hover:text-hare-text"
                }`}
              >
                {MODE_DIRECTION_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
      )}

      {colorModeOptions.length > 0 && (
        <div>
          <p className="text-xs text-hare-muted mb-2">Color mode</p>
          <div className="flex flex-wrap gap-2">
            {colorModeOptions.map((c) => (
              <button
                key={c.value}
                onClick={() => setColorMode(c.value)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                  colorMode === c.value
                    ? "border-glow-pink/60 bg-glow-pink/10 text-glow-pink"
                    : "border-hare-border text-hare-muted hover:text-hare-text"
                }`}
              >
                {MODE_COLOR_MODE_LABELS[c.value]}
              </button>
            ))}
          </div>
        </div>
      )}

      {showColorSlots && (
        <div>
          <p className="text-xs text-hare-muted mb-2">Colors</p>
          <div className="flex flex-wrap gap-2.5">
            {Array.from({ length: mode.colorMax }, (_, i) => (
              <ColorPicker
                key={i}
                compact
                value={colors[i] ?? { r: 255, g: 255, b: 255 }}
                onChange={(c) => setColorSlot(i, c)}
              />
            ))}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-hare-muted">
        <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
        Save to device
      </label>

      <button
        onClick={() => void handleApply()}
        disabled={busy}
        className="w-full rounded-xl bg-brand-gradient text-white text-sm font-medium py-2.5 shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        Apply
      </button>
    </div>
  );
}
