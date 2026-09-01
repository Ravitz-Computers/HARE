import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, Search, Wand2 } from "lucide-react";
import { DeviceCard } from "../components/DeviceCard";
import { ColorPicker } from "../components/ColorPicker";
import { categoryIcon } from "../components/icons";
import { groupDevicesByCategory, groupRamKits, ramKitLabel } from "@/lib/deviceClassification";
import { useHareStore } from "@/state/store";
import type { EffectId, KLColor } from "../../electron/backend/types";
import { Vinny } from "../components/Vinny";

export function Dashboard({ onOpenDevice }: { onOpenDevice: (id: number) => void }) {
  const { state, effects, dbStatus, conflicts, scanBlockedBy, discovering, rescan, discover, syncAll, setDeviceColor, notify, run } =
    useHareStore();
  const [syncColor, setSyncColor] = useState<KLColor>({ r: 255, g: 46, b: 122 });
  const [syncRainbow, setSyncRainbow] = useState(false);
  const [syncSecondaryColor, setSyncSecondaryColor] = useState<KLColor>({ r: 40, g: 120, b: 255 });
  const [syncEffectId, setSyncEffectId] = useState<EffectId>("rainbow-wave");
  const [syncSpeed, setSyncSpeed] = useState(45);
  const [syncBrightness, setSyncBrightness] = useState(100);
  const [syncing, setSyncing] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [matchingKit, setMatchingKit] = useState<string | null>(null);

  const syncEffect = useMemo(
    () => effects.find((e) => e.id === syncEffectId) ?? effects[0],
    [effects, syncEffectId]
  );

  const handleSyncAll = async () => {
    if (!syncEffect) return;
    if (state.devices.length === 0) {
      notify("error", "Nothing to sync yet. Rescan, or run Discover in Settings.");
      return;
    }
    setSyncing(true);
    try {
      await run(
        `Syncing ${syncEffect.name}`,
        () => syncAll(syncEffect.id, syncColor, syncSecondaryColor, syncSpeed, syncBrightness, syncRainbow),
        `${syncEffect.name} on everything.`
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      await run("Rescanning", () => rescan());
    } finally {
      setRescanning(false);
    }
  };

  const categoryGroups = groupDevicesByCategory(state.devices);
  const ramKits = groupRamKits(state.devices);

  const handleMatchKit = async (kitKey: string) => {
    const kit = ramKits.find((k) => k.key === kitKey);
    if (!kit || kit.devices.length < 2) return;
    setMatchingKit(kitKey);
    try {
      const leadColor = kit.devices[0].colors[0] ?? syncColor;
      await run(
        "Matching the kit",
        () => Promise.all(kit.devices.slice(1).map((d) => setDeviceColor(d.id, leadColor))),
        `Matched ${kit.devices.length - 1} more stick${kit.devices.length === 2 ? "" : "s"}.`
      );
    } finally {
      setMatchingKit(null);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-6 flex-wrap mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold">My Devices</h1>
          <p className="text-hare-muted text-sm mt-1">
            {state.devices.length} device{state.devices.length !== 1 ? "s" : ""} under HARE's
            control. Tap any card to customize it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void discover()}
            disabled={discovering}
            title="Checks for new device support, then rescans."
            className="hr-btn"
          >
            <Search size={15} className={discovering ? "animate-pulse" : ""} />
            {discovering ? "Discovering…" : "Discover"}
          </button>
          <button
            onClick={() => void handleRescan()}
            disabled={rescanning}
            className="flex items-center gap-2 text-sm font-medium text-hare-muted hover:text-hare-text rounded-xl border border-hare-border px-3.5 py-2 hover:border-glow-pink/40 transition-colors disabled:opacity-60"
          >
            <RefreshCw size={15} className={rescanning ? "animate-spin" : ""} />
            Rescan
          </button>
        </div>
      </div>

      {/* A refused scan, not a hint. Shown instead of the banner below,
          because saying "some devices may not appear" under a message that
          says nothing was scanned reads as two different problems. */}
      {scanBlockedBy.length > 0 && (
        <div className="hr-card p-4 mb-6 border-glow-amber/40">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-glow-amber shrink-0" />
            Didn't scan
          </p>
          <p className="text-xs text-hare-muted mt-1.5 leading-relaxed">
            {scanBlockedBy.length === 1
              ? `${scanBlockedBy[0].name} is running and controls ${scanBlockedBy[0].affects}.`
              : `${scanBlockedBy.map((c) => c.name).join(", ")} are running.`}{" "}
            Close {scanBlockedBy.length === 1 ? "it" : "them"} and scan again.
          </p>
          <button
            type="button"
            className="hr-btn-sm mt-3"
            onClick={() => {
              void rescan(true);
            }}
          >
            Scan anyway
          </button>
        </div>
      )}

      {scanBlockedBy.length === 0 && conflicts.length > 0 && (
        <div className="hr-card p-4 mb-6 border-glow-amber/40">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-glow-amber shrink-0" />
            {conflicts.length === 1 ? `${conflicts[0].name} is running` : "Other RGB apps are running"}
          </p>
          <p className="text-xs text-hare-muted mt-1.5 leading-relaxed">
            Only one program can drive {conflicts.length === 1 ? conflicts[0].affects : "your hardware"} at a
            time. While {conflicts.length === 1 ? "it's" : "they're"} open, some devices may not appear here at
            all. Close {conflicts.length === 1 ? "it" : "them"} and hit Rescan.
          </p>
          {conflicts.length > 1 && (
            <ul className="mt-2 space-y-1">
              {conflicts.map((c) => (
                <li key={c.id} className="text-xs text-hare-muted">
                  <span className="text-hare-text/90 font-medium">{c.name}</span> — {c.affects}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dbStatus.lastError && (
        <div className="hr-card p-3 mb-6 text-xs text-hare-muted border-glow-amber/30">
          Couldn't check for new device support: {dbStatus.lastError}
        </div>
      )}

      <div className="hr-card p-5 mb-8">
        <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between mb-4">
          <div>
            <p className="font-display font-semibold text-sm">Sync everything</p>
            <p className="text-xs text-hare-muted mt-0.5">Apply one effect across every device.</p>
          </div>
          <button
            onClick={() => void handleSyncAll()}
            disabled={syncing}
            className="whitespace-nowrap rounded-xl bg-brand-gradient text-white text-sm font-medium px-4 py-2.5 shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync All"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {effects.map((effect) => (
            <button
              key={effect.id}
              onClick={() => setSyncEffectId(effect.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                syncEffectId === effect.id
                  ? "border-glow-pink/60 bg-glow-pink/10 text-glow-pink"
                  : "border-hare-border text-hare-muted hover:text-hare-text"
              }`}
            >
              {effect.name}
            </button>
          ))}
        </div>

        {syncEffect && (
          <div className="flex flex-wrap items-center gap-6">
            {syncEffect.params.usesColor && (
              <ColorPicker
                value={syncColor}
                onChange={setSyncColor}
                compact
                rainbow={syncRainbow}
                onRainbowChange={setSyncRainbow}
              />
            )}

            {syncEffect.params.usesSecondaryColor && (
              <ColorPicker value={syncSecondaryColor} onChange={setSyncSecondaryColor} compact />
            )}

            {syncEffect.params.usesSpeed && (
              <label className="flex items-center gap-2 text-xs text-hare-muted">
                <span className="whitespace-nowrap">Speed {syncSpeed}%</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={syncSpeed}
                  onChange={(e) => setSyncSpeed(Number(e.target.value))}
                  className="w-32"
                />
              </label>
            )}

            {syncEffect.params.usesBrightness && (
              <label className="flex items-center gap-2 text-xs text-hare-muted">
                <span className="whitespace-nowrap">Brightness {syncBrightness}%</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={syncBrightness}
                  onChange={(e) => setSyncBrightness(Number(e.target.value))}
                  className="w-32"
                />
              </label>
            )}
          </div>
        )}
      </div>

      {state.devices.length === 0 ? (
        <div className="hr-card p-12 text-center text-hare-muted">
          {/* Vinny looking for something says "nothing found yet" more kindly than a bare line of text. */}
          <Vinny pose="investigating" size={96} className="mx-auto mb-4 opacity-90" />
          <p className="font-display text-lg text-hare-text mb-2">No devices detected</p>
          <p className="text-sm">
            {state.message ?? "Plug in your RGB gear and hit rescan."}
          </p>
          <button
            onClick={handleRescan}
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-hare-muted hover:text-hare-text rounded-xl border border-hare-border px-3.5 py-2 hover:border-glow-pink/40 transition-colors"
          >
            <RefreshCw size={15} className={rescanning ? "animate-spin" : ""} />
            Rescan
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          {categoryGroups.map((group) => {
            const Icon = categoryIcon(group.category);
            const multiStickKits = group.category === "memory" ? ramKits.filter((k) => k.devices.length > 1) : [];
            return (
              <section key={group.category}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={16} className="text-glow-violet" />
                  <h2 className="font-display font-semibold text-sm">{group.label}</h2>
                  <span className="text-xs text-hare-muted">
                    {group.devices.length} device{group.devices.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-xs text-hare-muted mb-4">{group.blurb}</p>
                {multiStickKits.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {multiStickKits.map((kit) => (
                      <button
                        key={kit.key}
                        onClick={() => void handleMatchKit(kit.key)}
                        disabled={matchingKit === kit.key}
                        title={`Copy ${kit.devices[0].name}'s current color to the other ${kit.devices.length - 1} stick(s) in this kit.`}
                        className="flex items-center gap-1.5 text-xs font-medium text-hare-muted hover:text-hare-text rounded-lg border border-hare-border px-2.5 py-1.5 hover:border-glow-violet/40 transition-colors disabled:opacity-60"
                      >
                        <Wand2 size={12} className={matchingKit === kit.key ? "animate-pulse" : ""} />
                        Match {ramKitLabel(kit)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {group.devices.map((device) => (
                    <DeviceCard key={device.id} device={device} onOpen={() => onOpenDevice(device.id)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
