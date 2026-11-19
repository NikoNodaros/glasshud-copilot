import { existsSync } from "node:fs";
import { app, ipcMain, shell, systemPreferences } from "electron";
import { z } from "zod";
import type {
  AiStreamRequest,
  AppSettings,
  PermissionStatus,
  SessionRecord,
  ShortcutAction,
} from "@shared/types";
import { AiOrchestrator } from "./ai";
import { verifyProviderApiKey } from "./ai/verifyKey";
import {
  AudioCaptureCoordinator,
  isMacOsSystemAudioSupported,
  resolveNativeAudioHelperPath,
} from "./audioCapture";
import { captureTargetDisplayScreenshot } from "./screenshot";
import type { ShortcutManager } from "./shortcuts";
import type { LocalStore } from "./store";
import type { WindowManager } from "./windows";

const ProviderSchema = z.enum(["openai", "anthropic", "gemini"]);
const SttProviderSchema = z.enum(["openai", "gemini", "auto"]);

const SetApiKeySchema = z.object({
  provider: ProviderSchema,
  key: z.string().nullable(),
});

const UpsertPromptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  content: z.string().max(16000),
});

const AiStreamRequestSchema = z.object({
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  userPrompt: z.string().max(32000),
  quickAction: z
    .enum(["solve", "say_next", "optimize", "summarize", "follow_up"])
    .optional(),
  screenshots: z
    .array(
      z.object({
        id: z.string(),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        dataUrl: z.string(),
      }),
    )
    .max(8),
  transcripts: z.array(
    z.object({
      id: z.string(),
      source: z.enum(["system", "mic"]),
      text: z.string(),
      timestamp: z.number(),
      latencyMs: z.number().optional(),
    }),
  ),
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string(),
    }),
  ),
  overrideProvider: ProviderSchema.optional(),
  overrideModel: z.string().optional(),
});

