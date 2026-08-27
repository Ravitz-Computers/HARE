import { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { EffectPreviewSwatch } from "../components/EffectPreviewSwatch";
import { ColorPicker } from "../components/ColorPicker";
import { deviceIcon } from "../components/icons";
import { useHareStore } from "@/state/store";
import type { EffectId, KLColor } from "../../electron/backend/types";

export function EffectsPage() {
  const { state, effects, applyEffect, notify, run } = useHareStore();
  const [selected, setSelected] = useState<EffectId>("rainbow-wave");
  const [color, setColor] = useState<KLColor>({ r: 255, g: 46, b: 122 });
  const [rainbow, setRainbow] = useState(false);
  const [secondaryColor, setSecondaryColor] = useState<KLColor>({ r: 40, g: 120, b: 255 });
  const [speed, setSpeed] = useState(45);
  const [brightness, setBrightness] = useState(100);
  const [targets, setTargets] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);

  // Not asserted non-null: the effect list arrives from the backend, and a
  // build where `selected` names an effect that isn't in it would otherwise
  // take the whole window down rather than show one empty panel.
  const effectDef = useMemo(() => effects.find((e) => e.id === selected) ?? null, [effects, selected]);

  const toggleTarget = (id: number) => {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setTargets(new Set(state.devices.map((d) => d.id)));
  const selectNone = () => setTargets(new Set());

  const handleApply = async () => {
    if (!effectDef) return;
    const ids = targets.size > 0 ? Array.from(targets) : state.devices.map((d) => d.id);
    // Applying to nothing used to report success, which is how "HARE says it
    // worked and nothing lit up" started.
    if (ids.length === 0) {
      notify("error", "No devices to apply to. Connect something, or run Discover in Settings.");
      return;
    }
    setApplying(true);
    const ok = await run(
      `Applying ${effectDef.name}`,
      () =>
        Promise.all(
          ids.map((deviceId) =>
            applyEffect({ deviceId, zoneId: null, effectId: selected, color, secondaryColor, speed, brightness })
          )
        ),
      `${effectDef.name} on ${ids.length} device${ids.length === 1 ? "" : "s"}.`
    );
    setApplying(false);
    if (!ok) return;
    setApplied(true);
    setTimeout(() => setApplied(false), 1600);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="font-display text-2xl font-semibold">Effects</h1>
      <p className="text-hare-muted text-sm mt-1 mb-8">
        Pick an animated look, tune it, then send it to whichever devices you want.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        {effects.map((effect) => {
          const active = selected === effect.id;
          return (
            <button
              key={effect.id}
              onClick={() => setSelected(effect.id)}
              aria-pressed={active}
              className={`relative text-left rounded-2xl border p-4 transition-colors ${
                active
                  ? "border-glow-pink/60 bg-glow-pink/10"
                  : "border-hare-border bg-hare-panel2 hover:border-hare-muted/60"
              }`}
            >
              {active && (
                <span className="absolute top-3 right-3 text-glow-pink">
                  <Check size={14} />
                </span>
              )}
              <p className="font-display font-semibold text-sm mb-1">{effect.name}</p>
              <p className="text-xs text-hare-muted mb-3 leading-relaxed">{effect.description}</p>
              <EffectPreviewSwatch
                rainbow={rainbow}
                effectId={effect.id}
                color={color}
                secondaryColor={secondaryColor}
                dots={10}
                speed={speed}
              />
            </button>
          );
        })}
      </div>

      {effectDef && state.effectProblems?.[effectDef.id] && (
        <div className="hr-card mb-4 flex items-start gap-2 border-glow-amber/40 p-4 text-xs text-hare-muted">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-glow-amber" />
          <span>{state.effectProblems[effectDef.id]}</span>
        </div>
      )}

      {effectDef && (
        <div className="hr-card p-6">
          <h2 className="font-display font-semibold mb-4">Apply "{effectDef.name}"</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {effectDef.params.usesColor && (
                <div>
                  <p className="text-xs text-hare-muted mb-2">Color</p>
                  <ColorPicker value={color} onChange={setColor} rainbow={rainbow} onRainbowChange={setRainbow} />
                </div>
              )}
              {effectDef.params.usesSecondaryColor && (
                <div>
                  <p className="text-xs text-hare-muted mb-2">Second color</p>
                  <ColorPicker value={secondaryColor} onChange={setSecondaryColor} />
                </div>
              )}
              {effectDef.params.usesSpeed && (
                <label className="block">
                  <span className="text-xs text-hare-muted flex justify-between mb-1.5">
                    <span>Speed</span>
                    <span>{speed}%</span>
                  </span>
                  <input type="range" min={1} max={100} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full" />
                </label>
              )}
              {effectDef.params.usesBrightness && (
                <label className="block">
                  <span className="text-xs text-hare-muted flex justify-between mb-1.5">
                    <span>Brightness</span>
                    <span>{brightness}%</span>
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    className="w-full"
                  />
                </label>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-hare-muted">
                  Apply to {targets.size === 0 ? "all devices" : `${targets.size} device${targets.size === 1 ? "" : "s"}`}
                </p>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={selectAll} className="text-glow-pink hover:underline">All</button>
                  <button onClick={selectNone} className="text-hare-muted hover:underline">None</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                {state.devices.map((device) => {
                  const Icon = deviceIcon(device);
                  const active = targets.has(device.id);
                  return (
                    <button
                      key={device.id}
                      onClick={() => toggleTarget(device.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                          : "border-hare-border text-hare-muted hover:text-hare-text"
                      }`}
                    >
                      <Icon size={12} />
                      {device.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            onClick={() => void handleApply()}
            disabled={applying}
            className="mt-6 w-full rounded-xl bg-brand-gradient text-white text-sm font-medium py-2.5 shadow-glow hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {applying ? "Applying…" : applied ? "Applied ✓" : `Apply ${effectDef.name}`}
          </button>
        </div>
      )}
    </div>
  );
}
