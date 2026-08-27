import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Wifi, SearchX } from "lucide-react";
import { Vinny } from "../components/Vinny";
import { HardwareAccessStep } from "../components/HardwareAccessStep";
import { EffectPreviewSwatch } from "../components/EffectPreviewSwatch";
import type { BackendState } from "../../electron/backend/types";

export function Onboarding({
  state,
  onDone,
  askForAccess,
}: {
  state: BackendState;
  onDone: () => void;
  /** False when HARE has already asked once — see AppSettings.hasAskedForHardwareAccess. */
  askForAccess: boolean;
}) {
  const [step, setStep] = useState<"welcome" | "access">("welcome");

  /*
   * Tied to the backend's real state, not a timer.
   *
   * This used to sit on a fixed 1.6 second countdown that had nothing to do
   * with the scan: on a slow machine it said "0 devices found" while the scan
   * was still running, and on a fast one it made someone wait for a scan that
   * had already finished. A short floor keeps the animation from flashing past
   * on an instant scan.
   */
  const scanning = state.status === "starting" || state.status === "scanning";
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(t);
  }, []);

  const phase: "scanning" | "ready" = scanning || !settled ? "scanning" : "ready";

  return (
    <div className="h-full w-full flex items-center justify-center bg-hare-bg bg-hare-gradient relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-40">
        <div className="absolute -top-32 -left-20 h-96 w-96 rounded-full bg-glow-violet/20 blur-3xl" />
        <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-glow-pink/20 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative hr-card hr-glass w-full max-w-md p-10 text-center"
      >
        {step === "access" ? (
          <HardwareAccessStep onDone={onDone} />
        ) : (
        <>
        {/* Vinny waving — the welcome screen is the one place a greeting belongs. */}
        <motion.div
          className="flex justify-center mb-5"
          initial={{ opacity: 0, y: 8, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <Vinny pose="hello" size={112} className="drop-shadow-[0_0_18px_rgba(255,46,122,0.35)]" />
        </motion.div>
        <h1 className="font-display text-2xl font-semibold">
          Welcome to <span className="bg-brand-gradient bg-clip-text text-transparent">HARE</span>
        </h1>
        <p className="text-hare-muted text-sm mt-2 leading-relaxed">
          One app to control every RGB light on your PC — keyboard, mouse, fans, all of it.
        </p>

        <div className="my-8">
          {phase === "scanning" ? (
            <div className="flex flex-col items-center gap-3">
              <div className="relative h-16 w-16 flex items-center justify-center">
                <span className="absolute inline-flex h-full w-full rounded-full bg-glow-pink/30 animate-ping" />
                <span className="relative inline-flex items-center justify-center h-12 w-12 rounded-full bg-brand-gradient shadow-glow">
                  <Wifi size={20} className="text-white" />
                </span>
              </div>
              <p className="text-xs text-hare-muted">Looking for RGB gear on your PC…</p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3"
            >
              {state.devices.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 text-glow-green text-sm font-medium">
                    <Sparkles size={16} />
                    {state.devices.length} device{state.devices.length === 1 ? "" : "s"} found
                  </div>
                  <EffectPreviewSwatch effectId="rainbow-wave" dots={16} speed={55} />
                </>
              ) : (
                <div className="flex items-center gap-2 text-hare-muted text-sm font-medium">
                  <SearchX size={16} />
                  No devices detected yet
                </div>
              )}
            </motion.div>
          )}
        </div>

        <button
          disabled={phase !== "ready"}
          onClick={() => (askForAccess ? setStep("access") : onDone())}
          className="w-full rounded-xl bg-brand-gradient text-white font-medium py-3 shadow-glow disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {phase === "ready" ? "Let's go" : "Scanning…"}
        </button>

        {state.devices.length === 0 && phase === "ready" && (
          <p className="text-[11px] text-hare-muted/70 mt-3">
            {state.message ?? "Plug in your RGB gear and hit Rescan any time."}
          </p>
        )}
        </>
        )}
      </motion.div>
    </div>
  );
}