const UpdateSettingsSchema = z
  .object({
    provider: ProviderSchema.optional(),
    models: z
      .object({
        openai: z.string().min(1),
        anthropic: z.string().min(1),
        gemini: z.string().min(1),
      })
      .partial()
      .optional(),
    sttProvider: SttProviderSchema.optional(),
    activePromptId: z.string().min(1).optional(),
    programmingLanguage: z.string().min(1).max(40).optional(),
    contentProtection: z.boolean().optional(),
    overlayOpacity: z.number().min(0.35).max(1).optional(),
    incognito: z.boolean().optional(),
    captureSystemAudio: z.boolean().optional(),
    captureMicAudio: z.boolean().optional(),
    autoLaunch: z.boolean().optional(),
    shortcuts: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export function registerIpcHandlers(deps: {
  store: LocalStore;
  windows: WindowManager;
  shortcuts: ShortcutManager;
  ai: AiOrchestrator;
  audio: AudioCaptureCoordinator;
  onShortcutAction: (action: ShortcutAction) => void;
}): void {
  const { store, windows, shortcuts, ai, audio, onShortcutAction } = deps;

  // Settings & API keys
  ipcMain.handle("settings:get", () => store.getSettings());

  ipcMain.handle("settings:update", (_evt, rawPatch: unknown) => {
    const parsed = UpdateSettingsSchema.parse(rawPatch);
    const current = store.getSettings();
    const mergedPatch: Partial<AppSettings> = {
      ...parsed,
      models: parsed.models
        ? { ...current.models, ...parsed.models }
        : undefined,
      shortcuts: parsed.shortcuts
        ? ({ ...current.shortcuts, ...parsed.shortcuts } as AppSettings["shortcuts"])
        : undefined,
    };
    const next = store.updateSettings(mergedPatch);
    windows.setContentProtection(next.contentProtection);
    if (parsed.autoLaunch !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: next.autoLaunch });
    }
    if (parsed.shortcuts) {
      shortcuts.apply(next.shortcuts, onShortcutAction);
    }
    windows.broadcast("settings:changed", next);
    return next;
  });

  ipcMain.handle("keys:status", () => store.getApiKeyStatus());

  ipcMain.handle("keys:set", (_evt, raw: unknown) => {
    const { provider, key } = SetApiKeySchema.parse(raw);
    const status = store.setApiKey(provider, key);
    windows.broadcast("keys:changed", status);
    return status;
  });

  ipcMain.handle("keys:test", async (_evt, raw: unknown) => {
    const { provider, key } = z
      .object({
        provider: ProviderSchema,
        key: z.string().optional(),
      })
      .parse(raw);
    const effectiveKey = key?.trim() || store.getApiKey(provider) || "";
    return verifyProviderApiKey({ provider, apiKey: effectiveKey });
  });

  // Prompts
  ipcMain.handle("prompts:list", () => store.listPrompts());

  ipcMain.handle("prompts:upsert", (_evt, raw: unknown) => {
    const prompt = UpsertPromptSchema.parse(raw);
    const next = store.upsertPrompt(prompt);
    windows.broadcast("prompts:changed", next);
    return next;
  });

  ipcMain.handle("prompts:delete", (_evt, id: unknown) => {
    const validId = z.string().min(1).parse(id);
    const next = store.deletePrompt(validId);
    windows.broadcast("prompts:changed", next);
    return next;
  });

  // Sessions
  ipcMain.handle("sessions:list", () => store.listSessions());

  ipcMain.handle("sessions:save", (_evt, session: SessionRecord) => {
    const next = store.saveSession(session);
    windows.broadcast("sessions:changed", next);
    return next;
  });

  ipcMain.handle("sessions:delete", (_evt, id: unknown) => {
    const validId = z.string().min(1).parse(id);
    const next = store.deleteSession(validId);
    windows.broadcast("sessions:changed", next);
    return next;
  });

  ipcMain.handle("sessions:clear", () => {
    const next = store.clearSessions();
    windows.broadcast("sessions:changed", next);
    return next;
  });

  // Windows & displays
  ipcMain.on("window:set-ignore-mouse", (_evt, raw: unknown) => {
    const { ignore } = z.object({ ignore: z.boolean() }).parse(raw);
    windows.setIgnoreMouseEvents(ignore);
  });

  ipcMain.handle("window:toggle-overlay", () => ({
    visible: windows.toggleOverlayVisible(),
  }));

  ipcMain.on("window:focus-overlay", () => {
    windows.focusOverlay();
  });

  ipcMain.on("window:show-dashboard", (_evt, raw: unknown) => {
    const parsed = z.object({ tab: z.string().optional() }).optional().parse(raw);
    windows.showDashboard(parsed?.tab);
  });

  ipcMain.on("window:hide-dashboard", () => {
    windows.hideDashboard();
  });

  ipcMain.handle("displays:list", () => windows.listDisplays());

  ipcMain.handle("displays:move", (_evt, raw: unknown) => {
    const { displayId } = z.object({ displayId: z.number() }).parse(raw);
    return windows.moveOverlayToDisplay(displayId);
  });

  ipcMain.on("displays:show-pickers", () => {
    windows.showDisplayPickers();
  });

  ipcMain.on("displays:hide-pickers", () => {
    windows.cleanupPickers();
  });

  // Shortcuts
  ipcMain.on("shortcuts:suspend", () => {
    shortcuts.suspend();
  });

  ipcMain.on("shortcuts:resume", () => {
    shortcuts.reregister();
  });

  // Screenshots & Permissions
  ipcMain.handle("screenshot:capture", async () => {
    const settings = store.getSettings();
    return captureTargetDisplayScreenshot(windows, settings.contentProtection);
  });

  ipcMain.handle("permissions:status", (): PermissionStatus => {
    const isMac = process.platform === "darwin";
    const mic = isMac
      ? (systemPreferences.getMediaAccessStatus("microphone") as PermissionStatus["microphone"])
      : "granted";
    const screenPerm = isMac
      ? (systemPreferences.getMediaAccessStatus("screen") as PermissionStatus["screen"])
      : "granted";
    return {
      platform: process.platform,
      microphone: mic,
      screen: screenPerm,
      macSystemAudioSupported: isMacOsSystemAudioSupported(),
      nativeAudioHelperBuilt: existsSync(resolveNativeAudioHelperPath()),
    };
  });

  ipcMain.handle("permissions:request-mic", async () => {
    if (process.platform !== "darwin") return true;
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return true;
    return systemPreferences.askForMediaAccess("microphone");
  });

  ipcMain.on("permissions:open-settings", (_evt, raw: unknown) => {
    const { section } = z.object({ section: z.enum(["microphone", "screen"]) }).parse(raw);
    if (process.platform !== "darwin") return;
    const url =
      section === "microphone"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
    void shell.openExternal(url);
  });

  // Audio & Transcription
  ipcMain.handle("audio:start-system", () => audio.startSystemAudio());
  ipcMain.handle("audio:stop-system", () => audio.stopSystemAudio());
  ipcMain.handle("audio:status", () => audio.getStatus());

  ipcMain.on("audio:mic-pcm", (_evt, raw: unknown) => {
    const { base64Pcm } = z.object({ base64Pcm: z.string() }).parse(raw);
    audio.ingestMicPcmBase64(base64Pcm);
  });

  ipcMain.on("audio:mic-flush", () => {
    audio.flushMic();
  });

  // AI Streaming
  ipcMain.handle("ai:stream", (_evt, raw: unknown) => {
    const request = AiStreamRequestSchema.parse(raw) as AiStreamRequest;
    const settings = store.getSettings();
    const prompts = store.listPrompts();

    void ai.stream({
      request,
      settings,
      prompts,
      getApiKey: (provider) => store.getApiKey(provider),
      emit: (event) => windows.broadcast("ai:stream-event", event),
    });

    return { started: true };
  });

  ipcMain.on("ai:cancel", (_evt, raw: unknown) => {
    const parsed = z.object({ requestId: z.string().optional() }).optional().parse(raw);
    ai.cancel(parsed?.requestId);
  });

  // Quit
  ipcMain.on("app:quit", () => {
    app.quit();
  });
}
