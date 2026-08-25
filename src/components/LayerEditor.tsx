import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Layers, Plus, Trash2 } from "lucide-react";
import { ColorPicker } from "./ColorPicker";
import { EffectPreviewSwatch } from "./EffectPreviewSwatch";
import { DeviceEffectPreview } from "./DeviceEffectPreview";
import { useHareStore } from "@/state/store";
import { BLEND_MODES } from "../../electron/backend/types";
import type { BlendMode, EffectLayer, KLDevice } from "../../electron/backend/types";

let layerSeq = 0;
function newLayerId(): string {
  layerSeq += 1;
  return `layer-${Date.now().toString(36)}-${layerSeq}`;
}

function makeLayer(over: Partial<EffectLayer> = {}): EffectLayer {
  return {
    id: newLayerId(),
    effectId: "rainbow-wave",
    color: { r: 255, g: 46, b: 122 },
    secondaryColor: { r: 40, g: 120, b: 255 },
    speed: 45,
    brightness: 100,
    opacity: 100,
    blendMode: "normal",
    enabled: true,
    ...over,
  };
}

/**
 * Stack several effects on one device and mix them, optionally on a
 * repeating timeline.
 *
 * Layers are shown top-first — the topmost row is the one composited last,
 * matching how layer panels read in image editors — while the array itself
 * stays bottom-first for the compositor (see LayeredLook).
 */
