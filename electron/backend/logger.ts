import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Opt-in diagnostic logging.
 *
 * HARE runs on hardware nobody here can test against, so when something goes
 * wrong the only useful evidence is what happened on the user's own PC. This
 * writes that down — but only when someone deliberately turns it on, only to
 * their own machine, and only for three days.
 *
 * THE RULES THIS FILE ENFORCES
 *
 *   - **Off by default.** Nothing is written until the user switches it on.
 *   - **Never sent anywhere.** HARE has no telemetry and no uploader. These
 *     files exist so a person can read them, or attach one to a bug report if
 *     they choose to. That choice is always theirs.
 *   - **Deleted after three days.** Old logs are removed on every start and
 *     at every date change, so switching this on can't quietly grow a folder
 *     of forever-history someone forgot about.
 *   - **Failure is silent.** A logger that can throw is a logger that can
 *     take down the thing it was meant to diagnose.
 */

export const LOG_RETENTION_DAYS = 3;

/** Log file names are dated, which is what makes retention a filename comparison rather than a stat() of every file. */
export function logFileName(date: Date): string {
  return `hare-${date.toISOString().slice(0, 10)}.log`;
}

/**
 * Which of these files are old enough to delete.
 *
 * Exported and pure because retention is the part with real consequences: too
 * aggressive and the evidence is gone before anyone reads it, too lax and a
 * promise to the user is quietly broken.
 */
export function expiredLogFiles(names: string[], now: Date, retentionDays = LOG_RETENTION_DAYS): string[] {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffStamp = cutoff.toISOString().slice(0, 10);

  return names.filter((name) => {
    const match = /^hare-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    // Anything that isn't one of ours is left alone. This folder belongs to
    // the user, and deleting unrecognised files from it would be overreach.
    if (!match) return false;
    return match[1] < cutoffStamp;
  });
}

/** One line, as it appears in the file. */
export function formatLine(level: string, message: string, at: Date): string {
  // A local-time stamp, because the person reading this is comparing it
  // against when they saw the problem, not against UTC.
  const time = at.toTimeString().slice(0, 8);
  return `${time} ${level.toUpperCase().padEnd(5)} ${message}`;
}

/** Turns whatever was passed to console.warn into one line of text. */
export function describeArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

const HEADER = [
  "HARE diagnostic log.",
  "",
  "This file is on your PC and nowhere else. HARE has no telemetry and never",
  "uploads anything. It is deleted automatically after three days, and you can",
  "turn logging off in Settings at any time.",
  "",
  "If you're sending this to someone for help, read it first — it records what",
  "hardware HARE found and what it did, which is exactly what makes it useful.",
  "",
].join("\n");

export class DiagnosticLogger {
  private enabled = false;
  private currentFile: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private restoreConsole: (() => void) | null = null;

  constructor(
    private readonly directory: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  get folder(): string {
    return this.directory;
  }

  /**
   * Turns logging on or off.
   *
   * Enabling also captures the main process's own console output, which is
   * where the useful detail already goes — every "couldn't reach OpenRGB" and
   * "device didn't change" message HARE already writes becomes evidence
   * without a single call site having to change.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.restoreConsole?.();
      this.restoreConsole = null;
      return;
    }
    await this.sweep();
    this.captureConsole();
    this.write("info", "Logging started.");
  }

  /** Records a line. Does nothing at all while logging is off. */
  write(level: "info" | "warn" | "error", message: string): void {
    if (!this.enabled) return;
    const at = this.now();
    // Serialised through one promise chain so two writes can't interleave
    // mid-line, without holding a file handle open.
    this.queue = this.queue
      .then(() => this.append(formatLine(level, message, at), at))
      .catch(() => {
        // A logger must never be the reason something fails.
      });
  }

  /** Deletes logs older than the retention window. Safe to call any time. */
  async sweep(): Promise<string[]> {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const names = await fs.readdir(this.directory);
      const expired = expiredLogFiles(names, this.now());
      await Promise.all(expired.map((name) => fs.rm(path.join(this.directory, name), { force: true })));
      return expired;
    } catch {
      return [];
    }
  }

  private async append(line: string, at: Date): Promise<void> {
    const file = path.join(this.directory, logFileName(at));
    if (file !== this.currentFile) {
      // A new day: start its file with the header, and take the chance to
      // clear out anything that has just aged out.
      this.currentFile = file;
      await fs.mkdir(this.directory, { recursive: true });
      let exists = true;
      try {
        await fs.access(file);
      } catch {
        exists = false;
      }
      if (!exists) await fs.writeFile(file, `${HEADER}\n`, "utf8");
      void this.sweep();
    }
    await fs.appendFile(file, `${line}\n`, "utf8");
  }

  private captureConsole(): void {
    if (this.restoreConsole) return;
    const original = { warn: console.warn, error: console.error, log: console.log };
    const forward = (level: "info" | "warn" | "error", fn: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        fn(...args);
        this.write(level, describeArgs(args));
      };
    console.warn = forward("warn", original.warn);
    console.error = forward("error", original.error);
    console.log = forward("info", original.log);
    this.restoreConsole = () => {
      console.warn = original.warn;
      console.error = original.error;
      console.log = original.log;
    };
  }
}
