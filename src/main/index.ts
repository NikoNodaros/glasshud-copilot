import { join } from "node:path";
import { app, Menu, nativeImage, safeStorage, screen, Tray } from "electron";
import type { ShortcutAction } from "@shared/types";
import { AiOrchestrator } from "./ai";
import { AudioCaptureCoordinator } from "./audioCapture";
import { registerIpcHandlers } from "./ipc";
import { ShortcutManager } from "./shortcuts";
import { LocalStore } from "./store";
import { WindowManager } from "./windows";

let tray: Tray | null = null;

function createTrayIcon(): Electron.NativeImage {
  // Crisp 18x18 monochrome template icon for the macOS menu bar / system tray
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">',
    '<rect x="2" y="3" width="14" height="12" rx="3.2" fill="none" stroke="black" stroke-width="1.6"/>',
    '<circle cx="6.2" cy="9" r="1.4" fill="black"/>',
    '<rect x="9.2" y="7.8" width="4.4" height="2.4" rx="1.2" fill="black"/>',
    "</svg>",
  ].join("");
  const img = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  img.setTemplateImage(true);
  return img;
}

function buildApplicationMenu(windows: WindowManager): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings & History...",
                accelerator: "CmdOrCtrl+,",
                click: () => windows.showDashboard("keys"),
              },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Overlay",
          click: () => windows.toggleOverlayVisible(),
        },
        {
          label: "Open Settings & Sessions",
          click: () => windows.showDashboard("keys"),
        },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray(windows: WindowManager, store: LocalStore): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("GlassHUD Copilot");

  const rebuildMenu = () => {
    const settings = store.getSettings();
    const displays = windows.listDisplays();
    const menu = Menu.buildFromTemplate([
      {
        label: windows.isOverlayVisible() ? "Hide Overlay" : "Show Overlay",
        click: () => {
          windows.toggleOverlayVisible();
          rebuildMenu();
        },
      },
      {
        label: "Capture Screenshot",
        click: () => {
          windows.broadcast("shortcut:triggered", { action: "capture_screenshot" });
        },
      },
      { type: "separator" },
      {
        label: "Screen-Share Privacy (Content Protection)",
        type: "checkbox",
        checked: settings.contentProtection,
        click: (item) => {
          const updated = store.updateSettings({ contentProtection: item.checked });
          windows.setContentProtection(updated.contentProtection);
          windows.broadcast("settings:changed", updated);
        },
      },
      ...(displays.length > 1
        ? [
            {
              label: "Move Overlay to Display",
              submenu: displays.map((d) => ({
                label: `${d.label}${d.primary ? " (Primary)" : ""}`,
                type: "radio" as const,
                checked: d.current,
                click: () => {
                  windows.moveOverlayToDisplay(d.id);
                  rebuildMenu();
                },
              })),
            },
          ]
        : []),
      { type: "separator" },
      {
        label: "Settings & API Keys...",
        click: () => windows.showDashboard("keys"),
      },
      {
        label: "Session History...",
        click: () => windows.showDashboard("sessions"),
      },
      { type: "separator" },
      {
        label: "Quit GlassHUD",
        click: () => app.quit(),
      },
    ]);
    tray?.setContextMenu(menu);
  };

  rebuildMenu();
  tray.on("click", () => {
    rebuildMenu();
    tray?.popUpContextMenu();
  });
}

async function bootstrap(): Promise<void> {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  await app.whenReady();

  const store = new LocalStore(app.getPath("userData"), safeStorage);
  const preloadPath = join(__dirname, "../preload/index.cjs");
  const windows = new WindowManager(preloadPath);
  const shortcuts = new ShortcutManager();
  const ai = new AiOrchestrator();

  const audio = new AudioCaptureCoordinator(
    store,
    (segment) => windows.broadcast("audio:transcript", segment),
    (status) => windows.broadcast("audio:status", status),
    (message) => windows.broadcast("audio:error", { message }),
  );

  const settings = store.getSettings();
  windows.createWindows(settings.contentProtection);
  buildApplicationMenu(windows);
  setupTray(windows, store);

  const handleShortcut = (action: ShortcutAction) => {
    if (action === "toggle_overlay") {
      windows.toggleOverlayVisible();
      return;
    }
    if (action === "opacity_down" || action === "opacity_up") {
      const cur = store.getSettings();
      const delta = action === "opacity_up" ? 0.08 : -0.08;
      const nextOpacity = Math.round(Math.max(0.35, Math.min(1, cur.overlayOpacity + delta)) * 100) / 100;
      const updated = store.updateSettings({ overlayOpacity: nextOpacity });
      windows.broadcast("settings:changed", updated);
      if (!windows.isOverlayVisible()) windows.setOverlayVisible(true);
      windows.broadcast("shortcut:triggered", { action });
      return;
    }
    if (action === "zoom_out" || action === "zoom_in" || action === "zoom_reset") {
      if (!windows.isOverlayVisible()) windows.setOverlayVisible(true);
      if (action === "zoom_out") windows.adjustOverlayZoom(-0.5);
      else if (action === "zoom_in") windows.adjustOverlayZoom(0.5);
      else windows.resetOverlayZoom();
      windows.broadcast("shortcut:triggered", { action });
      return;
    }
    if (!windows.isOverlayVisible()) {
      windows.setOverlayVisible(true);
    }
    windows.broadcast("shortcut:triggered", { action });
  };

  shortcuts.apply(settings.shortcuts, handleShortcut);

  registerIpcHandlers({
    store,
    windows,
    shortcuts,
    ai,
    audio,
    onShortcutAction: handleShortcut,
  });

  const syncDisplays = () => {
    const active = windows.getTargetDisplay();
    windows.moveOverlayToDisplay(active.id);
  };
  screen.on("display-added", syncDisplays);
  screen.on("display-removed", syncDisplays);
  screen.on("display-metrics-changed", syncDisplays);

  // Open dashboard automatically on first run if no API key is configured yet
  const keyStatus = store.getApiKeyStatus();
  if (!keyStatus.openai && !keyStatus.anthropic && !keyStatus.gemini) {
    setTimeout(() => windows.showDashboard("keys"), 450);
  }

  app.on("activate", () => {
    windows.showDashboard("keys");
  });

  app.on("second-instance", () => {
    windows.showDashboard("keys");
  });

  app.on("will-quit", () => {
    shortcuts.dispose();
    ai.cancel();
    audio.stopSystemAudio();
  });
}

bootstrap().catch((err) => {
  console.error("[GlassHUD] Fatal startup error:", err);
  app.quit();
});