export function LayerEditor({ device }: { device: KLDevice }) {
  const { effects, applyEffect, clearEffect, saveLook } = useHareStore();
  const [layers, setLayers] = useState<EffectLayer[]>(() => [
    makeLayer({ effectId: "rainbow-wave" }),
    makeLayer({ effectId: "twinkle", blendMode: "add", opacity: 55, color: { r: 255, g: 255, b: 255 } }),
  ]);
  const [loopSeconds, setLoopSeconds] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookName, setLookName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const sequencing = loopSeconds > 0;
  // Displayed top-first; layers[] stays bottom-first for the compositor.
  const displayOrder = [...layers].reverse();

  const patchLayer = (id: string, patch: Partial<EffectLayer>) =>
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLayer = (id: string) => setLayers((prev) => prev.filter((l) => l.id !== id));

  const duplicateLayer = (id: string) =>
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i < 0) return prev;
      const copy = { ...prev[i], id: newLayerId() };
      return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });

  /** `delta` is in display terms: -1 moves a layer visually up (later in the composite). */
  const moveLayer = (id: string, delta: number) =>
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const j = i - delta; // display order is reversed from array order
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const addLayer = () => setLayers((prev) => [...prev, makeLayer()]);

  const assignment = {
    deviceId: device.id,
    zoneId: null,
    // Carried for anything that reads a single effect id (the device's badge,
    // the Gallery) — the stack is what actually renders.
    effectId: layers[layers.length - 1]?.effectId ?? "static",
    color: layers[layers.length - 1]?.color ?? { r: 255, g: 46, b: 122 },
    speed: 45,
    brightness: 100,
    layers,
    loopSeconds: sequencing ? loopSeconds : undefined,
  };

  const handleApply = async () => {
    setBusy(true);
    try {
      await applyEffect(assignment);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const name = lookName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await saveLook({
        name,
        sourceDeviceName: device.name,
        sourceDeviceType: device.type,
        effectId: assignment.effectId,
        color: assignment.color,
        speed: 45,
        brightness: 100,
        layers,
        loopSeconds: sequencing ? loopSeconds : undefined,
      });
      setLookName("");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-hare-muted">
          {layers.length} layer{layers.length === 1 ? "" : "s"}, mixed top to bottom.
        </p>
        <button
          onClick={addLayer}
          className="flex items-center gap-1.5 text-xs font-medium text-hare-muted hover:text-hare-text rounded-lg border border-hare-border px-2.5 py-1.5 hover:border-glow-violet/40 transition-colors"
        >
          <Plus size={13} />
          Add layer
        </button>
      </div>

      <div className="space-y-2">
        {displayOrder.map((layer, displayIndex) => {
          const def = effects.find((e) => e.id === layer.effectId);
          const isOpen = expanded === layer.id;
          return (
            <div key={layer.id} className="rounded-xl border border-hare-border overflow-hidden">
              <div className="flex items-center gap-2 p-2.5">
                <div className="flex flex-col">
                  <button
                    onClick={() => moveLayer(layer.id, -1)}
                    disabled={displayIndex === 0}
                    title="Move up"
                    className="text-hare-muted hover:text-hare-text disabled:opacity-25"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    onClick={() => moveLayer(layer.id, 1)}
                    disabled={displayIndex === displayOrder.length - 1}
                    title="Move down"
                    className="text-hare-muted hover:text-hare-text disabled:opacity-25"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>

                <button
                  onClick={() => patchLayer(layer.id, { enabled: !layer.enabled })}
                  title={layer.enabled ? "Hide this layer" : "Show this layer"}
                  className={`shrink-0 ${layer.enabled ? "text-glow-green" : "text-hare-muted"}`}
                >
                  {layer.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>

                <button
                  onClick={() => setExpanded(isOpen ? null : layer.id)}
                  className={`flex-1 min-w-0 flex items-center gap-2.5 text-left ${layer.enabled ? "" : "opacity-50"}`}
                >
                  <EffectPreviewSwatch
                    effectId={layer.effectId}
                    color={layer.color}
                    secondaryColor={layer.secondaryColor}
                    dots={6}
                    speed={layer.speed}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium truncate">{def?.name ?? layer.effectId}</span>
                    <span className="block text-[11px] text-hare-muted">
                      {BLEND_MODES.find((b) => b.id === layer.blendMode)?.name} · {layer.opacity}%
                    </span>
                  </span>
                </button>

                <button
                  onClick={() => duplicateLayer(layer.id)}
                  title="Duplicate"
                  className="shrink-0 text-hare-muted hover:text-hare-text"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => removeLayer(layer.id)}
                  title="Remove"
                  className="shrink-0 text-hare-muted hover:text-glow-pink"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-hare-border p-3.5 space-y-3.5 bg-hare-panel2">
                  <div>
                    <p className="text-xs text-hare-muted mb-2">Effect</p>
                    <div className="flex flex-wrap gap-1.5">
                      {effects.map((e) => (
                        <button
                          key={e.id}
                          onClick={() => patchLayer(layer.id, { effectId: e.id })}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                            layer.effectId === e.id
                              ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                              : "border-hare-border text-hare-muted hover:text-hare-text"
                          }`}
                        >
                          {e.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-hare-muted mb-2">Blend</p>
                    <div className="flex flex-wrap gap-1.5">
                      {BLEND_MODES.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => patchLayer(layer.id, { blendMode: b.id as BlendMode })}
                          title={b.description}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                            layer.blendMode === b.id
                              ? "border-glow-pink/60 bg-glow-pink/10 text-glow-pink"
                              : "border-hare-border text-hare-muted hover:text-hare-text"
                          }`}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {def?.params.usesColor && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-hare-muted">Color</span>
                      <ColorPicker value={layer.color} onChange={(c) => patchLayer(layer.id, { color: c })} compact />
                    </div>
                  )}
                  {def?.params.usesSecondaryColor && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-hare-muted">Second color</span>
                      <ColorPicker
                        value={layer.secondaryColor ?? { r: 40, g: 120, b: 255 }}
                        onChange={(c) => patchLayer(layer.id, { secondaryColor: c })}
                        compact
                      />
                    </div>
                  )}

                  <label className="block">
                    <span className="text-xs text-hare-muted flex justify-between mb-1">
                      <span>Opacity</span>
                      <span>{layer.opacity}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={layer.opacity}
                      onChange={(e) => patchLayer(layer.id, { opacity: Number(e.target.value) })}
                      className="w-full"
                    />
                  </label>

                  {def?.params.usesSpeed && (
                    <label className="block">
                      <span className="text-xs text-hare-muted flex justify-between mb-1">
                        <span>Speed</span>
                        <span>{layer.speed}%</span>
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        value={layer.speed}
                        onChange={(e) => patchLayer(layer.id, { speed: Number(e.target.value) })}
                        className="w-full"
                      />
                    </label>
                  )}

                  {def?.params.usesBrightness && (
                    <label className="block">
                      <span className="text-xs text-hare-muted flex justify-between mb-1">
                        <span>Brightness</span>
                        <span>{layer.brightness}%</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={layer.brightness}
                        onChange={(e) => patchLayer(layer.id, { brightness: Number(e.target.value) })}
                        className="w-full"
                      />
                    </label>
                  )}

                  {sequencing && (
                    <div className="pt-1 border-t border-hare-border space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-hare-muted">Plays during</span>
                        <button
                          onClick={() =>
                            patchLayer(layer.id, {
                              window: layer.window ? undefined : { fromPct: 0, toPct: 50, fadePct: 10 },
                            })
                          }
                          className="text-[11px] text-hare-muted hover:text-hare-text"
                        >
                          {layer.window ? "Always on" : "Part of the loop"}
                        </button>
                      </div>
                      {layer.window && (
                        <>
                          <label className="block">
                            <span className="text-xs text-hare-muted flex justify-between mb-1">
                              <span>Start</span>
                              <span>{((layer.window.fromPct / 100) * loopSeconds).toFixed(1)}s</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={layer.window.fromPct}
                              onChange={(e) =>
                                patchLayer(layer.id, {
                                  window: { ...layer.window!, fromPct: Number(e.target.value) },
                                })
                              }
                              className="w-full"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs text-hare-muted flex justify-between mb-1">
                              <span>End</span>
                              <span>{((layer.window.toPct / 100) * loopSeconds).toFixed(1)}s</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={layer.window.toPct}
                              onChange={(e) =>
                                patchLayer(layer.id, {
                                  window: { ...layer.window!, toPct: Number(e.target.value) },
                                })
                              }
                              className="w-full"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs text-hare-muted flex justify-between mb-1">
                              <span>Crossfade</span>
                              <span>{layer.window.fadePct}%</span>
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={50}
                              value={layer.window.fadePct}
                              onChange={(e) =>
                                patchLayer(layer.id, {
                                  window: { ...layer.window!, fadePct: Number(e.target.value) },
                                })
                              }
                              className="w-full"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-hare-border p-3.5">
        <label className="flex items-center justify-between gap-3 text-xs text-hare-muted">
          <span>Loop the layers as a sequence</span>
          <input
            type="checkbox"
            checked={sequencing}
            onChange={(e) => setLoopSeconds(e.target.checked ? 10 : 0)}
          />
        </label>
        {sequencing && (
          <label className="block mt-3">
            <span className="text-xs text-hare-muted flex justify-between mb-1">
              <span>Loop length</span>
              <span>{loopSeconds}s</span>
            </span>
            <input
              type="range"
              min={2}
              max={120}
              value={loopSeconds}
              onChange={(e) => setLoopSeconds(Number(e.target.value))}
              className="w-full"
            />
            <span className="block text-[11px] text-hare-muted mt-1.5">
              Open a layer to choose when in the loop it plays.
            </span>
          </label>
        )}
      </div>

      <div>
        <p className="text-xs text-hare-muted mb-2">Preview on this device</p>
        <DeviceEffectPreview device={device} assignment={assignment} />
      </div>

      <button
        onClick={() => void handleApply()}
        disabled={busy}
        className="w-full rounded-xl bg-brand-gradient text-white text-sm font-medium py-2.5 shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <span className="inline-flex items-center gap-1.5">
          <Layers size={14} />
          Apply layers
        </span>
      </button>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={lookName}
          onChange={(e) => setLookName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSave()}
          placeholder="Name this look to save it"
          maxLength={60}
          className="flex-1 rounded-lg border border-hare-border bg-hare-panel2 px-3 py-2 text-xs placeholder:text-hare-muted/70 focus:outline-none focus:border-glow-violet/50"
        />
        <button
          onClick={() => void handleSave()}
          disabled={busy || !lookName.trim()}
          className="whitespace-nowrap rounded-lg border border-hare-border px-3 py-2 text-xs font-medium text-hare-muted hover:text-hare-text hover:border-glow-violet/40 transition-colors disabled:opacity-50"
        >
          {savedFlash ? "Saved to Gallery" : "Save to Gallery"}
        </button>
        <button
          onClick={() => clearEffect(device.id, null)}
          className="whitespace-nowrap rounded-lg border border-hare-border px-3 py-2 text-xs font-medium text-hare-muted hover:text-hare-text transition-colors"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
