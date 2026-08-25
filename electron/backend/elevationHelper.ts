import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Full-hardware-access setup, via exactly one elevated helper.
 *
 * WHY THIS EXISTS
 *
 * Motherboard and RAM lighting is reached over SMBus, which needs
 * administrator rights on Windows. HARE used to solve that by marking its own
 * executable `requireAdministrator`, which had two bad consequences:
 *
 *   1. A UAC prompt on every single launch.
 *   2. "Launch when Windows starts" silently never worked — Windows will not
 *      auto-elevate an app from the Run key, so the registered entry either
 *      did nothing or waited on a prompt nobody was there to answer.
 *
 * Nothing in HARE itself needs elevation. Only OpenRGB does, and HARE talks
 * to it over a localhost socket where the client's privilege level is
 * irrelevant. So HARE now runs unelevated, and elevation is confined to a
 * single Windows **scheduled task** that starts OpenRGB at logon with highest
 * privileges.
 *
 * A scheduled task rather than a Windows service, deliberately: it needs no
 * service binary, no SCM registration, no always-resident process of our own,
 * and it is removed with a single command. It is the smallest mechanism that
 * does the job.
 *
 * The cost is one UAC prompt, once, at the moment the user opts in — and
 * never again. If they never opt in, HARE still drives every USB device
 * normally and says plainly that motherboard and RAM lighting needs the extra
 * step, rather than silently showing nothing.
 */

/** The single task HARE creates. Anything that changes here must change in the uninstaller too (see build/installer.nsh). */
export const OPENRGB_TASK_NAME = "HARE OpenRGB Access";

export type ElevationResult = { ok: true } | { ok: false; message: string };

