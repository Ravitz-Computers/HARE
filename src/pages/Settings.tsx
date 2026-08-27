import { useEffect, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  Search,
  DatabaseZap,
  AlertTriangle,
  Rocket,
  RotateCcw,
  Minimize2,
  Sun,
  Moon,
  Laptop,
  DownloadCloud,
  UploadCloud,
  Archive,
  ExternalLink,
  FileText,
  Stethoscope,
  FolderOpen,
  Plug,
  Sparkles,
  ShieldCheck,
  LifeBuoy,
  Info,
} from "lucide-react";
import { useHareStore } from "@/state/store";
import { AboutPanel, HelpPanel } from "./settingsHelp";
import { ModuleList } from "../components/ModuleList";
import { SensorSettings } from "../components/SensorSettings";
import type { AppSettings, ThemePreference, VendorId } from "../../electron/backend/types";

const TABS = [
  { id: "hardware", label: "Hardware", icon: Plug },
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "general", label: "General", icon: Rocket },
  { id: "help", label: "Help", icon: LifeBuoy },
  { id: "about", label: "About", icon: Info },
] as const;

type TabId = (typeof TABS)[number]["id"];

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Laptop },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

// A plain colored circle rather than a sliding pill switch — simpler and
// immune to the positioning bugs a track+knob layout invites (the knob
// needing pixel-perfect offsets against the track that can drift with any
// surrounding layout change). Green = on, grey = off; on/off state and
// color are the only things that ever change here.
function Toggle({
  on,
  onClick,
  disabled,
  label,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** What this switch controls. Required — a bare circle has nothing to read out. */
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      title={on ? "On — click to turn off" : "Off — click to turn on"}
      className={`h-6 w-6 shrink-0 rounded-full border-2 transition-colors disabled:opacity-50 ${
        on
          ? "bg-glow-green border-glow-green shadow-[0_0_10px_0_rgba(61,220,151,0.6)]"
          : "bg-transparent border-hare-border hover:border-hare-muted"
      }`}
    />
  );
}

