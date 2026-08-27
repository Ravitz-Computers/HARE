import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Vinny } from "./Vinny";

/**
 * Vinny approving of a new lighting effect.
 *
 * A small reward for doing the thing the app is for. The rules it follows are
 * what keep it a delight rather than an irritation:
 *
 *   - **It fades.** No pop-in, no bounce. It appears over about a fifth of a
 *     second, sits briefly, and fades out.
 *   - **It never blocks anything.** `pointer-events-none`, so a click aimed
 *     at what's underneath still lands.
 *   - **It doesn't stack.** Applying five effects quickly restarts one
 *     flourish rather than queueing five.
 *   - **It respects reduced motion.** Someone who has asked their system for
 *     less movement gets a plain fade with no drift or scale.
 */
const VISIBLE_MS = 1100;

export function VinnyFlourish({ trigger }: { trigger: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Skips the very first render, or Vinny would appear on page load rather
    // than in response to anything the user did.
    if (trigger === 0) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [trigger]);

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={trigger}
          initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.85, y: reduceMotion ? 0 : 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.95, y: reduceMotion ? 0 : -6 }}
          transition={{ duration: reduceMotion ? 0.25 : 0.22, ease: "easeOut" }}
          className="pointer-events-none fixed bottom-8 right-8 z-50"
          aria-hidden
        >
          <Vinny pose="love" size={80} className="drop-shadow-[0_0_20px_rgba(255,46,122,0.45)]" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
