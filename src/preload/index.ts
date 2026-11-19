import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AiProvider,
  AiStreamEvent,
  AiStreamRequest,
  ApiKeyStatus,
  ApiKeyTestResult,
  AppSettings,
  AudioStatusEvent,
  CustomPrompt,
  DisplayInfo,
  PermissionStatus,
  ScreenshotItem,
  SessionRecord,
  ShortcutAction,
  TranscriptSegment,
} from "@shared/types";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

export const glassApi = {
  platform: process.platform,

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke("settings:update", patch),
    onChange: (cb: (settings: AppSettings) => void) => subscribe("settings:changed", cb),
  },

  keys: {
    status: (): Promise<ApiKeyStatus> => ipcRenderer.invoke("keys:status"),
    set: (provider: AiProvider, key: string | null): Promise<ApiKeyStatus> =>
      ipcRenderer.invoke("keys:set", { provider, key }),
    test: (provider: AiProvider, key?: string): Promise<ApiKeyTestResult> =>
      ipcRenderer.invoke("keys:test", { provider, key }),
    onChange: (cb: (status: ApiKeyStatus) => void) => subscribe("keys:changed", cb),
  },

  prompts: {
    list: (): Promise<CustomPrompt[]> => ipcRenderer.invoke("prompts:list"),
    upsert: (prompt: { id: string; title: string; content: string }): Promise<CustomPrompt[]> =>
      ipcRenderer.invoke("prompts:upsert", prompt),
    delete: (id: string): Promise<CustomPrompt[]> => ipcRenderer.invoke("prompts:delete", id),
    onChange: (cb: (prompts: CustomPrompt[]) => void) => subscribe("prompts:changed", cb),
  },

  sessions: {
    list: (): Promise<SessionRecord[]> => ipcRenderer.invoke("sessions:list"),
    save: (session: SessionRecord): Promise<SessionRecord[]> =>
      ipcRenderer.invoke("sessions:save", session),
    delete: (id: string): Promise<SessionRecord[]> => ipcRenderer.invoke("sessions:delete", id),
    clear: (): Promise<SessionRecord[]> => ipcRenderer.invoke("sessions:clear"),
    onChange: (cb: (sessions: SessionRecord[]) => void) => subscribe("sessions:changed", cb),
  },

  window: {
    setIgnoreMouseEvents: (ignore: boolean): void => {
      ipcRenderer.send("window:set-ignore-mouse", { ignore });
    },
    toggleOverlay: (): Promise<{ visible: boolean }> =>
      ipcRenderer.invoke("window:toggle-overlay"),
    focusOverlay: (): void => {
      ipcRenderer.send("window:focus-overlay");
    },
    showDashboard: (tab?: string): void => {
      ipcRenderer.send("window:show-dashboard", { tab });
    },
    hideDashboard: (): void => {
      ipcRenderer.send("window:hide-dashboard");
    },
    onOverlayVisibility: (cb: (data: { visible: boolean }) => void) =>
      subscribe("overlay:visibility", cb),
    onDashboardNavigate: (cb: (data: { tab: string }) => void) =>
      subscribe("dashboard:navigate", cb),
  },

  displays: {
    list: (): Promise<DisplayInfo[]> => ipcRenderer.invoke("displays:list"),
    moveOverlay: (displayId: number): Promise<DisplayInfo[]> =>
      ipcRenderer.invoke("displays:move", { displayId }),
    showPickers: (): void => ipcRenderer.send("displays:show-pickers"),
    hidePickers: (): void => ipcRenderer.send("displays:hide-pickers"),
    onChange: (cb: (displays: DisplayInfo[]) => void) => subscribe("displays:changed", cb),
  },

  shortcuts: {
    suspend: (): void => ipcRenderer.send("shortcuts:suspend"),
    resume: (): void => ipcRenderer.send("shortcuts:resume"),
    onTriggered: (cb: (data: { action: ShortcutAction }) => void) =>
      subscribe("shortcut:triggered", cb),
  },

  screenshot: {
    capture: (): Promise<ScreenshotItem> => ipcRenderer.invoke("screenshot:capture"),
  },

  permissions: {
    status: (): Promise<PermissionStatus> => ipcRenderer.invoke("permissions:status"),
    requestMic: (): Promise<boolean> => ipcRenderer.invoke("permissions:request-mic"),
    openSettings: (section: "microphone" | "screen"): void =>
      ipcRenderer.send("permissions:open-settings", { section }),
  },

  audio: {
    startSystem: (): Promise<AudioStatusEvent> => ipcRenderer.invoke("audio:start-system"),
    stopSystem: (): Promise<AudioStatusEvent> => ipcRenderer.invoke("audio:stop-system"),
    status: (): Promise<AudioStatusEvent> => ipcRenderer.invoke("audio:status"),
    sendMicPcmBase64: (base64Pcm: string): void =>
      ipcRenderer.send("audio:mic-pcm", { base64Pcm }),
    flushMic: (): void => ipcRenderer.send("audio:mic-flush"),
    onTranscript: (cb: (seg: TranscriptSegment) => void) => subscribe("audio:transcript", cb),
    onStatus: (cb: (status: AudioStatusEvent) => void) => subscribe("audio:status", cb),
    onError: (cb: (data: { message: string }) => void) => subscribe("audio:error", cb),
  },

  ai: {
    stream: (request: AiStreamRequest): Promise<{ started: boolean }> =>
      ipcRenderer.invoke("ai:stream", request),
    cancel: (requestId?: string): void => ipcRenderer.send("ai:cancel", { requestId }),
    onEvent: (cb: (event: AiStreamEvent) => void) => subscribe("ai:stream-event", cb),
  },

  app: {
    quit: (): void => ipcRenderer.send("app:quit"),
  },
};

contextBridge.exposeInMainWorld("glassApi", glassApi);