export function SettingsPage() {
  const {
    state,
    dbStatus,
    appSettings,
    theme,
    discovering,
    rescan,
    discover,
    setAppSettings,
    exportBackup,
    importBackup,
    vendors,
    vendorsRechecking,
    recheckVendors,
    syncVendorColor,
    elevation,
    elevationBusy,
    setElevationEnabled,
    openLogFolder,
    logFolder,
    refreshLogFolder,
    openOpenRgb,
    restartOpenRgb,
    notify,
    run,
  } = useHareStore();
  const [openRgbMessage, setOpenRgbMessage] = useState<string | null>(null);

  /** Turns logging on if it's off, and shows the folder either way — one button, no wrong answer. */
  const handleOpenLogs = async () => {
    if (!appSettings.diagnosticLogging) {
      await setAppSettings({ diagnosticLogging: true });
      setOpenRgbMessage("Logging is on. Reproduce the problem, then open this folder again.");
    }
    await openLogFolder();
  };

  const [restarting, setRestarting] = useState(false);

  /**
   * Stops OpenRGB and starts it again.
   *
   * What actually happens depends on who started the server -- HARE, the
   * elevated logon task, or the person themselves -- and the message says
   * which, because the next thing to try is different in each case.
   */
  const handleRestartOpenRgb = async () => {
    setRestarting(true);
    setOpenRgbMessage("Stopping OpenRGB…");
    try {
      const result = await restartOpenRgb();
      setOpenRgbMessage(result.message);
      notify(result.ok ? "ok" : "error", result.message);
    } finally {
      setRestarting(false);
    }
  };

  const handleOpenOpenRgb = async () => {
    const result = await openOpenRgb();
    setOpenRgbMessage(result.ok ? "Opened — it may take a few seconds to appear." : result.message);
  };

  useEffect(() => {
    void refreshLogFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tab, setTab] = useState<TabId>("hardware");
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState<keyof AppSettings | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"export" | "import" | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [vendorTestBusy, setVendorTestBusy] = useState<VendorId | null>(null);
  const [vendorTestMessage, setVendorTestMessage] = useState<Partial<Record<VendorId, string>>>({});

  const [elevationMessage, setElevationMessage] = useState<string | null>(null);
  /*
   * A widget from someone else is code HARE would run inside its own window,
   * which is a different kind of risk from importing a saved look (data HARE
   * reads). Nothing is loaded until the sandbox and signature checks exist —
   * see the roadmap — so the control below says so and stays disabled.
   */

  const handleElevation = async (enabled: boolean) => {
    setElevationMessage(null);
    const result = await setElevationEnabled(enabled);
    if (!result.ok) setElevationMessage(result.message);
    else if (enabled) setElevationMessage("Enabled — rescanning for your motherboard and RAM.");
  };

  const handleRescan = async () => {
    setBusy(true);
    try {
      // Without the finally, one failed rescan left the button spinning and
      // disabled for the rest of the session — the one control someone reaches
      // for when nothing is detected.
      await run("Rescanning", () => rescan());
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (key: keyof AppSettings) => {
    setSettingsBusy(key);
    try {
      await setAppSettings({ [key]: !appSettings[key] });
    } finally {
      setSettingsBusy(null);
    }
  };

  const handleThemeChange = async (themePreference: ThemePreference) => {
    if (themePreference === appSettings.themePreference) return;
    setThemeBusy(true);
    try {
      await setAppSettings({ themePreference });
    } finally {
      setThemeBusy(false);
    }
  };

  const handleExportBackup = async () => {
    setBackupBusy("export");
    setBackupMessage(null);
    try {
      const result = await exportBackup();
      if (result.ok) setBackupMessage(`Saved to ${result.path}`);
      else if (!result.canceled) setBackupMessage(result.reason);
    } finally {
      setBackupBusy(null);
    }
  };

  const handleImportBackup = async () => {
    setBackupBusy("import");
    setBackupMessage(null);
    try {
      const result = await importBackup();
      if (result.ok) setBackupMessage("Settings and gallery restored.");
      else if (!result.canceled) setBackupMessage(result.reason);
    } finally {
      setBackupBusy(null);
    }
  };

  const handleRecheckVendors = async () => {
    await recheckVendors();
  };

  const handleTestVendorColor = async (vendorId: VendorId) => {
    setVendorTestBusy(vendorId);
    setVendorTestMessage((prev) => ({ ...prev, [vendorId]: "" }));
    try {
      // A quick magenta flash — visible, unambiguous, and matches HARE's
      // own brand accent, so it doesn't look like a stray bug if it fires.
      const result = await syncVendorColor(vendorId, { r: 255, g: 0, b: 200 });
      setVendorTestMessage((prev) => ({
        ...prev,
        [vendorId]: result.ok ? "Sent — check your lighting." : result.message,
      }));
    } finally {
      setVendorTestBusy(null);
    }
  };

  const showMessage = state.devices.length === 0 && !!state.message;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <p className="text-hare-muted text-sm mt-1">Tune how HARE talks to your hardware.</p>
      </div>

      <div role="tablist" aria-label="Settings sections" className="flex flex-wrap gap-1.5 mb-6">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium border transition-colors ${
                active
                  ? "border-glow-violet/60 bg-glow-violet/15 text-glow-violet"
                  : "border-hare-border text-hare-muted hover:text-hare-text"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="space-y-6">
        {tab === "hardware" && (
          <>
                  <section className="hr-card p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Stethoscope size={17} className="text-glow-violet" />
                      <h2 className="font-display font-semibold">Lighting Not Changing?</h2>
                    </div>
                    <p className="text-xs text-hare-muted mb-4">
                      Open OpenRGB — the engine HARE drives — and try the same device there. If it can't
                      change your lighting either, the problem is underneath HARE: usually the one-time
                      permission below, or the PawnIO driver for motherboard and RAM lighting.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {/*
                        First, because it's the one that fixes things. OpenRGB
                        can end up connected but no longer responding, and
                        without this the only way out is closing HARE and
                        finding OpenRGB.exe in Task Manager.
                      */}
                      <button
                        onClick={() => void handleRestartOpenRgb()}
                        disabled={restarting}
                        title="Stops OpenRGB and starts it again. Your saved lighting is reapplied."
                        className="hr-btn"
                      >
                        <RotateCcw size={15} className={restarting ? "animate-spin" : ""} />
                        {restarting ? "Restarting…" : "Restart OpenRGB"}
                      </button>
                      <button
                        onClick={() => void handleOpenOpenRgb()}
                        className="hr-btn"
                      >
                        <ExternalLink size={15} />
                        Open OpenRGB
                      </button>
                      <button
                        onClick={() => void handleOpenLogs()}
                        className="hr-btn"
                      >
                        <FileText size={15} />
                        {appSettings.diagnosticLogging ? "Open the log" : "Turn on logging"}
                      </button>
                    </div>
                    {openRgbMessage && <p className="mt-3 text-xs text-hare-muted">{openRgbMessage}</p>}
                  </section>
                  <section className="hr-card p-6">
                    <h2 className="font-display font-semibold mb-1">Hardware Connection</h2>
                    <div className="rounded-xl border border-hare-border p-4">
                      <p className="text-sm font-medium">
                        {state.devices.length > 0
                          ? `${state.devices.length} device${state.devices.length === 1 ? "" : "s"} connected`
                          : "No devices detected"}
                      </p>
                      <p className="text-xs text-hare-muted mt-1">
                        Plug in RGB gear (or make sure OpenRGB-compatible hardware is powered) and hit rescan.
                      </p>
                    </div>
                    <button
                      onClick={handleRescan}
                      disabled={busy}
                      className="mt-4 flex items-center gap-2 text-sm text-hare-muted hover:text-hare-text"
                    >
                      <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
                      Rescan for devices
                    </button>

                    {showMessage && (
                      <p className="mt-4 flex items-start gap-1.5 rounded-lg border border-glow-amber/30 bg-glow-amber/10 p-3 text-xs text-hare-muted">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-glow-amber" />
                        {state.message}
                      </p>
                    )}

                    {elevation.supported && (
                      <div className="mt-5 pt-5 border-t border-hare-border">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium flex items-center gap-1.5">
                              <ShieldCheck
                                size={15}
                                className={elevation.enabled ? "text-glow-green" : "text-hare-muted"}
                              />
                              Motherboard and RAM lighting
                            </p>
                            <p className="text-xs text-hare-muted mt-1">
                              {elevation.enabled
                                ? "Enabled. Your motherboard and RAM are available like any other device."
                                : "These need one extra Windows permission. HARE will ask once, then never again."}
                            </p>
                          </div>
                          <button
                            onClick={() => void handleElevation(!elevation.enabled)}
                            disabled={elevationBusy}
                            className="shrink-0 whitespace-nowrap rounded-lg border border-hare-border px-3 py-1.5 text-xs font-medium text-hare-muted hover:text-hare-text hover:border-glow-violet/40 transition-colors disabled:opacity-50"
                          >
                            {elevationBusy ? "Working…" : elevation.enabled ? "Turn off" : "Enable"}
                          </button>
                        </div>
                        {elevationMessage && (
                          <p className="mt-3 text-xs text-glow-violet">{elevationMessage}</p>
                        )}
                      </div>
                    )}
                  </section>
                  <section className="hr-card p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <DatabaseZap size={17} className="text-glow-violet" />
                      <h2 className="font-display font-semibold">Device Support</h2>
                    </div>
                    <div className="rounded-xl border border-hare-border p-4 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-hare-muted">Installed version</span>
                        <span className="font-medium">
                          {dbStatus.installed ? dbStatus.installedVersion ?? "Unknown" : "Not installed yet"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-hare-muted">Latest known version</span>
                        <span className="font-medium">{dbStatus.latestVersion ?? "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-hare-muted">Last checked</span>
                        <span className="font-medium">
                          {dbStatus.lastCheckedAt ? new Date(dbStatus.lastCheckedAt).toLocaleString() : "Never yet"}
                        </span>
                      </div>
                      {/*
                        Two lines used to appear together: "HARE will apply it
                        automatically" and "automatic updates aren't available
                        in this build". Only one of them was ever true, and it
                        wasn't the reassuring one — so what's promised now
                        depends on whether this build can actually do it.
                      */}
                      {dbStatus.updateAvailable && (
                        <p className="text-xs text-glow-amber flex items-center gap-1.5 pt-1">
                          <AlertTriangle size={13} className="shrink-0" />
                          {dbStatus.supportsAutoUpdate
                            ? "Newer device support is available — HARE will apply it automatically."
                            : "Newer device support exists, but this build can't fetch it. A newer HARE will include it."}
                        </p>
                      )}
                      {dbStatus.lastError && (
                        <p className="text-xs text-hare-muted flex items-center gap-1.5 pt-1">
                          <AlertTriangle size={13} className="text-glow-amber shrink-0" />
                          Couldn't reach the update server last time: {dbStatus.lastError}
                        </p>
                      )}
                      <p className="text-xs text-hare-muted pt-1">
                        {dbStatus.supportsAutoUpdate
                          ? "Checked automatically at startup."
                          : "Automatic updates aren't available in this build."}
                      </p>
                    </div>

                    <button
                      onClick={() => void discover()}
                      disabled={discovering}
                      className="mt-4 flex items-center gap-2 text-sm text-hare-muted hover:text-hare-text disabled:opacity-60"
                    >
                      <Search size={14} className={discovering ? "animate-pulse" : ""} />
                      {discovering ? "Checking for updates…" : "Check now"}
                    </button>
                  </section>
                  <section className="hr-card p-6">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Plug size={17} className="text-glow-violet" />
                        <h2 className="font-display font-semibold">Modules</h2>
                      </div>
                      <button
                        onClick={() => void handleRecheckVendors()}
                        disabled={vendorsRechecking}
                        className="flex items-center gap-1.5 text-xs text-hare-muted hover:text-hare-text disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={vendorsRechecking ? "animate-spin" : ""} />
                        Recheck
                      </button>
                    </div>
                    <p className="text-xs text-hare-muted mb-4">
              Optional add-ons that let HARE drive another company's RGB app. Most hardware needs
              none of these — HARE already controls it directly through OpenRGB.
            </p>
            <div className="mb-5">
              <ModuleList />
            </div>
            <p className="text-xs font-medium text-hare-muted mb-2 uppercase tracking-wide">Status</p>
            <p className="text-xs text-hare-muted mb-3">
              Connected software appears in <b>My Devices</b> as a device you can put effects and saved
              looks on, the same as anything else.
            </p>
                    <div className="space-y-2">
                      {vendors.map((vendor) => (
                        <div key={vendor.id} className="rounded-xl border border-hare-border p-3.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                  vendor.connected
                                    ? "bg-glow-green shadow-[0_0_8px_0_rgba(61,220,151,0.7)]"
                                    : vendor.detected
                                      ? "bg-glow-amber"
                                      : "bg-hare-border"
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{vendor.name}</p>
                                <p className="text-xs text-hare-muted">{vendor.message}</p>
                                {!vendor.controllable && vendor.notControllableReason && (
                                  <p className="text-xs text-hare-muted mt-0.5">{vendor.notControllableReason}</p>
                                )}
                                {vendorTestMessage[vendor.id] && (
                                  <p className="text-xs text-glow-violet mt-0.5">{vendorTestMessage[vendor.id]}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {/*
                                Three states, not two. Every vendor used to
                                show the same confident green "Live control",
                                including the five whose control path has
                                never been run against the real software —
                                so a proven integration and a best guess
                                looked identical at a glance.
                              */}
                              <span
                                className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${
                                  !vendor.controllable
                                    ? "bg-hare-border/60 text-hare-muted"
                                    : vendor.unverified
                                      ? "bg-glow-amber/15 text-glow-amber"
                                      : "bg-glow-green/15 text-glow-green"
                                }`}
                                title={
                                  vendor.unverified
                                    ? "HARE has a control path for this, but nobody has confirmed it works against the real software yet."
                                    : undefined
                                }
                              >
                                {!vendor.controllable
                                  ? "Read-only"
                                  : vendor.unverified
                                    ? "Untested"
                                    : "Live control"}
                              </span>
                              {vendor.controllable && vendor.connected && (
                                <button
                                  onClick={() => void handleTestVendorColor(vendor.id)}
                                  disabled={vendorTestBusy === vendor.id}
                                  title="Send a test color"
                                  className="flex items-center gap-1 text-xs text-hare-muted hover:text-hare-text disabled:opacity-50"
                                >
                                  <Sparkles size={13} className={vendorTestBusy === vendor.id ? "animate-pulse" : ""} />
                                  Test
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <SensorSettings />
          </>
        )}

        {tab === "appearance" && (
          <>
                  <section className="hr-card p-6">
                    <h2 className="font-display font-semibold mb-1">Appearance</h2>
                    <p className="text-xs text-hare-muted mb-4">
                      Follows Windows' light/dark setting by default — pick Light or Dark to override it.
                    </p>
                    <div
                      role="radiogroup"
                      aria-label="Theme"
                      className="inline-flex rounded-xl border border-hare-border p-1 gap-1"
                    >
                      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                        const active = appSettings.themePreference === value;
                        return (
                          <button
                            key={value}
                            role="radio"
                            aria-checked={active}
                            disabled={themeBusy}
                            onClick={() => void handleThemeChange(value)}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                              active ? "bg-glow-pink text-white" : "text-hare-muted hover:text-hare-text"
                            }`}
                          >
                            <Icon size={14} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-hare-muted mt-3">
                      Currently {theme.effective === "dark" ? "dark" : "light"}
                      {appSettings.themePreference === "system" ? " (matching Windows)" : ""}.
                    </p>
                  </section>
          </>
        )}

        {tab === "general" && (
          <>
                  <section className="hr-card p-6">
                    <h2 className="font-display font-semibold mb-1">App Behavior</h2>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-glow-green" />
                          <span>Minimize to tray on close</span>
                        </div>
                        <span className="text-xs text-hare-muted">Always on</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Rocket size={15} className="text-glow-violet" />
                          <div>
                            <p>Launch HARE when Windows starts</p>
                            <p className="text-xs text-hare-muted">So your lighting is already on when your PC is.</p>
                          </div>
                        </div>
                        <Toggle
                          label="Launch HARE when Windows starts"
                          on={appSettings.launchOnStartup}
                          disabled={settingsBusy === "launchOnStartup"}
                          onClick={() => void handleToggle("launchOnStartup")}
                        />
                      </div>
                      {/* Only relevant while the switch above is on, and
                          shown only then — a setting that can't do anything
                          is a setting worth hiding. */}
                      {appSettings.launchOnStartup && (
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Minimize2 size={15} className="text-glow-violet" />
                            <div>
                              <p>Start in the tray</p>
                              <p className="text-xs text-hare-muted">
                                When Windows starts HARE, no window opens. Opening HARE yourself always
                                shows it.
                              </p>
                            </div>
                          </div>
                          <Toggle
                            label="Start in the tray when Windows starts HARE"
                            on={appSettings.startMinimized}
                            disabled={settingsBusy === "startMinimized"}
                            onClick={() => void handleToggle("startMinimized")}
                          />
                        </div>
                      )}
                    </div>
                  </section>
                  <section className="hr-card p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText size={17} className="text-glow-violet" />
                      <h2 className="font-display font-semibold">Diagnostic Log</h2>
                    </div>
                    <p className="text-xs text-hare-muted mb-4">
                      Records what HARE finds and does, so a problem can be traced. Off unless you turn it
                      on. It stays on this PC — HARE never sends anything anywhere — and each day's file is
                      deleted after three days.
                    </p>
                    <div className="flex items-center justify-between text-sm">
                      <span>Write a log</span>
                      <Toggle
                        label="Write a log"
                        on={appSettings.diagnosticLogging}
                        disabled={settingsBusy === "diagnosticLogging"}
                        onClick={() => void handleToggle("diagnosticLogging")}
                      />
                    </div>
                    {/*
                      Always shown, not only while logging is on: the first
                      thing someone does after turning it on is go looking for
                      the file, and a button that appears and disappears sends
                      them hunting through AppData instead.
                    */}
                    <button
                      onClick={() => void openLogFolder()}
                      className="mt-4 flex items-center gap-2 rounded-xl border border-hare-border px-3.5 py-2 text-sm font-medium text-hare-muted hover:text-hare-text hover:border-glow-violet/40 transition-colors"
                    >
                      <FolderOpen size={15} />
                      Open logs folder
                    </button>
                    {logFolder && (
                      <p className="mt-2 text-[11px] text-hare-muted font-mono break-all">{logFolder}</p>
                    )}

                  </section>
                  {/*
                    Community widgets had a section here with a permanently
                    disabled button in it. A panel that can only ever say no
                    is not a feature — it's a promise on screen with nothing
                    behind it. The work it's waiting on (a manifest, a
                    signature check and a sandbox) is in ROADMAP.md, and the
                    main process still refuses the import outright in case
                    anything ever reaches for it.
                  */}
                  <section className="hr-card p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Archive size={17} className="text-glow-violet" />
                      <h2 className="font-display font-semibold">Backup & Restore</h2>
                    </div>
                    <p className="text-xs text-hare-muted mb-4">Export your settings and Gallery to a file, or restore them from one.</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleExportBackup()}
                        disabled={backupBusy !== null}
                        className="hr-btn"
                      >
                        <DownloadCloud size={15} className={backupBusy === "export" ? "animate-pulse" : ""} />
                        Export Settings
                      </button>
                      <button
                        onClick={() => void handleImportBackup()}
                        disabled={backupBusy !== null}
                        className="flex items-center gap-2 text-sm font-medium text-hare-muted hover:text-hare-text rounded-xl border border-hare-border px-3.5 py-2 hover:border-glow-pink/40 transition-colors disabled:opacity-60"
                      >
                        <UploadCloud size={15} className={backupBusy === "import" ? "animate-pulse" : ""} />
                        Import Settings
                      </button>
                    </div>
                    {backupMessage && <p className="mt-3 text-xs text-hare-muted">{backupMessage}</p>}
                  </section>
          </>
        )}

        {tab === "help" && <HelpPanel />}

        {tab === "about" && <AboutPanel />}
      </div>
    </div>
  );
}
