import { BrowserWindow, screen } from "electron";
import { describeDisplay, resolveDashboardDisplayId } from "./dashboardLayout.js";
import type { KLDisplayInfo } from "./types.js";

/**
 * The second-screen dashboard window.
 *
 * A spare monitor — a small panel mounted in a case, an old tablet, a
 * secondary display — showing what your lighting is doing plus controls you
 * can hit without alt-tabbing. It opens frameless and fullscreen on a display
 * you pick, and is meant to be touched rather than clicked precisely.
 *
 * It reuses the main renderer bundle, loading the same page with a
 * `#dashboard` hash rather than a second HTML entry point: one build, one
 * preload, one store, and live device state arriving over the same IPC the
 * main window uses.
 *
 * It is deliberately not a child window — a child would be forced above its
 * parent and would follow it around. This sits on its own display and stays
 * there whether the main window is open, in the tray, or closed.
 */
export interface DashboardWindowOptions {
  isDev: boolean;
  /** Absolute path to preload.cjs. */
  preloadPath: string;
  /** Absolute path to the built index.html, used in packaged builds. */
  indexHtmlPath: string;
  /** Applied to the dashboard window too, so it doesn't inherit Electron's default icon. */
  iconPath: string | undefined;
  /** Called whenever the window opens or closes, so settings can be kept in step. */
  onChange: (open: boolean) => void;
  /** Same navigation guards the main window gets — see main.ts. */
  applyGuards: (win: BrowserWindow) => void;
}

export class DashboardWindow {
  private win: BrowserWindow | null = null;

  constructor(private readonly opts: DashboardWindowOptions) {}

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  /** Every display Windows reports, in a shape the UI can offer as choices. */
  listDisplays(): KLDisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display, index) => describeDisplay(display, index, primaryId));
  }

  /**
   * Opens the dashboard on a given display, or the first non-primary one if
   * none is specified.
   */
  open(displayId?: number | null): void {
    if (this.isOpen) {
      this.moveTo(displayId);
      this.win?.focus();
      return;
    }

    const target = this.resolveDisplay(displayId);

    this.win = new BrowserWindow({
      // Positioned into the target display's bounds rather than opened and
      // then moved, which would flash on the wrong screen first.
      x: target.bounds.x,
      y: target.bounds.y,
      width: target.bounds.width,
      height: target.bounds.height,
      frame: false,
      backgroundColor: "#0b0810",
      title: "HARE Dashboard",
      icon: this.opts.iconPath,
      // Not always-on-top: this owns a whole display, so forcing it above
      // everything would fight anything else the user puts there.
      show: false,
      webPreferences: {
        preload: this.opts.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.opts.applyGuards(this.win);

    this.win.once("ready-to-show", () => {
      this.win?.setFullScreen(true);
      this.win?.show();
    });

    if (this.opts.isDev) {
      void this.win.loadURL("http://localhost:5173/#dashboard");
    } else {
      void this.win.loadFile(this.opts.indexHtmlPath, { hash: "dashboard" });
    }

    this.win.on("closed", () => {
      this.win = null;
      this.opts.onChange(false);
    });

    this.opts.onChange(true);
  }

  /** Moves an already-open dashboard to a different display. */
  moveTo(displayId?: number | null): void {
    if (!this.win || this.win.isDestroyed()) return;
    const target = this.resolveDisplay(displayId);
    // Fullscreen has to come off before a move, or the window stays stuck on
    // its original display.
    this.win.setFullScreen(false);
    this.win.setBounds(target.bounds);
    this.win.setFullScreen(true);
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close();
    this.win = null;
  }

  /** The live window, for broadcasting state to. Null when closed. */
  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /**
   * A saved display id can name a monitor that's since been unplugged, so
   * this always resolves to something real: the requested display, else the
   * first screen that isn't the main one, else the main one.
   */
  private resolveDisplay(displayId?: number | null): Electron.Display {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const id = resolveDashboardDisplayId(displays, primary.id, displayId);
    return displays.find((d) => d.id === id) ?? primary;
  }
}
