import { useEffect } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { useHareStore } from "@/state/store";

/** How long a message stays before it clears itself. */
const OK_MS = 2600;
const ERROR_MS = 8000;

/**
 * The corner where HARE answers back.
 *
 * Anything that reaches hardware can fail, and until this existed a failure
 * looked exactly like a success: the click landed, nothing happened, no
 * message. Successes clear themselves quickly; failures stay long enough to
 * read and can be dismissed.
 */
export function Toasts() {
  const { toasts, dismissToast } = useHareStore();

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: { id: number; kind: "ok" | "error"; text: string };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.kind === "error" ? ERROR_MS : OK_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const error = toast.kind === "error";

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3 text-sm shadow-lg backdrop-blur ${
        error
          ? "border-glow-amber/40 bg-glow-amber/10 text-hare-text"
          : "border-hare-border bg-hare-panel2 text-hare-text"
      }`}
    >
      {error ? (
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-glow-amber" />
      ) : (
        <Check size={15} className="mt-0.5 shrink-0 text-glow-green" />
      )}
      <p className="min-w-0 flex-1 leading-snug">{toast.text}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded text-hare-muted transition-colors hover:text-hare-text"
      >
        <X size={14} />
      </button>
    </div>
  );
}
