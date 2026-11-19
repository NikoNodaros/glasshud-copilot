export type AiProvider = "openai" | "anthropic" | "gemini";
export type SttProvider = "openai" | "gemini" | "auto";

export type ShortcutAction =
  | "toggle_overlay"
  | "trigger_ai"
  | "capture_screenshot"
  | "delete_last_screenshot"
  | "clear_session"
  | "toggle_audio"
  | "opacity_down"
  | "opacity_up"
  | "zoom_out"
  | "zoom_in"
  | "zoom_reset"
  | "move_up"
  | "move_down"
  | "move_left"
  | "move_right"
  | "scroll_up"
  | "scroll_down"
  | "tab_response"
  | "tab_transcript";

export type ShortcutMap = Record<ShortcutAction, string>;

export interface CustomPrompt {
  id: string;
  title: string;
  content: string;
  builtIn?: boolean;
  updatedAt: number;
}

export interface ApiKeyStatus {
  openai: boolean;
  anthropic: boolean;
  gemini: boolean;
}

export interface ApiKeyTestResult {
  valid: boolean;
  provider: AiProvider;
  latencyMs: number;
  modelCount?: number;
  error?: string;
}

export interface AppSettings {
  provider: AiProvider;
  models: Record<AiProvider, string>;
  sttProvider: SttProvider;
  activePromptId: string;
  programmingLanguage: string;
  contentProtection: boolean;
  overlayOpacity: number;
  incognito: boolean;
  captureSystemAudio: boolean;
  captureMicAudio: boolean;
  autoLaunch: boolean;
  shortcuts: ShortcutMap;
}

export interface ScreenshotItem {
  id: string;
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  capturedAt: number;
}

export type AudioChannel = "system" | "mic";

export interface TranscriptSegment {
  id: string;
  source: AudioChannel;
  text: string;
  timestamp: number;
  latencyMs?: number;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  screenshots?: Array<{
    id: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    dataUrl: string;
  }>;
  provider?: AiProvider;
  model?: string;
  ttftMs?: number;
  totalMs?: number;
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  provider: AiProvider;
  model: string;
  turns: ChatTurn[];
  transcripts: TranscriptSegment[];
}

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  current: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface AiStreamRequest {
  requestId: string;
  sessionId: string;
  userPrompt: string;
  quickAction?: "solve" | "say_next" | "optimize" | "summarize" | "follow_up";
  screenshots: Array<{
    id: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    dataUrl: string;
  }>;
  transcripts: TranscriptSegment[];
  history: Array<{ role: "user" | "assistant"; text: string }>;
  overrideProvider?: AiProvider;
  overrideModel?: string;
}

export type AiStreamEvent =
  | { requestId: string; type: "delta"; delta: string }
  | {
      requestId: string;
      type: "done";
      text: string;
      ttftMs: number;
      totalMs: number;
      provider: AiProvider;
      model: string;
    }
  | { requestId: string; type: "error"; error: string };

export interface AudioStatusEvent {
  systemActive: boolean;
  systemSupported: boolean;
  systemError?: string;
  transcribingCount: number;
}

export interface PermissionStatus {
  platform: NodeJS.Platform;
  microphone: "granted" | "denied" | "not-determined" | "restricted" | "unknown";
  screen: "granted" | "denied" | "not-determined" | "restricted" | "unknown";
  macSystemAudioSupported: boolean;
  nativeAudioHelperBuilt: boolean;
}
