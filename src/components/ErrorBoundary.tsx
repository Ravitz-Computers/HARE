import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /**
   * Renders a small card in place of the failing part, instead of taking over
   * the window.
   *
   * For a section that can fail on its own — one cooler screen's controls,
   * say. A fault in one device's panel shouldn't cost the whole tab, which is
   * exactly what happened: a screen whose controls threw made Widgets &
   * Screens impossible to open at all.
   */
  inline?: boolean;
  /** What failed, in the user's terms. Only used by the inline form. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * The last thing standing between a rendering mistake and a white window.
 *
 * A thrown error anywhere in the tree unmounts the whole app, and what's left
 * is a blank screen with no way back. This catches it, says what happened,
 * and offers the one action that reliably recovers: reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Goes to the diagnostic log when logging is on, so a crash someone
    // reports has something behind it.
    console.error("[HARE] Interface error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.inline) {
      return (
        <div className="hr-card border-glow-amber/40 p-3.5">
          <p className="text-sm font-medium">
            {this.props.label ?? "This part"} couldn&apos;t be shown
          </p>
          <p className="mt-1.5 break-words text-xs text-hare-muted">{error.message}</p>
          <p className="mt-1.5 text-[11px] text-hare-muted">
            Everything else on this page still works.
          </p>
        </div>
      );
    }

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-hare-bg p-8">
        <div className="hr-card max-w-md p-6 text-center">
          <h1 className="font-display text-lg font-semibold">HARE hit a snag</h1>
          <p className="mt-2 text-sm text-hare-muted">
            Your lighting is untouched — this is the window, not your devices. Reloading usually
            clears it.
          </p>
          <p className="mt-3 break-words rounded-lg border border-hare-border bg-hare-panel2 p-2.5 text-left text-xs text-hare-muted">
            {error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-medium text-white"
          >
            <RefreshCw size={14} />
            Reload
          </button>
        </div>
      </div>
    );
  }
}