/** Injectable process runner, so command construction can be tested without spawning anything. */
export interface CommandRunner {
  run(exe: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

const realRunner: CommandRunner = {
  run(exe, args) {
    return new Promise((resolve) => {
      const child = spawn(exe, args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d));
      child.stderr?.on("data", (d) => (stderr += d));
      child.on("error", (err) => resolve({ code: -1, stdout, stderr: String(err) }));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
  },
};

/**
 * Builds the PowerShell argument list that runs an executable elevated and
 * visibly — one UAC prompt, the program's own window, and HARE waits for it
 * to finish.
 *
 * Used for the PawnIO driver installer. Deliberately not silent: a program
 * quietly installing a kernel driver is exactly the behaviour that makes RGB
 * software untrustworthy, and the user should see what they approved.
 *
 * The same single-quote escaping rule as below applies — a path with spaces
 * (`C:\\Users\\Someone's PC\\...`) has to survive PowerShell's parser intact.
 */
export function buildElevatedRunArgs(exePath: string, args: string[]): string[] {
  const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const argumentList = args.length > 0 ? ` -ArgumentList @(${args.map(psQuote).join(",")})` : "";
  return [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Start-Process -FilePath ${psQuote(exePath)} -Verb RunAs -Wait${argumentList}`,
  ];
}

/**
 * Runs an executable elevated. Resolves rather than throws: a user declining
 * the UAC prompt is an ordinary outcome, not an error to report as a failure
 * of HARE.
 */
export async function runElevated(
  exePath: string,
  args: string[] = [],
  runner: CommandRunner = realRunner
): Promise<ElevationResult> {
  if (process.platform !== "win32") {
    return { ok: false, message: "This only works on Windows." };
  }
  const result = await runner.run("powershell.exe", buildElevatedRunArgs(exePath, args));
  if (result.code !== 0) {
    return {
      ok: false,
      message: "That was cancelled, or Windows wouldn't allow it.",
    };
  }
  return { ok: true };
}

/**
 * The PowerShell that registers the logon task, written to a file and run
 * elevated.
 *
 * WHY A SCRIPT FILE AND NOT `schtasks /TR`
 *
 * The first version of this built a `schtasks /Create ... /TR "<exe>" --server`
 * command line and handed it to `Start-Process -ArgumentList`. It looked
 * right and it failed on a real Windows PC: the `/TR` value has to contain
 * double quotes (the executable path has spaces in it), PowerShell re-quotes
 * native arguments on its way out, and the embedded quotes did not survive.
 * schtasks then rejected the command — but because the UAC prompt itself had
 * appeared and been accepted, HARE reported "the permission prompt was
 * dismissed". Wrong action, wrong diagnosis, and no way for the user to tell.
 *
 * The scheduled-task cmdlets take the program and its arguments as separate
 * parameters, so nothing has to be quoted inside anything else. Writing the
 * script to a file and running it with `-File` removes the last layer too:
 * the only thing passed on a command line is a path, in single quotes.
 *
 * The script writes its own outcome to `resultPath`, which is what lets HARE
 * tell "you declined" apart from "it ran and failed, and here is why".
 */
export function buildTaskScript(
  exePath: string,
  port: number,
  taskName: string,
  resultPath: string
): string {
  // Single quotes are PowerShell's literal string; the only character needing
  // escaping inside one is a single quote, doubled.
  const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `  $action = New-ScheduledTaskAction -Execute ${lit(exePath)} -Argument ${lit(`--server --server-port ${port}`)}`,
    "  $trigger = New-ScheduledTaskTrigger -AtLogOn",
    // Highest privileges is the entire point: this is what gives OpenRGB the
    // SMBus access HARE itself deliberately does not ask for.
    "  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest",
    // Without these the task inherits defaults that stop it on battery and
    // kill it after three days — both of which would silently break lighting
    // on a laptop or a PC left running.
    "  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable",
    `  Register-ScheduledTask -TaskName ${lit(taskName)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
    `  Set-Content -Path ${lit(resultPath)} -Value 'ok' -Encoding ASCII`,
    "} catch {",
    `  Set-Content -Path ${lit(resultPath)} -Value ('error: ' + $_.Exception.Message) -Encoding ASCII`,
    "  exit 1",
    "}",
  ].join("\n");
}

/** The PowerShell that removes the task again, same arrangement. */
export function buildRemoveScript(taskName: string, resultPath: string): string {
  const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `  Unregister-ScheduledTask -TaskName ${lit(taskName)} -Confirm:$false`,
    `  Set-Content -Path ${lit(resultPath)} -Value 'ok' -Encoding ASCII`,
    "} catch {",
    `  Set-Content -Path ${lit(resultPath)} -Value ('error: ' + $_.Exception.Message) -Encoding ASCII`,
    "  exit 1",
    "}",
  ].join("\n");
}

/**
 * Runs a script file elevated. The only thing that crosses a command line
 * here is a path inside single quotes, which is the whole reason this shape
 * was chosen — see buildTaskScript.
 */
export function buildElevatedScriptArgs(scriptPath: string): string[] {
  const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const inner = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
    .map(lit)
    .join(",");
  return [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    // -Verb RunAs raises the single UAC prompt; -Wait so the caller learns
    // whether it finished rather than assuming.
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @(${inner})`,
  ];
}

/** The little bit of filesystem this needs, injectable so the flow can be tested without touching disk. */
export interface ScriptFiles {
  write(path: string, contents: string): Promise<void>;
  read(path: string): Promise<string | null>;
  remove(path: string): Promise<void>;
  tempDir(): string;
}

const realFiles: ScriptFiles = {
  async write(path, contents) {
    await fs.writeFile(path, contents, "utf8");
  },
  async read(path) {
    try {
      return await fs.readFile(path, "utf8");
    } catch {
      return null;
    }
  },
  async remove(path) {
    await fs.rm(path, { force: true }).catch(() => {});
  },
  tempDir: () => os.tmpdir(),
};

export class ElevationHelper {
  constructor(
    private runner: CommandRunner = realRunner,
    private files: ScriptFiles = realFiles
  ) {}

  private tempPath(name: string): string {
    return path.join(this.files.tempDir(), name);
  }

  /** Whether the logon task exists. Cheap, unelevated, and safe to call often. */
  async isEnabled(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    const { code } = await this.runner.run("schtasks.exe", ["/Query", "/TN", OPENRGB_TASK_NAME]);
    return code === 0;
  }

  /**
   * Creates the logon task. Raises one UAC prompt; declining is an ordinary
   * outcome rather than an error state — HARE keeps working without it.
   *
   * Three outcomes are told apart, because on a real PC they need different
   * things from the user:
   *   - the prompt was declined (or never answered),
   *   - it ran and Windows refused, with a reason worth showing,
   *   - it worked.
   * The previous version collapsed the middle case into the first and told
   * people they had dismissed a prompt they had actually accepted.
   */
  async enable(openRgbExePath: string, port: number): Promise<ElevationResult> {
    if (process.platform !== "win32") {
      return { ok: false, message: "Full hardware access is a Windows-only feature." };
    }

    const scriptPath = this.tempPath("hare-grant-access.ps1");
    const resultPath = this.tempPath("hare-grant-access.txt");
    try {
      await this.files.remove(resultPath);
      await this.files.write(
        scriptPath,
        buildTaskScript(openRgbExePath, port, OPENRGB_TASK_NAME, resultPath)
      );

      const { code } = await this.runner.run("powershell.exe", buildElevatedScriptArgs(scriptPath));
      const result = (await this.files.read(resultPath))?.trim() ?? "";

      if (await this.isEnabled()) return { ok: true };

      if (result.startsWith("error:")) {
        return {
          ok: false,
          message: `Windows wouldn't set that up: ${result.slice("error:".length).trim()}`,
        };
      }
      if (code !== 0 && !result) {
        // Start-Process throws when the prompt is declined, so no result file
        // plus a failed outer command really does mean "declined".
        return { ok: false, message: "The permission prompt was declined, so nothing was changed." };
      }
      return {
        ok: false,
        message: "That didn't take effect. Try again, and if it keeps happening a restart usually clears it.",
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      await this.files.remove(scriptPath);
      await this.files.remove(resultPath);
    }
  }

  /** Removes the logon task. Also raises a UAC prompt, since creating it needed one. */
  async disable(): Promise<ElevationResult> {
    if (process.platform !== "win32") return { ok: true };
    const scriptPath = this.tempPath("hare-revoke-access.ps1");
    const resultPath = this.tempPath("hare-revoke-access.txt");
    try {
      await this.files.remove(resultPath);
      await this.files.write(scriptPath, buildRemoveScript(OPENRGB_TASK_NAME, resultPath));
      await this.runner.run("powershell.exe", buildElevatedScriptArgs(scriptPath));
      if (!(await this.isEnabled())) return { ok: true };
      const result = (await this.files.read(resultPath))?.trim() ?? "";
      return {
        ok: false,
        message: result.startsWith("error:")
          ? result.slice("error:".length).trim()
          : "Couldn't remove the permission.",
      };
    } finally {
      await this.files.remove(scriptPath);
      await this.files.remove(resultPath);
    }
  }

  /** Runs the task now, so the user doesn't have to log out and back in after enabling it. */
  async startNow(): Promise<ElevationResult> {
    if (process.platform !== "win32") return { ok: true };
    const { code, stderr } = await this.runner.run("schtasks.exe", ["/Run", "/TN", OPENRGB_TASK_NAME]);
    return code === 0 ? { ok: true } : { ok: false, message: stderr.trim() || "Couldn't start it." };
  }
}
