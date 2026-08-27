import { useState } from "react";
import { Images, Upload, Download, Trash2, Wand2, ChevronDown } from "lucide-react";
import { EffectPreviewSwatch } from "../components/EffectPreviewSwatch";
import { deviceIcon } from "../components/icons";
import { useHareStore } from "@/state/store";
import type { KLColor, SavedLook } from "../../electron/backend/types";

/** Evenly spaced samples across a painting, so a 130-LED keyboard fits a card. */
function sampleColors(colors: KLColor[], count: number): KLColor[] {
  if (colors.length <= count) return colors;
  return Array.from({ length: count }, (_, i) => colors[Math.floor((i * colors.length) / count)]);
}

function LookCard({ look }: { look: SavedLook }) {
  const { state, deleteLook, applyLook, exportLook, notify, run } = useHareStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<"apply" | "export" | "delete" | null>(null);

  const handleApply = async (deviceId: number) => {
    const target = state.devices.find((d) => d.id === deviceId);
    setBusy("apply");
    try {
      await run(`Applying ${look.name}`, () => applyLook(look.id, deviceId), `${look.name} on ${target?.name ?? "device"}.`);
    } finally {
      setBusy(null);
      setPickerOpen(false);
    }
  };

  const handleExport = async () => {
    setBusy("export");
    try {
      // The result carries the outcome; discarding it meant a failed save
      // looked exactly like a successful one.
      const result = await exportLook(look.id);
      if (result.ok) notify("ok", `Saved ${look.name}.`);
      else if (!result.canceled) notify("error", result.reason);
    } catch (error) {
      notify("error", `Saving ${look.name} failed. ${error instanceof Error ? error.message : ""}`.trim());
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy("delete");
    try {
      await run("Deleting", () => deleteLook(look.id), `Deleted ${look.name}.`);
    } finally {
      setBusy(null);
    }
  };

  const SourceIcon = deviceIcon(look.sourceDeviceType);

  return (
    <div className="hr-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display font-semibold text-sm leading-tight">{look.name}</p>
          <p className="text-xs text-hare-muted mt-0.5 flex items-center gap-1.5">
            <SourceIcon size={12} />
            {look.ledColors?.length ? "Painted on" : "Captured from"} {look.sourceDeviceName}
          </p>
        </div>
        <span className="text-[10px] text-hare-muted whitespace-nowrap">
          {new Date(look.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* A painted look shows the painting. Running it through the effect
          swatch would draw a flat static square, which is the one thing the
          look definitively isn't. */}
      {look.ledColors?.length ? (
        <div className="flex h-4 overflow-hidden rounded-full border border-hare-border">
          {sampleColors(look.ledColors, 24).map((c, i) => (
            <span key={i} className="flex-1" style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }} />
          ))}
        </div>
      ) : (
        <EffectPreviewSwatch
          effectId={look.effectId}
          color={look.color}
          secondaryColor={look.secondaryColor}
          speed={look.speed}
          dots={10}
        />
      )}

      <div className="relative">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            disabled={state.devices.length === 0 || busy !== null}
            aria-expanded={pickerOpen}
            aria-haspopup="menu"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-brand-gradient text-white text-xs font-medium py-2 shadow-glow hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Wand2 size={13} className={busy === "apply" ? "animate-pulse" : ""} />
            Apply to…
            <ChevronDown size={13} />
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={busy !== null}
            title="Save this look as a file"
            className="hr-btn p-2"
          >
            <Download size={14} className={busy === "export" ? "animate-pulse" : ""} />
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={busy !== null}
            title="Delete"
            className="hr-btn hr-btn-danger p-2"
          >
            <Trash2 size={14} className={busy === "delete" ? "animate-pulse" : ""} />
          </button>
        </div>

        {pickerOpen && (
          <>
            {/* Opening this list used to be a one-way door: no click-away, no
                Escape, and the only way out was to apply the look to
                something. */}
            <div
              className="fixed inset-0 z-0"
              onClick={() => setPickerOpen(false)}
              aria-hidden="true"
            />
          <div
            role="menu"
            className="absolute z-10 mt-2 w-full rounded-xl border border-hare-border bg-hare-panel shadow-lg max-h-48 overflow-y-auto"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPickerOpen(false);
            }}
          >
            {state.devices.map((device) => (
              <button
                key={device.id}
                role="menuitem"
                onClick={() => void handleApply(device.id)}
                className="w-full text-left px-3.5 py-2 text-xs hover:bg-hare-panel2 transition-colors first:rounded-t-xl last:rounded-b-xl"
              >
                {device.name}
              </button>
            ))}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

export function GalleryPage() {
  const { gallery, importLook } = useHareStore();
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const handleImport = async () => {
    setImporting(true);
    setImportMessage(null);
    try {
      const result = await importLook();
      if (!result.ok && !result.canceled) setImportMessage(result.reason);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-6 flex-wrap mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold">Gallery</h1>
          <p className="text-hare-muted text-sm mt-1">
            Save a lighting look from any device, apply it to any other, and share it as a file with
            friends.
          </p>
        </div>
        <button
          onClick={() => void handleImport()}
          disabled={importing}
          className="hr-btn"
        >
          <Upload size={15} className={importing ? "animate-pulse" : ""} />
          {importing ? "Importing…" : "Import Look"}
        </button>
      </div>

      {importMessage && (
        <div className="hr-card p-3 mb-6 text-xs text-hare-muted border-glow-amber/30">{importMessage}</div>
      )}

      {gallery.length === 0 ? (
        <div className="hr-card p-12 text-center text-hare-muted">
          <Images size={28} className="mx-auto mb-3 text-hare-muted/60" />
          <p className="font-display text-lg text-hare-text mb-2">No saved looks yet</p>
          <p className="text-sm max-w-md mx-auto">
            Open any device, pick a color or effect, then hit "Save to Gallery."
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {gallery.map((look) => (
            <LookCard key={look.id} look={look} />
          ))}
        </div>
      )}
    </div>
  );
}
