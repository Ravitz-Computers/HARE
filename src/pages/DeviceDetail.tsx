import { useMemo, useState } from "react";
import { ArrowLeft, Check, Info, Wand2, BookmarkPlus } from "lucide-react";
import { motion } from "framer-motion";
import { deviceIcon } from "../components/icons";
import { LedPreview } from "../components/LedPreview";
import { ColorPicker } from "../components/ColorPicker";
import { EffectPreviewSwatch } from "../components/EffectPreviewSwatch";
import { DeviceEffectPreview } from "../components/DeviceEffectPreview";
import { AdvancedMode } from "../components/AdvancedMode";
import { LayerEditor } from "../components/LayerEditor";
import { ZoneSizeEditor } from "../components/ZoneSizeEditor";
import { categoryForDevice, controllerNote, friendlyDeviceType, groupRamKits } from "@/lib/deviceClassification";
import { useHareStore } from "@/state/store";
import type { EffectId, KLColor, KLDevice, KLZone } from "../../electron/backend/types";

export function DeviceDetail({ deviceId, onBack }: { deviceId: number; onBack: () => void }) {
  const { state, effects, setDeviceColor, setNativeMode, applyEffect, clearEffect, saveLook, run } =
    useHareStore();
  const device = state.devices.find((d) => d.id === deviceId);

  const [color, setColor] = useState<KLColor>({ r: 255, g: 46, b: 122 });
  const [rainbow, setRainbow] = useState(false);
  const [secondaryColor, setSecondaryColor] = useState<KLColor>({ r: 40, g: 120, b: 255 });
  const [selectedEffect, setSelectedEffect] = useState<EffectId | null>(device?.activeEffectId ?? null);
  const [speed, setSpeed] = useState(45);
  const [brightness, setBrightness] = useState(100);
  const [matchingKit, setMatchingKit] = useState(false);
  const [savingLook, setSavingLook] = useState(false);
  const [lookName, setLookName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const effectDef = useMemo(() => effects.find((e) => e.id === selectedEffect) ?? null, [effects, selectedEffect]);

  const kitSiblings = useMemo(() => {
    if (!device || device.type !== "ram") return [];
    const kit = groupRamKits(state.devices).find((k) => k.devices.some((d) => d.id === device.id));
    return kit ? kit.devices.filter((d) => d.id !== device.id) : [];
  }, [device, state.devices]);

  if (!device) {
    return (
      <div className="p-8">
        <button onClick={onBack} className="text-sm text-hare-muted hover:text-hare-text flex items-center gap-1.5">
          <ArrowLeft size={15} /> Back
        </button>
        <p className="text-hare-muted mt-6">This device isn't connected anymore.</p>
      </div>
    );
  }

  const Icon = deviceIcon(device);
  const category = categoryForDevice(device);
  const note = controllerNote(device);
  const zoneSectionLabel = category === "motherboard" ? "Per-header color" : "Per-zone color";

  const handleApplyStatic = () =>
    run("Setting the color", () => setDeviceColor(device.id, color), `${device.name} set.`);

  const handleMatchKit = async () => {
    if (kitSiblings.length === 0) return;
    setMatchingKit(true);
    try {
      await run(
        "Matching the kit",
        () => Promise.all(kitSiblings.map((sibling) => setDeviceColor(sibling.id, color))),
        `Matched ${kitSiblings.length} more stick${kitSiblings.length === 1 ? "" : "s"}.`
      );
    } finally {
      setMatchingKit(false);
    }
  };

  const handleApplyEffect = () => {
    if (!selectedEffect || !effectDef) return;
    if (selectedEffect === "static") {
      void handleApplyStatic();
      return;
    }
    void run(
      `Applying ${effectDef.name}`,
      () =>
        applyEffect({
          deviceId: device.id,
          zoneId: null,
          effectId: selectedEffect,
          color,
          rainbow,
          secondaryColor,
          speed,
          brightness,
        }),
      `${effectDef.name} on ${device.name}.`
    );
  };

  const handleClearEffect = () =>
    void run("Turning the effect off", () => clearEffect(device.id, null), "Effect off.");

  const handleSaveLook = async () => {
    const name = lookName.trim();
    if (!name) return;
    setSavingLook(true);
    try {
      await saveLook({
        name,
        sourceDeviceName: device.name,
        sourceDeviceType: device.type,
        effectId: selectedEffect ?? "static",
        color,
        rainbow,
        secondaryColor,
        speed,
        brightness,
      });
      setLookName("");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSavingLook(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button
        onClick={onBack}
        className="text-sm text-hare-muted hover:text-hare-text flex items-center gap-1.5 mb-6"
      >
        <ArrowLeft size={15} /> Back to devices
      </button>

      <div className="flex items-center gap-4 mb-6">
        <div className="h-12 w-12 rounded-2xl bg-hare-panel2 border border-hare-border flex items-center justify-center text-glow-pink shadow-glow">
          <Icon size={22} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold">{device.name}</h1>
          <p className="text-hare-muted text-sm">
            {device.vendor} · {friendlyDeviceType(device)} · {device.zones.length} zone
            {device.zones.length !== 1 ? "s" : ""} · {device.colors.length} LEDs
          </p>
        </div>
      </div>

      {note && (
        <div className="hr-card p-4 mb-6 flex items-start gap-2.5 text-xs text-hare-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-glow-violet" />
          {note}
        </div>
      )}

      {kitSiblings.length > 0 && (
        <div className="hr-card p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-xs text-hare-muted">
            Part of a {kitSiblings.length + 1}-stick kit with matching sticks — match the color you pick
            below across all of them.
          </p>
          <button
            onClick={() => void handleMatchKit()}
            disabled={matchingKit}
            className="hr-btn-sm"
          >
            <Wand2 size={12} className={matchingKit ? "animate-pulse" : ""} />
            Match {kitSiblings.length} other stick{kitSiblings.length !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      <div className="hr-card p-6 mb-6">
        <p className="text-xs font-medium text-hare-muted mb-3 uppercase tracking-wide">Live preview</p>
        <LedPreview colors={device.colors} maxDots={40} size="lg" />
      </div>

      <div className="hr-card p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <BookmarkPlus size={16} className="text-glow-violet shrink-0 hidden sm:block" />
        <input
          type="text"
          value={lookName}
          onChange={(e) => setLookName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSaveLook()}
          placeholder="Name this look (e.g. Midnight Violet)"
          maxLength={60}
          className="flex-1 rounded-lg border border-hare-border bg-hare-panel2 px-3 py-2 text-sm placeholder:text-hare-muted/70 focus:outline-none focus:border-glow-violet/50"
        />
        <button
          onClick={() => void handleSaveLook()}
          disabled={savingLook || !lookName.trim()}
          className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-gradient text-white text-xs font-medium px-3.5 py-2 shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {savedFlash ? <Check size={13} /> : <BookmarkPlus size={13} className={savingLook ? "animate-pulse" : ""} />}
          {savedFlash ? "Saved to Gallery" : "Save to Gallery"}
        </button>
      </div>

      {/*
        Deliberately uneven columns. Solid Color is a handful of swatches and a
        button; Effects is a grid of every effect plus its parameters. Giving
        them equal halves left one side two-thirds empty on every screen wider
        than a laptop. The narrow column carries the short cards — colour, and
        the device's own firmware modes — and `items-start` stops either one
        stretching to match its neighbour's height for no reason.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
        {/*
          Above everything else on purpose: if an ARGB header still reports
          zero LEDs, no colour or effect chosen below it can possibly show.
        */}
        <ZoneSizeEditor device={device} />
        {/* Solid color */}
        <section className="hr-card p-6">
          <h2 className="font-display font-semibold mb-1">Solid Color</h2>
          <p className="text-xs text-hare-muted mb-4">Pick a color and light up the whole device.</p>
          <ColorPicker value={color} onChange={setColor} />
          <button
            onClick={() => void handleApplyStatic()}
            className="mt-5 w-full rounded-xl bg-brand-gradient text-white text-sm font-medium py-2.5 shadow-glow hover:opacity-90 transition-opacity"
          >
            Apply Solid Color
          </button>

          {device.zones.length > 1 && (
            <div className="mt-6 pt-5 border-t border-hare-border space-y-3">
              <p className="text-xs font-medium text-hare-muted uppercase tracking-wide">{zoneSectionLabel}</p>
              {device.zones.map((zone) => (
                <ZoneColorRow key={zone.id} device={device} zone={zone} initial={color} />
              ))}
            </div>
          )}
        </section>

      {device.modes.length > 0 && (
        <section className="hr-card p-6">
          <h2 className="font-display font-semibold mb-1">Built-in Device Modes</h2>
          <p className="text-xs text-hare-muted mb-4">Effects built into this device's own firmware.</p>
          <div className="flex flex-wrap gap-2">
            {device.modes.map((mode) => (
              <button
                key={mode.id}
                onClick={() =>
                  void run("Switching mode", () => setNativeMode(device.id, mode.id), `${mode.name} on.`)
                }
                aria-pressed={device.activeModeId === mode.id && !device.activeEffectId}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                  device.activeModeId === mode.id && !device.activeEffectId
                    ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                    : "border-hare-border text-hare-muted hover:text-hare-text hover:border-hare-muted/60"
                }`}
              >
                {mode.name}
              </button>
            ))}
          </div>
        </section>
      )}
        </div>

        {/* Effects */}
        <section className="hr-card p-6 lg:col-span-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display font-semibold">Effects</h2>
            {device.activeEffectId && (
              <button onClick={handleClearEffect} className="text-xs text-hare-muted hover:text-hare-text">
                Turn off effect
              </button>
            )}
          </div>
          <p className="text-xs text-hare-muted mb-4">Animated lighting effects.</p>

          <div className="grid grid-cols-2 gap-2.5">
            {effects.map((effect) => {
              const active = selectedEffect === effect.id;
              return (
                <button
                  key={effect.id}
                  onClick={() => setSelectedEffect(effect.id)}
                  aria-pressed={active}
                  className={`relative text-left rounded-xl border p-3 transition-colors ${
                    active
                      ? "border-glow-pink/60 bg-glow-pink/10"
                      : "border-hare-border bg-hare-panel2 hover:border-hare-muted/60"
                  }`}
                >
                  {active && (
                    <span className="absolute top-2 right-2 text-glow-pink">
                      <Check size={13} />
                    </span>
                  )}
                  <p className="text-xs font-medium mb-2">{effect.name}</p>
                  <EffectPreviewSwatch
                    effectId={effect.id}
                    color={color}
                    rainbow={rainbow}
                    secondaryColor={secondaryColor}
                    dots={8}
                    speed={speed}
                  />
                </button>
              );
            })}
          </div>

          {effectDef && state.effectProblems?.[effectDef.id] && (
            <p className="mt-4 flex items-start gap-1.5 rounded-lg border border-glow-amber/30 bg-glow-amber/10 p-2.5 text-xs text-hare-muted">
              <Info size={13} className="mt-0.5 shrink-0 text-glow-amber" />
              {state.effectProblems[effectDef.id]}
            </p>
          )}

          {effectDef && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-5 pt-5 border-t border-hare-border space-y-4"
            >
              <p className="text-xs text-hare-muted">{effectDef.description}</p>

              {effectDef.params.usesColor && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-hare-muted">Color</span>
                  <ColorPicker
                    value={color}
                    onChange={setColor}
                    compact
                    rainbow={rainbow}
                    onRainbowChange={setRainbow}
                  />
                </div>
              )}

              {effectDef.params.usesSecondaryColor && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-hare-muted">Second color</span>
                  <ColorPicker value={secondaryColor} onChange={setSecondaryColor} compact />
                </div>
              )}

              {effectDef.params.usesSpeed && (
                <label className="block">
                  <span className="text-xs text-hare-muted flex justify-between mb-1.5">
                    <span>Speed</span>
                    <span>{speed}%</span>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    className="w-full"
                  />
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

              <div>
                <p className="text-xs text-hare-muted mb-2">Preview on this device</p>
                <DeviceEffectPreview
                  device={device}
                  assignment={{
                    effectId: effectDef.id,
                    color,
                    secondaryColor,
                    speed,
                    brightness,
                  }}
                />
              </div>

              <button
                onClick={handleApplyEffect}
                className="w-full rounded-xl bg-brand-gradient text-white text-sm font-medium py-2.5 shadow-glow hover:opacity-90 transition-opacity"
              >
                Apply {effectDef.name}
              </button>
            </motion.div>
          )}
        </section>
      </div>

      <section className="hr-card p-6 mt-6">
        <h2 className="font-display font-semibold mb-1">Layers</h2>
        <p className="text-xs text-hare-muted mb-4">
          Stack several effects on this device and mix them together, or loop them as a sequence.
        </p>
        <LayerEditor device={device} />
      </section>

      <AdvancedMode device={device} />
    </div>
  );
}

/**
 * One zone's colour swatch.
 *
 * Each row keeps its own colour. They used to share the page's single colour
 * state, so setting the second zone visibly reset the first — every swatch on
 * the device jumped to whatever was picked last, and nothing on screen matched
 * what the hardware was actually showing.
 */
function ZoneColorRow({ device, zone, initial }: { device: KLDevice; zone: KLZone; initial: KLColor }) {
  const { setZoneColor, run } = useHareStore();
  const [value, setValue] = useState<KLColor>(initial);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-hare-text/90">{zone.name}</span>
      <ColorPicker
        value={value}
        compact
        onChange={(c) => {
          setValue(c);
          void run(`Setting ${zone.name}`, () => setZoneColor(device.id, zone.id, c));
        }}
      />
    </div>
  );
}
