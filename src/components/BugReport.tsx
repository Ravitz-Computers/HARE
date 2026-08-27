import { useState } from "react";
import { Bug, Check, FileText, FolderOpen, Mail } from "lucide-react";
import { getHareApi } from "@/lib/hareApi";
import { useHareStore } from "@/state/store";
import { COMPANY, ISSUES_URL } from "@/lib/appInfo";
import type { SystemReport } from "../../electron/backend/types";

/**
 * Reporting a problem.
 *
 * Opens the person's own email program with the subject and body already
 * written. Deliberately not a form that posts somewhere: HARE sends nothing
 * anywhere on its own, and a report the sender can read in full before it
 * leaves — and reply to afterwards — is worth more than a silent upload.
 *
 * The system details are optional and are only gathered when the box is
 * ticked. Nothing is collected in the background.
 */

/** Every subject starts with this, so reports sort together in an inbox. */
const SUBJECT_TAG = "[HARE-BUG]";

/** A timestamp that reads the same way everywhere and sorts correctly. */
function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

function describeSystem(report: SystemReport): string {
  const yesNo = (v: boolean) => (v ? "yes" : "no");
  const lines = [
    "--- System details (included at my request) ---",
    `HARE: ${report.appVersion} (build ${report.buildStamp})`,
    `Windows: ${report.os} · ${report.arch}`,
    `Electron: ${report.electron}`,
    `OpenRGB: ${report.openRgbVersion ?? "version unknown"}`,
    `Connection: ${report.backendStatus}`,
    `Devices found: ${report.deviceCount}`,
    ...(report.deviceNames.length ? [`  ${report.deviceNames.join("\n  ")}`] : []),
    `PawnIO driver: installed ${yesNo(report.pawnIoInstalled)}, running ${yesNo(report.pawnIoRunning)}`,
    `Hardware permission: ${yesNo(report.elevationEnabled)}`,
    `Sensor sources: ${report.sensorSources.length ? report.sensorSources.join(", ") : "none"}`,
    `Logging: ${yesNo(report.loggingEnabled)}`,
    `Other RGB apps running: ${report.conflicts.length ? report.conflicts.join(", ") : "none"}`,
  ];
  return lines.join("\n");
}

export function BugReport() {
  const { appSettings, setAppSettings, openLogFolder, notify } = useHareStore();
  const [includeSystem, setIncludeSystem] = useState(true);
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const subject = `${SUBJECT_TAG} ${stamp()}`;
      const body = [
        "What went wrong:",
        what.trim() || "(describe what happened here)",
        "",
        "What I was doing when it happened:",
        "",
        "",
        "What I expected instead:",
        "",
        "",
        // The log is the single most useful thing a report can carry, and
        // nobody attaches one unless they're told how — so the instructions
        // travel inside the email rather than sitting on a page they've
        // already left.
        "--- The log ---",
        "If you haven't already: turn on Settings → General → Diagnostic Log,",
        "make the problem happen again, then use \"Open logs folder\" on that",
        "same page and attach today's hare-<date>.log file to this email.",
        "It stays on this PC until you attach it.",
        "",
      ];

      const api = await getHareApi();
      if (includeSystem) {
        body.push(describeSystem(await api.getSystemReport()), "");
      }

      // An email rather than an upload: it hands the whole thing to whatever
      // the person already uses, and they read every word before it's sent.
      // The address and the mailto: scheme live in the main process — see
      // IPC.OPEN_BUG_REPORT — so nothing here can address anywhere else.
      const result = await api.openBugReport(subject, body.join("\n"));
      if (!result.ok) {
        notify("error", result.message);
        return;
      }
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch (err) {
      notify("error", `Couldn't open your email program. ${err instanceof Error ? err.message : ""}`.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hr-card p-6">
      <div className="mb-1 flex items-center gap-2">
        <Bug size={17} className="text-glow-amber" />
        <h2 className="font-display font-semibold">Report a Bug</h2>
      </div>
      <p className="mb-4 text-xs text-hare-muted">
        Opens your email program with a message ready to send to {COMPANY.name}. Nothing is sent
        until you send it.
      </p>

      <label className="block">
        <span className="mb-1.5 block text-xs text-hare-muted">What went wrong?</span>
        <textarea
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="My motherboard lighting doesn't change when I pick a colour."
          className="w-full resize-y rounded-lg border border-hare-border bg-hare-panel2 px-3 py-2 text-sm placeholder:text-hare-muted/70 focus:border-glow-violet/50 focus:outline-none"
        />
      </label>

      <label className="mt-3 flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={includeSystem}
          onChange={(e) => setIncludeSystem(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Include my system details
          <span className="mt-0.5 block text-xs text-hare-muted">
            Which Windows, which HARE, what it found, and whether the driver is there. No names, no
            serial numbers, nothing about your network. You'll see all of it in the email.
          </span>
        </span>
      </label>

      {/* The log is the most useful thing a report can carry, so getting to it
          is one click from here rather than a page away. */}
      <div className="mt-4 rounded-xl border border-hare-border p-3.5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileText size={15} className="text-glow-violet" />
          Attach a log, if you can
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-hare-muted">
          <li>Turn logging on below, if it isn't already.</li>
          <li>Make the problem happen again.</li>
          <li>Open the logs folder and attach today's file to the email.</li>
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          {!appSettings.diagnosticLogging && (
            <button
              onClick={() => void setAppSettings({ diagnosticLogging: true })}
              className="hr-btn-sm"
            >
              <Check size={12} />
              Turn logging on
            </button>
          )}
          <button onClick={() => void openLogFolder()} className="hr-btn-sm">
            <FolderOpen size={12} />
            Open logs folder
          </button>
        </div>
      </div>

      <button
        onClick={() => void send()}
        disabled={busy}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient py-2.5 text-sm font-medium text-white shadow-glow transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <Mail size={15} />
        {sent ? "Opened your email program" : busy ? "Preparing…" : "Write the email"}
      </button>

      <p className="mt-3 text-[11px] text-hare-muted">
        Prefer to file it publicly?{" "}
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-glow-violet hover:underline"
        >
          Open an issue on GitHub
        </a>{" "}
        — that way other people can see it and add what they know.
      </p>
    </section>
  );
}
