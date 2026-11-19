import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, screen, shell, type Display } from "electron";
import type { DisplayInfo } from "@shared/types";

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";

export class WindowManager {
  private overlayWindow: BrowserWindow | null = null;
  private dashboardWindow: BrowserWindow | null = null;
  private displayPickers = new Map<number, BrowserWindow>();
  private targetDisplay: Display | null = null;
  private contentProtection = true;
  private overlayVisible = true;
  private isQuitting = false;
  private macKeepAboveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly preloadPath: string) {
    app.on("before-quit", () => {
      this.isQuitting = true;
      this.cleanupPickers();
      if (this.macKeepAboveTimer) {
        clearInterval(this.macKeepAboveTimer);
        this.macKeepAboveTimer = null;
      }
    });
  }

  private buildRendererUrl(view: "overlay" | "dashboard" | "picker", extraParams?: Record<string, string>): string {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const params = new URLSearchParams({ view, ...(extraParams ?? {}) });
    if (devUrl) {
      return `${devUrl}/index.html?${params.toString()}`;
    }
    const fileUrl = pathToFileURL(join(__dirname, "../renderer/index.html"));
    fileUrl.search = params.toString();
    return fileUrl.toString();
  }

  createWindows(initialContentProtection: boolean): void {
    this.contentProtection = initialContentProtection;
    this.targetDisplay = screen.getPrimaryDisplay();
    this.createOverlayWindow();
    this.createDashboardWindow();
  }

  private createOverlayWindow(): void {
    const display = this.getTargetDisplay();
    const win = new BrowserWindow({
      show: false,
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height,
      type: isMac ? "panel" : undefined,
      transparent: true,
      frame: false,
      roundedCorners: false,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
      fullscreenable: false,
      minimizable: false,
      skipTaskbar: true,
      hiddenInMissionControl: isMac,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    win.setTitle("GlassHUD Overlay");
    win.setContentProtection(this.contentProtection);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (isWin) {
      win.setAlwaysOnTop(true, "screen-saver", 1);
    } else if (isMac) {
      win.setAlwaysOnTop(true, "floating", 1);
    }
    win.setIgnoreMouseEvents(true, { forward: true });

    const reapplyProtection = () => {
      if (!win.isDestroyed()) {
        win.setContentProtection(this.contentProtection);
      }
    };
    win.on("show", reapplyProtection);
    win.on("focus", reapplyProtection);
    win.on("restore", reapplyProtection);

    win.once("ready-to-show", () => {
      if (!win.isDestroyed() && this.overlayVisible) {
        win.showInactive();
      }
    });

    win.on("close", (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        this.setOverlayVisible(false);
      }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://")) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });

    void win.loadURL(this.buildRendererUrl("overlay"));
    this.overlayWindow = win;

    if (isMac) {
      if (this.macKeepAboveTimer) clearInterval(this.macKeepAboveTimer);
      let wasUnfocused = false;
      this.macKeepAboveTimer = setInterval(() => {
        if (!this.overlayWindow || this.overlayWindow.isDestroyed() || !this.overlayVisible) return;
        const focused = this.overlayWindow.isFocused();
        if (!focused && !wasUnfocused) {
          this.overlayWindow.showInactive();
          wasUnfocused = true;
        } else if (focused && wasUnfocused) {
          wasUnfocused = false;
        }
      }, 250);
    }
  }

  private createDashboardWindow(): void {
    const display = this.getTargetDisplay();
    const width = Math.min(1120, Math.max(820, display.workArea.width - 120));
    const height = Math.min(760, Math.max(600, display.workArea.height - 120));

    const win = new BrowserWindow({
      show: false,
      width,
      height,
      minWidth: 780,
      minHeight: 560,
      x: Math.floor(display.workArea.x + (display.workArea.width - width) / 2),
      y: Math.floor(display.workArea.y + (display.workArea.height - height) / 2),
      title: "GlassHUD Settings & Sessions",
      titleBarStyle: isMac ? "hiddenInset" : "default",
      trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
      backgroundColor: "#0c0e14",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.setContentProtection(this.contentProtection);

    win.on("close", (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        win.hide();
      }
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://")) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });

    void win.loadURL(this.buildRendererUrl("dashboard"));
    this.dashboardWindow = win;
  }

  getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow && !this.overlayWindow.isDestroyed() ? this.overlayWindow : null;
  }

  getDashboardWindow(): BrowserWindow | null {
    return this.dashboardWindow && !this.dashboardWindow.isDestroyed() ? this.dashboardWindow : null;
  }

  getTargetDisplay(): Display {
    if (this.targetDisplay) {
      const exists = screen.getAllDisplays().find((d) => d.id === this.targetDisplay?.id);
      if (exists) return exists;
    }
    this.targetDisplay = screen.getPrimaryDisplay();
    return this.targetDisplay;
  }

  listDisplays(): DisplayInfo[] {
    const active = this.getTargetDisplay();
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, idx) => ({
      id: d.id,
      label: d.label || `Display ${idx + 1}`,
      primary: d.id === primary.id,
      current: d.id === active.id,
      bounds: { ...d.bounds },
    }));
  }

  moveOverlayToDisplay(displayId: number): DisplayInfo[] {
    const target = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!target) return this.listDisplays();
    this.targetDisplay = target;
    const win = this.getOverlayWindow();
    if (win) {
      win.setBounds(
        {
          x: target.workArea.x,
          y: target.workArea.y,
          width: target.workArea.width,
          height: target.workArea.height,
        },
        false,
      );
    }
    this.cleanupPickers();
    const displays = this.listDisplays();
    this.broadcast("displays:changed", displays);
    return displays;
  }

  showDisplayPickers(): void {
    this.cleanupPickers();
    const currentId = this.getTargetDisplay().id;
    const displays = screen.getAllDisplays();
    for (const d of displays) {
      if (d.id === currentId) continue;
      const picker = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        webPreferences: {
          preload: this.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      picker.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      void picker.loadURL(
        this.buildRendererUrl("picker", {
          displayId: String(d.id),
          label: d.label || `Display ${d.id}`,
        }),
      );
      this.displayPickers.set(d.id, picker);
    }
  }

  cleanupPickers(): void {
    for (const win of this.displayPickers.values()) {
      if (!win.isDestroyed()) win.close();
    }
    this.displayPickers.clear();
  }

  setOverlayVisible(visible: boolean): boolean {
    this.overlayVisible = visible;
    const win = this.getOverlayWindow();
    if (!win) return false;
    if (visible) {
      win.showInactive();
      win.setContentProtection(this.contentProtection);
    } else {
      win.hide();
    }
    this.broadcast("overlay:visibility", { visible });
    return visible;
  }

  toggleOverlayVisible(): boolean {
    return this.setOverlayVisible(!this.overlayVisible);
  }

  isOverlayVisible(): boolean {
    return this.overlayVisible;
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    const win = this.getOverlayWindow();
    if (win) {
      win.setIgnoreMouseEvents(ignore, { forward: true });
    }
  }

  focusOverlay(): void {
    const win = this.getOverlayWindow();
    if (win) {
      if (!this.overlayVisible) this.setOverlayVisible(true);
      win.show();
      win.focus();
    }
  }

  setContentProtection(enabled: boolean): void {
    this.contentProtection = enabled;
    const ov = this.getOverlayWindow();
    const db = this.getDashboardWindow();
    if (ov) ov.setContentProtection(enabled);
    if (db) db.setContentProtection(enabled);
  }

  adjustOverlayZoom(delta: number): number {
    const ov = this.getOverlayWindow();
    if (!ov) return 100;
    const next = Math.max(-3, Math.min(3, ov.webContents.getZoomLevel() + delta));
    ov.webContents.setZoomLevel(next);
    return Math.round(ov.webContents.getZoomFactor() * 100);
  }

  resetOverlayZoom(): number {
    const ov = this.getOverlayWindow();
    if (!ov) return 100;
    ov.webContents.setZoomLevel(0);
    return 100;
  }

  showDashboard(tab?: string): void {
    const win = this.getDashboardWindow();
    if (!win) return;
    win.show();
    win.focus();
    if (tab) {
      win.webContents.send("dashboard:navigate", { tab });
    }
  }

  hideDashboard(): void {
    this.getDashboardWindow()?.hide();
  }

  broadcast(channel: string, payload: unknown): void {
    const ov = this.getOverlayWindow();
    const db = this.getDashboardWindow();
    if (ov) ov.webContents.send(channel, payload);
    if (db) db.webContents.send(channel, payload);
  }
}
