import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Copy,
  EyeOff,
  GripVertical,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import type {
  AiProvider,
  AiStreamRequest,
  ApiKeyStatus,
  AppSettings,
  AudioStatusEvent,
  ChatTurn,
  CustomPrompt,
  DisplayInfo,
  ScreenshotItem,
  SessionRecord,
  TranscriptSegment,
} from "@shared/types";
import { DEFAULT_SETTINGS, PROGRAMMING_LANGUAGES } from "@shared/defaults";
import { useMicCapture } from "@renderer/hooks/useMicCapture";
import { MarkdownView } from "./MarkdownView";

const PROVIDER_BADGE: Record<AiProvider, { name: string; color: string }> = {
  openai: { name: "OpenAI", color: "text-emerald-300 bg-emerald-500/15 border-emerald-400/30" },
  anthropic: { name: "Anthropic", color: "text-amber-300 bg-amber-500/15 border-amber-400/30" },
  gemini: { name: "Gemini", color: "text-sky-300 bg-sky-500/15 border-sky-400/30" },
};

const QUICK_ACTIONS: Array<{
  id: NonNullable<AiStreamRequest["quickAction"]>;
  label: string;
}> = [
  { id: "solve", label: "Solve Screen" },
  { id: "say_next", label: "What to Say" },
  { id: "optimize", label: "Optimize" },
  { id: "summarize", label: "Summarize" },
  { id: "follow_up", label: "Follow-Ups" },
];

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function OverlayApp() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({
    openai: false,
    anthropic: false,
    gemini: false,
  });
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [audioStatus, setAudioStatus] = useState<AudioStatusEvent>({
    systemActive: false,
    systemSupported: false,
    transcribingCount: 0,
  });

  const [sessionId, setSessionId] = useState<string>(() => makeId());
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"response" | "transcript">("response");
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Floating HUD position & size inside full-workArea transparent overlay
  const [pos, setPos] = useState({ x: Math.max(24, Math.floor((window.innerWidth - 620) / 2)), y: 24 });
  const [panelSize, setPanelSize] = useState({ width: 640, height: 470 });

  const { micActive, micLevel, micError, startMic, stopMic } = useMicCapture();
  const isListening = audioStatus.systemActive || micActive;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ignoreMouseRef = useRef<boolean>(true);
  const draggingRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizingRef = useRef<{
    startX: number;
    startY: number;
    originW: number;
    originH: number;
  } | null>(null);

  // Keep latest state in refs for global shortcut handlers
  const stateRef = useRef({
    settings,
    screenshots,
    turns,
    transcripts,
    input,
    activeRequestId,
    sessionId,
    isListening,
  });
  stateRef.current = {
    settings,
    screenshots,
    turns,
    transcripts,
    input,
    activeRequestId,
    sessionId,
    isListening,
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  useEffect(() => {
    if (micError) showToast(micError);
  }, [micError, showToast]);

  // Initial state hydration & main-process subscriptions
  useEffect(() => {
    void Promise.all([
      window.glassApi.settings.get(),
      window.glassApi.keys.status(),
      window.glassApi.prompts.list(),
      window.glassApi.displays.list(),
      window.glassApi.audio.status(),
    ]).then(([s, k, p, d, a]) => {
      setSettings(s);
      setKeyStatus(k);
      setPrompts(p);
      setDisplays(d);
      setAudioStatus(a);
    });

    const unsubs = [
      window.glassApi.settings.onChange(setSettings),
      window.glassApi.keys.onChange(setKeyStatus),
      window.glassApi.prompts.onChange(setPrompts),
      window.glassApi.displays.onChange(setDisplays),
      window.glassApi.audio.onStatus(setAudioStatus),
      window.glassApi.audio.onError(({ message }) => showToast(message)),
      window.glassApi.audio.onTranscript((seg) => {
        setTranscripts((prev) => [...prev.slice(-150), seg]);
      }),
    ];

    return () => {
      for (const fn of unsubs) fn();
    };
  }, [showToast]);

  // Persist current session to local store whenever turns or transcripts update (unless incognito)
  const persistSession = useCallback(
    (nextTurns: ChatTurn[], nextTranscripts: TranscriptSegment[]) => {
      const { settings: curSettings, sessionId: curId } = stateRef.current;
      if (curSettings.incognito || (nextTurns.length === 0 && nextTranscripts.length === 0)) {
        return;
      }
      const firstUser = nextTurns.find((t) => t.role === "user");
      const titleSource = firstUser?.text || nextTranscripts[0]?.text || "Untitled Session";
      const title = titleSource.replace(/\s+/g, " ").trim().slice(0, 64);
      const record: SessionRecord = {
        id: curId,
        title: title || "Untitled Session",
        createdAt: nextTurns[0]?.createdAt ?? nextTranscripts[0]?.timestamp ?? Date.now(),
        updatedAt: Date.now(),
        provider: curSettings.provider,
        model: curSettings.models[curSettings.provider],
        turns: nextTurns.map((t) => ({
          ...t,
          // Keep session store lightweight by omitting raw screenshot blobs after saving
          screenshots: t.screenshots?.map((s) => ({ ...s, dataUrl: "" })),
        })),
        transcripts: nextTranscripts,
      };
      void window.glassApi.sessions.save(record);
    },
    [],
  );

  // AI stream event listener
  useEffect(() => {
    return window.glassApi.ai.onEvent((evt) => {
      if (evt.requestId !== stateRef.current.activeRequestId) return;
      if (evt.type === "delta") {
        setStreamingText((prev) => prev + evt.delta);
      } else if (evt.type === "done") {
        const assistantTurn: ChatTurn = {
          id: makeId(),
          role: "assistant",
          text: evt.text,
          provider: evt.provider,
          model: evt.model,
          ttftMs: evt.ttftMs,
          totalMs: evt.totalMs,
          createdAt: Date.now(),
        };
        setTurns((prev) => {
          const next = [...prev, assistantTurn];
          persistSession(next, stateRef.current.transcripts);
          return next;
        });
        setStreamingText("");
        setActiveRequestId(null);
      } else if (evt.type === "error") {
        showToast(evt.error);
        setStreamingText("");
        setActiveRequestId(null);
      }
    });
  }, [persistSession, showToast]);

  // Dynamic click-through mouse pass-through hit-testing
  useEffect(() => {
    const updateIgnore = (shouldIgnore: boolean) => {
      if (ignoreMouseRef.current !== shouldIgnore) {
        ignoreMouseRef.current = shouldIgnore;
        window.glassApi.window.setIgnoreMouseEvents(shouldIgnore);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRef.current) {
        const dx = e.clientX - draggingRef.current.startX;
        const dy = e.clientY - draggingRef.current.startY;
        setPos({
          x: Math.max(8, Math.min(window.innerWidth - 360, draggingRef.current.originX + dx)),
          y: Math.max(8, Math.min(window.innerHeight - 64, draggingRef.current.originY + dy)),
        });
        return;
      }
      if (resizingRef.current) {
        const dx = e.clientX - resizingRef.current.startX;
        const dy = e.clientY - resizingRef.current.startY;
        setPanelSize({
          width: Math.max(460, Math.min(window.innerWidth - 32, resizingRef.current.originW + dx)),
          height: Math.max(260, Math.min(window.innerHeight - 100, resizingRef.current.originH + dy)),
        });
        return;
      }

      const target = e.target as HTMLElement | null;
      const overInteractive = Boolean(target?.closest('[data-interactive="true"]'));
      updateIgnore(!overInteractive);
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      resizingRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleCaptureScreenshot = useCallback(async () => {
    try {
      const shot = await window.glassApi.screenshot.capture();
      setScreenshots((prev) => [...prev.slice(-4), shot]);
      setExpanded(true);
      showToast(`Captured display (${shot.width}×${shot.height})`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Screenshot capture failed.");
    }
  }, [showToast]);

  const handleToggleAudio = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.isListening) {
      if (audioStatus.systemActive) {
        await window.glassApi.audio.stopSystem();
      }
      stopMic();
      showToast("Audio listening stopped");
      return;
    }

    if (cur.settings.captureSystemAudio) {
      const status = await window.glassApi.audio.startSystem();
      if (status.systemError) showToast(status.systemError);
    }
    if (cur.settings.captureMicAudio) {
      await startMic();
    }
    setExpanded(true);
  }, [audioStatus.systemActive, showToast, startMic, stopMic]);

  const handleAskAi = useCallback(
    async (quickAction?: AiStreamRequest["quickAction"], customPromptText?: string) => {
      const cur = stateRef.current;
      if (cur.activeRequestId) {
        window.glassApi.ai.cancel(cur.activeRequestId);
        setActiveRequestId(null);
        setStreamingText("");
        return;
      }

      const promptText = (customPromptText ?? cur.input).trim();
      const requestId = makeId();
      const attachedShots = [...cur.screenshots];

      const displayLabel =
        promptText ||
        (quickAction
          ? QUICK_ACTIONS.find((q) => q.id === quickAction)?.label ?? "Ask AI"
          : attachedShots.length > 0
            ? `Analyze ${attachedShots.length} screenshot${attachedShots.length > 1 ? "s" : ""}`
            : cur.transcripts.length > 0
              ? "Analyze live transcript"
              : "Ask AI");

      const userTurn: ChatTurn = {
        id: makeId(),
        role: "user",
        text: displayLabel,
        screenshots: attachedShots.map((s) => ({
          id: s.id,
          mimeType: s.mimeType,
          dataUrl: s.dataUrl,
        })),
        createdAt: Date.now(),
      };

      const historyPayload = cur.turns.map((t) => ({ role: t.role, text: t.text }));

      setTurns((prev) => [...prev, userTurn]);
      setScreenshots([]);
      if (customPromptText === undefined) setInput("");
      setExpanded(true);
      setActiveTab("response");
      setStreamingText("");
      setActiveRequestId(requestId);

      await window.glassApi.ai.stream({
        requestId,
        sessionId: cur.sessionId,
        userPrompt: promptText,
        quickAction,
        screenshots: attachedShots.map((s) => ({
          id: s.id,
          mimeType: s.mimeType,
          dataUrl: s.dataUrl,
        })),
        transcripts: cur.transcripts,
        history: historyPayload,
      });
    },
    [],
  );

  const handleClearSession = useCallback(() => {
    if (stateRef.current.activeRequestId) {
      window.glassApi.ai.cancel(stateRef.current.activeRequestId);
    }
    setActiveRequestId(null);
    setStreamingText("");
    setTurns([]);
    setScreenshots([]);
    setTranscripts([]);
    setSessionId(makeId());
    showToast("Started fresh session");
  }, [showToast]);

  // Global shortcut dispatcher
  useEffect(() => {
    return window.glassApi.shortcuts.onTriggered(({ action }) => {
      const STEP = 44;
      switch (action) {
        case "capture_screenshot":
          void handleCaptureScreenshot();
          break;
        case "delete_last_screenshot":
          setScreenshots((prev) => {
            if (prev.length === 0) {
              showToast("No queued screenshots to remove");
              return prev;
            }
            showToast("Removed last queued screenshot");
            return prev.slice(0, -1);
          });
          break;
        case "opacity_down":
          showToast(`Opacity ${Math.round(Math.max(0.35, stateRef.current.settings.overlayOpacity - 0.08) * 100)}%`);
          break;
        case "opacity_up":
          showToast(`Opacity ${Math.round(Math.min(1, stateRef.current.settings.overlayOpacity + 0.08) * 100)}%`);
          break;
        case "zoom_out":
          showToast("Zoomed out");
          break;
        case "zoom_in":
          showToast("Zoomed in");
          break;
        case "zoom_reset":
          showToast("Zoom reset (100%)");
          break;
        case "trigger_ai":
          void handleAskAi();
          break;
        case "clear_session":
          handleClearSession();
          break;
        case "toggle_audio":
          void handleToggleAudio();
          break;
        case "move_up":
          setPos((p) => ({ ...p, y: Math.max(8, p.y - STEP) }));
          break;
        case "move_down":
          setPos((p) => ({ ...p, y: Math.min(window.innerHeight - 80, p.y + STEP) }));
          break;
        case "move_left":
          setPos((p) => ({ ...p, x: Math.max(8, p.x - STEP) }));
          break;
        case "move_right":
          setPos((p) => ({ ...p, x: Math.min(window.innerWidth - 360, p.x + STEP) }));
          break;
        case "scroll_up":
          scrollRef.current?.scrollBy({ top: -180, behavior: "smooth" });
          break;
        case "scroll_down":
          scrollRef.current?.scrollBy({ top: 180, behavior: "smooth" });
          break;
        case "tab_response":
          setExpanded(true);
          setActiveTab("response");
          break;
        case "tab_transcript":
          setExpanded(true);
          setActiveTab("transcript");
          break;
        default:
          break;
      }
    });
  }, [handleAskAi, handleCaptureScreenshot, handleClearSession, handleToggleAudio]);

  // Auto-scroll bottom as response streams
  useEffect(() => {
    if (activeTab === "response" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length, streamingText, activeTab]);

  const cycleProvider = () => {
    const order: AiProvider[] = ["openai", "anthropic", "gemini"];
    const next = order[(order.indexOf(settings.provider) + 1) % order.length];
    void window.glassApi.settings.update({ provider: next });
  };

  const hasCurrentKey = keyStatus[settings.provider];
  const badge = PROVIDER_BADGE[settings.provider];

  return (
    <div className="pointer-events-none relative h-full w-full select-none bg-transparent text-slate-100">
      <div
        style={{
          left: pos.x,
          top: pos.y,
          width: expanded ? panelSize.width : "auto",
          opacity: settings.overlayOpacity,
        }}
        className="pointer-events-none absolute flex flex-col gap-2"
      >
        {/* Top Floating Glass Command Bar */}
        <div
          data-interactive="true"
          className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-white/15 bg-slate-950/88 px-2.5 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        >
          {/* Drag Handle */}
          <div
            onMouseDown={(e) => {
              draggingRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                originX: pos.x,
                originY: pos.y,
              };
            }}
            title="Drag HUD"
            className="flex cursor-grab items-center gap-1 rounded-lg px-1 py-1 text-slate-400 hover:bg-white/10 hover:text-slate-200 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
            <span
              className={`h-2 w-2 rounded-full ${
                activeRequestId
                  ? "animate-pulse bg-indigo-400"
                  : isListening
                    ? "animate-pulse bg-emerald-400"
                    : "bg-slate-500"
              }`}
            />
          </div>

          {/* Listen Toggle */}
          <button
            type="button"
            onClick={() => void handleToggleAudio()}
            title={`Toggle Audio Listening (${settings.shortcuts.toggle_audio})`}
            className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-medium transition ${
              isListening
                ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
                : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
          >
            {isListening ? (
              <Mic className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <MicOff className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span>{isListening ? "Listening" : "Listen"}</span>
            {isListening && (
              <span className="ml-0.5 flex items-end gap-0.5">
                {[0.4, 0.9, 0.6].map((mult, idx) => (
                  <span
                    key={idx}
                    style={{
                      height: `${Math.max(4, Math.min(12, 4 + micLevel * 10 * mult))}px`,
                    }}
                    className="w-0.5 rounded-full bg-emerald-300 transition-all duration-75"
                  />
                ))}
              </span>
            )}
            {audioStatus.transcribingCount > 0 && (
              <Loader2 className="h-3 w-3 animate-spin text-emerald-300" />
            )}
          </button>

          {/* Screenshot Capture */}
          <button
            type="button"
            onClick={() => void handleCaptureScreenshot()}
            title={`Capture Screen (${settings.shortcuts.capture_screenshot})`}
            className="relative flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-white/10"
          >
            <Camera className="h-3.5 w-3.5 text-indigo-300" />
            <span>Snap</span>
            {screenshots.length > 0 && (
              <span className="rounded-full bg-indigo-500 px-1.5 text-[10px] font-semibold text-white">
                {screenshots.length}
              </span>
            )}
          </button>

          {/* Ask AI / Stop */}
          <button
            type="button"
            onClick={() => void handleAskAi()}
            title={`Ask AI (${settings.shortcuts.trigger_ai})`}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-semibold shadow-sm transition ${
              activeRequestId
                ? "bg-rose-500/85 text-white hover:bg-rose-500"
                : "bg-indigo-500 text-white hover:bg-indigo-400"
            }`}
          >
            {activeRequestId ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>Ask AI</span>
              </>
            )}
          </button>

          <div className="mx-0.5 h-4 w-px bg-white/10" />

          {/* Quick Provider Switcher */}
          <button
            type="button"
            onClick={cycleProvider}
            title="Click to switch active AI provider (OpenAI / Anthropic / Gemini)"
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition hover:brightness-125 ${badge.color}`}
          >
            <span>{badge.name}</span>
            {!hasCurrentKey && <span className="text-rose-300">• No Key</span>}
          </button>

          <div className="flex-1" />

          {/* Privacy status indicator */}
          {settings.contentProtection && (
            <span
              title="Screen-share content protection enabled (excluded from screen capture)"
              className="flex items-center rounded-lg px-1.5 py-1 text-emerald-400/85"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
          )}

          {/* Multi-display picker */}
          {displays.length > 1 && (
            <button
              type="button"
              onClick={() => window.glassApi.displays.showPickers()}
              title="Move overlay to another display"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Open Settings Dashboard */}
          <button
            type="button"
            onClick={() => window.glassApi.window.showDashboard("keys")}
            title="Open Settings, API Keys & History"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          {/* Collapse / Expand */}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Collapse panel" : "Expand panel"}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {/* Hide Overlay */}
          <button
            type="button"
            onClick={() => void window.glassApi.window.toggleOverlay()}
            title={`Hide Overlay (${settings.shortcuts.toggle_overlay})`}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-rose-300"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Toast Notification */}
        {toast && (
          <div
            data-interactive="true"
            className="pointer-events-auto flex items-center justify-between rounded-xl border border-indigo-400/30 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-200 shadow-lg backdrop-blur-md"
          >
            <span className="truncate">{toast}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 text-slate-400 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Expanded Glass Assistant Panel */}
        {expanded && (
          <div
            data-interactive="true"
            style={{ height: panelSize.height }}
            className="pointer-events-auto relative flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90 shadow-[0_20px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
          >
            {/* Sub-header: Tabs + Prompt / Language selectors */}
            <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("response")}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    activeTab === "response"
                      ? "bg-white/12 text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Response</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("transcript")}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    activeTab === "transcript"
                      ? "bg-white/12 text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Transcript</span>
                  {transcripts.length > 0 && (
                    <span className="rounded-full bg-white/15 px-1.5 text-[10px] text-slate-200">
                      {transcripts.length}
                    </span>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Active Prompt Profile */}
                <select
                  value={settings.activePromptId}
                  onChange={(e) =>
                    void window.glassApi.settings.update({ activePromptId: e.target.value })
                  }
                  className="max-w-[130px] rounded-lg border border-white/10 bg-slate-900/90 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-indigo-400"
                >
                  {prompts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>

                {/* Programming Language */}
                <select
                  value={settings.programmingLanguage}
                  onChange={(e) =>
                    void window.glassApi.settings.update({ programmingLanguage: e.target.value })
                  }
                  className="rounded-lg border border-white/10 bg-slate-900/90 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-indigo-400"
                >
                  {PROGRAMMING_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleClearSession}
                  title={`Clear Session (${settings.shortcuts.clear_session})`}
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Queued Screenshots Strip */}
            {screenshots.length > 0 && (
              <div className="flex items-center gap-2 border-b border-white/10 bg-indigo-950/20 px-3 py-2">
                <span className="text-[11px] font-medium text-indigo-300">
                  Queued ({screenshots.length}):
                </span>
                <div className="flex flex-1 items-center gap-2 overflow-x-auto">
                  {screenshots.map((shot) => (
                    <div
                      key={shot.id}
                      className="group relative h-11 w-18 shrink-0 overflow-hidden rounded-lg border border-indigo-400/40 bg-black"
                    >
                      <img
                        src={shot.dataUrl}
                        alt="Captured screen"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setScreenshots((prev) => prev.filter((s) => s.id !== shot.id))
                        }
                        className="absolute top-0.5 right-0.5 rounded-full bg-slate-950/85 p-0.5 text-slate-200 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Main Scrollable Content */}
            <div
              ref={scrollRef}
              className="glass-scroll flex-1 space-y-3 overflow-y-auto px-3.5 py-3 select-text"
            >
              {activeTab === "response" ? (
                <>
                  {!hasCurrentKey && (
                    <div className="flex items-center justify-between rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <span>
                        Add your {badge.name} API key in Settings to start streaming responses.
                      </span>
                      <button
                        type="button"
                        onClick={() => window.glassApi.window.showDashboard("keys")}
                        className="ml-3 shrink-0 rounded-lg bg-amber-400/20 px-2.5 py-1 font-medium text-amber-100 hover:bg-amber-400/30"
                      >
                        Add Key
                      </button>
                    </div>
                  )}

                  {turns.length === 0 && !streamingText ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
                      <div className="rounded-2xl border border-indigo-400/25 bg-indigo-500/10 p-3 text-indigo-300">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-100">
                          GlassHUD Ready ({settings.models[settings.provider]})
                        </p>
                        <p className="max-w-sm text-xs text-slate-400">
                          Press <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">{settings.shortcuts.capture_screenshot}</kbd> to snap your screen,{" "}
                          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">{settings.shortcuts.toggle_audio}</kbd> to transcribe audio, or{" "}
                          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">{settings.shortcuts.trigger_ai}</kbd> to ask AI.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {turns.map((turn) => (
                        <div
                          key={turn.id}
                          className={
                            turn.role === "user"
                              ? "ml-auto max-w-[85%] rounded-2xl border border-indigo-400/25 bg-indigo-500/15 px-3 py-2 text-xs text-indigo-100"
                              : "rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5"
                          }
                        >
                          {turn.role === "user" ? (
                            <div className="space-y-1.5">
                              <p className="whitespace-pre-wrap">{turn.text}</p>
                              {turn.screenshots && turn.screenshots.length > 0 && (
                                <div className="flex gap-1.5">
                                  {turn.screenshots.map((s) =>
                                    s.dataUrl ? (
                                      <img
                                        key={s.id}
                                        src={s.dataUrl}
                                        alt="Attached"
                                        className="h-10 w-16 rounded border border-white/15 object-cover"
                                      />
                                    ) : null,
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span className="font-mono">
                                  {turn.provider?.toUpperCase()} · {turn.model}
                                </span>
                                <div className="flex items-center gap-2">
                                  {turn.ttftMs !== undefined && (
                                    <span>
                                      TTFT {turn.ttftMs}ms · {((turn.totalMs ?? 0) / 1000).toFixed(1)}s
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(turn.text);
                                      showToast("Response copied to clipboard");
                                    }}
                                    className="rounded p-0.5 hover:bg-white/10 hover:text-white"
                                    title="Copy entire response"
                                  >
                                    <Copy className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                              <MarkdownView content={turn.text} />
                            </div>
                          )}
                        </div>
                      ))}

                      {activeRequestId && (
                        <div className="rounded-2xl border border-indigo-400/25 bg-white/[0.04] px-3.5 py-2.5">
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-indigo-300">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>
                              Streaming from {badge.name} ({settings.models[settings.provider]})…
                            </span>
                          </div>
                          {streamingText ? (
                            <MarkdownView content={streamingText} />
                          ) : (
                            <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                /* Live Transcript Tab */
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Live VAD transcript ({settings.sttProvider === "auto" ? "Auto STT" : settings.sttProvider})
                    </span>
                    <div className="flex items-center gap-2">
                      {transcripts.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleAskAi("say_next")}
                            className="rounded-lg bg-indigo-500/25 px-2 py-0.5 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/35"
                          >
                            Suggest Next Reply
                          </button>
                          <button
                            type="button"
                            onClick={() => setTranscripts([])}
                            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-rose-300"
                            title="Clear transcript"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {transcripts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-slate-400">
                      <Volume2 className="h-6 w-6 text-slate-500" />
                      <p>No transcript segments yet.</p>
                      <p className="max-w-xs text-[11px] text-slate-500">
                        Click <strong>Listen</strong> above to capture system audio (macOS 14.2+) and microphone speech via your OpenAI or Gemini API key.
                      </p>
                    </div>
                  ) : (
                    transcripts.map((seg) => (
                      <div
                        key={seg.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs"
                      >
                        <div className="mb-1 flex items-center justify-between text-[10px]">
                          <span
                            className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${
                              seg.source === "system"
                                ? "bg-cyan-500/20 text-cyan-300"
                                : "bg-violet-500/20 text-violet-300"
                            }`}
                          >
                            {seg.source === "system" ? "System Audio" : "You"}
                          </span>
                          <span className="text-slate-500">
                            {new Date(seg.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                            {seg.latencyMs ? ` · ${seg.latencyMs}ms` : ""}
                          </span>
                        </div>
                        <p className="text-slate-200">{seg.text}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Quick Action Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto border-t border-white/10 bg-white/[0.02] px-3 py-1.5">
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.id}
                  type="button"
                  disabled={Boolean(activeRequestId)}
                  onClick={() => void handleAskAi(qa.id)}
                  className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-indigo-400/40 hover:bg-indigo-500/15 hover:text-indigo-200 disabled:opacity-40"
                >
                  {qa.label}
                </button>
              ))}
            </div>

            {/* Prompt Input Bar */}
            <div className="flex items-end gap-2 border-t border-white/10 bg-slate-950/95 px-3 py-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onFocus={() => window.glassApi.window.focusOverlay()}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleAskAi();
                  } else if (e.key === "Escape") {
                    inputRef.current?.blur();
                  }
                }}
                placeholder="Ask a follow-up or press Cmd/Ctrl+Enter to analyze context..."
                className="glass-scroll max-h-24 min-h-[34px] flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-400/60"
              />
              <button
                type="button"
                onClick={() => void handleAskAi()}
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white transition hover:bg-indigo-400"
                title="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Bottom-right Resize Handle */}
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                resizingRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  originW: panelSize.width,
                  originH: panelSize.height,
                };
              }}
              title="Resize panel"
              className="absolute right-0 bottom-0 h-3.5 w-3.5 cursor-nwse-resize"
            />
          </div>
        )}
      </div>
    </div>
  );
}
