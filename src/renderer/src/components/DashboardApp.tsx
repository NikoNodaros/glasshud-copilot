import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  FlaskConical,
  History,
  KeyRound,
  Keyboard,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  Trash2,
  XCircle,
} from "lucide-react";
import type {
  AiProvider,
  ApiKeyStatus,
  ApiKeyTestResult,
  AppSettings,
  CustomPrompt,
  PermissionStatus,
  SessionRecord,
  ShortcutAction,
  SttProvider,
} from "@shared/types";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SHORTCUTS,
  MODEL_PRESETS,
  PROGRAMMING_LANGUAGES,
  SHORTCUT_LABELS,
} from "@shared/defaults";
import { MarkdownView } from "./MarkdownView";

type TabId = "keys" | "prompts" | "overlay" | "shortcuts" | "sessions";

const PROVIDERS: Array<{ id: AiProvider; name: string; placeholder: string; hint: string }> = [
  {
    id: "openai",
    name: "OpenAI",
    placeholder: "sk-proj-...",
    hint: "Supports GPT-4.1, GPT-4o, o4-mini vision streaming + live audio STT.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    placeholder: "sk-ant-...",
    hint: "Supports Claude Sonnet 4, Claude 3.7 Sonnet, and Claude 3.5 Haiku vision streaming.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    placeholder: "AIza...",
    hint: "Supports Gemini 2.5 Pro / Flash vision streaming + live audio STT.",
  },
];

function keyEventToAccelerator(e: React.KeyboardEvent): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  const keyMap: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Enter",
    " ": "Space",
    Escape: "Escape",
    "\\": "\\",
  };
  const key = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (parts.length === 0 && key.length === 1) return null; // Require modifier for single keys
  parts.push(key);
  return parts.join("+");
}

export function DashboardApp() {
  const [tab, setTab] = useState<TabId>("keys");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({
    openai: false,
    anthropic: false,
    gemini: false,
  });
  const [keyInputs, setKeyInputs] = useState<Record<AiProvider, string>>({
    openai: "",
    anthropic: "",
    gemini: "",
  });
  const [testingKey, setTestingKey] = useState<Record<AiProvider, boolean>>({
    openai: false,
    anthropic: false,
    gemini: false,
  });
  const [testResults, setTestResults] = useState<Partial<Record<AiProvider, ApiKeyTestResult>>>({});
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);

  // Prompt editor state
  const [editingPrompt, setEditingPrompt] = useState<{
    id: string;
    title: string;
    content: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((prev) => (prev === msg ? null : prev)), 2500);
  };

  useEffect(() => {
    void Promise.all([
      window.glassApi.settings.get(),
      window.glassApi.keys.status(),
      window.glassApi.prompts.list(),
      window.glassApi.sessions.list(),
      window.glassApi.permissions.status(),
    ]).then(([s, k, p, sess, perm]) => {
      setSettings(s);
      setKeyStatus(k);
      setPrompts(p);
      setSessions(sess);
      setPermissions(perm);
      if (sess[0]) setSelectedSessionId(sess[0].id);
    });

    const unsubs = [
      window.glassApi.settings.onChange(setSettings),
      window.glassApi.keys.onChange(setKeyStatus),
      window.glassApi.prompts.onChange(setPrompts),
      window.glassApi.sessions.onChange(setSessions),
      window.glassApi.window.onDashboardNavigate(({ tab: target }) => {
        if (["keys", "prompts", "overlay", "shortcuts", "sessions"].includes(target)) {
          setTab(target as TabId);
        }
      }),
    ];
    return () => {
      for (const fn of unsubs) fn();
    };
  }, []);

  const updateSetting = async (patch: Partial<AppSettings>) => {
    const next = await window.glassApi.settings.update(patch);
    setSettings(next);
  };

  const handleSaveKey = async (provider: AiProvider) => {
    const val = keyInputs[provider].trim();
    if (!val) return;
    await window.glassApi.keys.set(provider, val);
    setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
    flashNotice(`${provider.toUpperCase()} API key encrypted & saved locally.`);
  };

  const handleClearKey = async (provider: AiProvider) => {
    await window.glassApi.keys.set(provider, null);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
    flashNotice(`Removed ${provider.toUpperCase()} API key.`);
  };

  const handleTestKey = async (provider: AiProvider) => {
    setTestingKey((prev) => ({ ...prev, [provider]: true }));
    try {
      const typed = keyInputs[provider].trim() || undefined;
      const result = await window.glassApi.keys.test(provider, typed);
      setTestResults((prev) => ({ ...prev, [provider]: result }));
    } finally {
      setTestingKey((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const startRecordingShortcut = (action: ShortcutAction) => {
    window.glassApi.shortcuts.suspend();
    setRecordingAction(action);
  };

  const handleShortcutKeyDown = async (e: React.KeyboardEvent, action: ShortcutAction) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecordingAction(null);
      window.glassApi.shortcuts.resume();
      return;
    }
    const accel = keyEventToAccelerator(e);
    if (!accel) return;
    await updateSetting({
      shortcuts: {
        ...settings.shortcuts,
        [action]: accel,
      },
    });
    setRecordingAction(null);
    flashNotice(`Updated "${SHORTCUT_LABELS[action]}" to ${accel}`);
  };

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null;

  return (
    <div className="flex h-full w-full flex-col bg-[#0b0d13] text-slate-100">
      {/* macOS Inset Draggable Titlebar */}
      <div className="app-drag flex h-11 shrink-0 items-center justify-between border-b border-white/10 bg-[#0f121b] pr-4 pl-20">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-200">
          <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />
          <span>GlassHUD Copilot</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">
            BYOK Local Desktop
          </span>
        </div>
        <div className="app-no-drag flex items-center gap-2">
          {notice && (
            <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] text-emerald-200">
              {notice}
            </span>
          )}
          <button
            type="button"
            onClick={() => void window.glassApi.window.toggleOverlay()}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
          >
            Toggle Overlay
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="flex w-52 shrink-0 flex-col gap-1 border-r border-white/10 bg-[#0e1118] p-3">
          {(
            [
              { id: "keys", label: "API Keys & Models", icon: KeyRound },
              { id: "prompts", label: "System Prompts", icon: FileText },
              { id: "overlay", label: "Overlay & Audio", icon: Sliders },
              { id: "shortcuts", label: "Global Shortcuts", icon: Keyboard },
              { id: "sessions", label: `Sessions (${sessions.length})`, icon: History },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                  active
                    ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="mt-auto rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-slate-400">
            <div className="mb-1 font-semibold text-slate-200">Local & Private</div>
            Keys are encrypted with OS Keychain (`safeStorage`) and sent directly to your chosen provider.
          </div>
        </aside>

        {/* Main Panel */}
        <main className="glass-scroll flex-1 overflow-y-auto p-6">
          {tab === "keys" && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div>
                <h1 className="text-lg font-semibold text-white">API Keys & Models</h1>
                <p className="mt-1 text-xs text-slate-400">
                  Bring your own keys for OpenAI, Anthropic, and Google Gemini. Switch providers anytime from the floating HUD.
                </p>
              </div>

              {/* Active Provider & STT Selector */}
              <div className="grid grid-cols-2 gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Active AI Provider
                  </label>
                  <select
                    value={settings.provider}
                    onChange={(e) =>
                      void updateSetting({ provider: e.target.value as AiProvider })
                    }
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-indigo-400"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Live Transcription (STT) Provider
                  </label>
                  <select
                    value={settings.sttProvider}
                    onChange={(e) =>
                      void updateSetting({ sttProvider: e.target.value as SttProvider })
                    }
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-indigo-400"
                  >
                    <option value="auto">Auto (OpenAI → Gemini fallback)</option>
                    <option value="openai">OpenAI (gpt-4o-mini-transcribe)</option>
                    <option value="gemini">Google Gemini (gemini-2.5-flash)</option>
                  </select>
                </div>
              </div>

              {/* Per-Provider Cards */}
              <div className="space-y-4">
                {PROVIDERS.map((p) => {
                  const saved = keyStatus[p.id];
                  const presets = MODEL_PRESETS[p.id];
                  const currentModel = settings.models[p.id];
                  return (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold text-white">{p.name}</h2>
                            {saved ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                                <CheckCircle2 className="h-3 w-3" /> Configured
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
                                Not set
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-400">{p.hint}</p>
                        </div>
                        {saved && (
                          <button
                            type="button"
                            onClick={() => void handleClearKey(p.id)}
                            className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                          >
                            Remove Key
                          </button>
                        )}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          type="password"
                          value={keyInputs[p.id]}
                          onChange={(e) =>
                            setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          placeholder={saved ? "•••••••••••• (enter new key to replace)" : p.placeholder}
                          className="flex-1 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 font-mono text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-400"
                        />
                        <button
                          type="button"
                          onClick={() => void handleTestKey(p.id)}
                          disabled={testingKey[p.id] || (!saved && !keyInputs[p.id].trim())}
                          title="Verify key against live provider API"
                          className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
                        >
                          {testingKey[p.id] ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FlaskConical className="h-3.5 w-3.5 text-indigo-300" />
                          )}
                          <span>Test</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveKey(p.id)}
                          disabled={!keyInputs[p.id].trim()}
                          className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-indigo-400 disabled:opacity-40"
                        >
                          <Save className="h-3.5 w-3.5" />
                          <span>Save</span>
                        </button>
                      </div>

                      {testResults[p.id] && (
                        <div
                          className={`mt-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                            testResults[p.id]!.valid
                              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                              : "border-rose-400/30 bg-rose-500/10 text-rose-200"
                          }`}
                        >
                          {testResults[p.id]!.valid ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                              <span>
                                Verified in {testResults[p.id]!.latencyMs}ms
                                {testResults[p.id]!.modelCount !== undefined
                                  ? ` · ${testResults[p.id]!.modelCount} models accessible`
                                  : ""}
                              </span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                              <span className="truncate">{testResults[p.id]!.error}</span>
                            </>
                          )}
                        </div>
                      )}

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-slate-400">Model Preset</label>
                          <select
                            value={presets.some((m) => m.id === currentModel) ? currentModel : ""}
                            onChange={(e) => {
                              if (!e.target.value) return;
                              void updateSetting({
                                models: { ...settings.models, [p.id]: e.target.value },
                              });
                            }}
                            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-400"
                          >
                            {presets.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                            {!presets.some((m) => m.id === currentModel) && (
                              <option value="">Custom ({currentModel})</option>
                            )}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400">
                            Model ID (Editable)
                          </label>
                          <input
                            type="text"
                            value={currentModel}
                            onChange={(e) =>
                              void updateSetting({
                                models: { ...settings.models, [p.id]: e.target.value },
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/80 px-2.5 py-1.5 font-mono text-xs text-slate-200 outline-none focus:border-indigo-400"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "prompts" && (
            <div className="mx-auto max-w-2xl space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-semibold text-white">System Prompts</h1>
                  <p className="mt-1 text-xs text-slate-400">
                    Choose the active persona or create reusable custom instructions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditingPrompt({
                      id: `custom-${Date.now().toString(36)}`,
                      title: "New Custom Prompt",
                      content: "",
                    })
                  }
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>New Prompt</span>
                </button>
              </div>

              {editingPrompt && (
                <div className="space-y-3 rounded-2xl border border-indigo-400/40 bg-indigo-950/20 p-4">
                  <input
                    type="text"
                    value={editingPrompt.title}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, title: e.target.value })
                    }
                    placeholder="Prompt title"
                    className="w-full rounded-xl border border-white/10 bg-slate-950/90 px-3 py-2 text-xs font-medium text-white outline-none focus:border-indigo-400"
                  />
                  <textarea
                    rows={5}
                    value={editingPrompt.content}
                    onChange={(e) =>
                      setEditingPrompt({ ...editingPrompt, content: e.target.value })
                    }
                    placeholder="Write your system instructions here..."
                    className="w-full rounded-xl border border-white/10 bg-slate-950/90 p-3 text-xs text-slate-200 outline-none focus:border-indigo-400"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingPrompt(null)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await window.glassApi.prompts.upsert(editingPrompt);
                        await updateSetting({ activePromptId: editingPrompt.id });
                        setEditingPrompt(null);
                        flashNotice("Custom prompt saved & selected.");
                      }}
                      className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400"
                    >
                      Save Prompt
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {prompts.map((p) => {
                  const isActive = settings.activePromptId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`rounded-2xl border p-4 transition ${
                        isActive
                          ? "border-indigo-400/50 bg-indigo-500/10"
                          : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-white">{p.title}</h3>
                          {p.builtIn && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                              Built-in
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!p.builtIn && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingPrompt({
                                    id: p.id,
                                    title: p.title,
                                    content: p.content,
                                  })
                                }
                                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void window.glassApi.prompts.delete(p.id)}
                                className="rounded-lg p-1 text-slate-400 hover:bg-rose-500/15 hover:text-rose-300"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => void updateSetting({ activePromptId: p.id })}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                              isActive
                                ? "bg-indigo-500 text-white"
                                : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            {isActive ? "Active" : "Use"}
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">
                        {p.content}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "overlay" && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div>
                <h1 className="text-lg font-semibold text-white">Overlay, Audio & Permissions</h1>
                <p className="mt-1 text-xs text-slate-400">
                  Configure floating HUD presentation, audio channels, and OS capture permissions.
                </p>
              </div>

              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <label className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                      <Shield className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Screen-Share Privacy (Content Protection)</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Uses Electron&apos;s `setContentProtection(true)` so the overlay stays out of your screen recordings and screen shares.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.contentProtection}
                    onChange={(e) =>
                      void updateSetting({ contentProtection: e.target.checked })
                    }
                    className="h-4 w-4 accent-indigo-500"
                  />
                </label>

                <div className="border-t border-white/10 pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">Overlay Opacity</span>
                    <span className="font-mono text-slate-400">
                      {Math.round(settings.overlayOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={1}
                    step={0.02}
                    value={settings.overlayOpacity}
                    onChange={(e) =>
                      void updateSetting({ overlayOpacity: Number(e.target.value) })
                    }
                    className="mt-2 w-full accent-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-3">
                  <div>
                    <label className="text-xs font-medium text-slate-200">
                      Default Code Language
                    </label>
                    <select
                      value={settings.programmingLanguage}
                      onChange={(e) =>
                        void updateSetting({ programmingLanguage: e.target.value })
                      }
                      className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white"
                    >
                      {PROGRAMMING_LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                    <div>
                      <div className="text-xs font-medium text-white">Incognito Mode</div>
                      <div className="text-[10px] text-slate-400">Skip saving session history</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.incognito}
                      onChange={(e) => void updateSetting({ incognito: e.target.checked })}
                      className="h-4 w-4 accent-indigo-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-3">
                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                    <div>
                      <div className="text-xs font-medium text-white">Capture System Audio</div>
                      <div className="text-[10px] text-slate-400">macOS 14.2+ Core Audio tap</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.captureSystemAudio}
                      onChange={(e) =>
                        void updateSetting({ captureSystemAudio: e.target.checked })
                      }
                      className="h-4 w-4 accent-indigo-500"
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                    <div>
                      <div className="text-xs font-medium text-white">Capture Microphone</div>
                      <div className="text-[10px] text-slate-400">Your voice in transcripts</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.captureMicAudio}
                      onChange={(e) =>
                        void updateSetting({ captureMicAudio: e.target.checked })
                      }
                      className="h-4 w-4 accent-indigo-500"
                    />
                  </label>
                </div>
              </div>

              {/* Permissions Diagnostics */}
              {permissions && (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white">OS Permissions & Audio Helper</h2>
                    <button
                      type="button"
                      onClick={() =>
                        void window.glassApi.permissions.status().then(setPermissions)
                      }
                      className="text-xs text-indigo-300 hover:text-indigo-200"
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between rounded-xl bg-slate-950/70 px-3 py-2">
                      <span className="text-slate-300">Microphone Permission</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-300">
                          {permissions.microphone}
                        </span>
                        {permissions.microphone !== "granted" && (
                          <button
                            type="button"
                            onClick={async () => {
                              await window.glassApi.permissions.requestMic();
                              setPermissions(await window.glassApi.permissions.status());
                            }}
                            className="rounded bg-indigo-500 px-2 py-0.5 text-[11px] text-white"
                          >
                            Request
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => window.glassApi.permissions.openSettings("microphone")}
                          className="text-slate-400 hover:text-white"
                          title="Open System Settings"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-slate-950/70 px-3 py-2">
                      <span className="text-slate-300">Screen & System Audio Recording</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-300">
                          {permissions.screen}
                        </span>
                        <button
                          type="button"
                          onClick={() => window.glassApi.permissions.openSettings("screen")}
                          className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/10"
                        >
                          <span>System Settings</span>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-slate-950/70 px-3 py-2">
                      <span className="text-slate-300">Native macOS Core Audio Tap Binary</span>
                      <span className="flex items-center gap-1 text-[11px]">
                        {permissions.nativeAudioHelperBuilt ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="text-emerald-300">Compiled & Ready</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3.5 w-3.5 text-amber-400" />
                            <span className="text-amber-300">Run npm run build:native</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "shortcuts" && (
            <div className="mx-auto max-w-2xl space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-semibold text-white">Global Shortcuts</h1>
                  <p className="mt-1 text-xs text-slate-400">
                    Click any binding and press a new key combination (with Cmd/Ctrl or Alt). Press Escape to cancel.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await updateSetting({ shortcuts: { ...DEFAULT_SHORTCUTS } });
                    flashNotice("Shortcuts reset to defaults.");
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Defaults</span>
                </button>
              </div>

              <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => {
                  const isRec = recordingAction === action;
                  return (
                    <div
                      key={action}
                      className="flex items-center justify-between px-4 py-2.5 text-xs"
                    >
                      <span className="text-slate-200">{SHORTCUT_LABELS[action]}</span>
                      <button
                        type="button"
                        onClick={() => startRecordingShortcut(action)}
                        onKeyDown={(e) => {
                          if (isRec) void handleShortcutKeyDown(e, action);
                        }}
                        onBlur={() => {
                          if (isRec) {
                            setRecordingAction(null);
                            window.glassApi.shortcuts.resume();
                          }
                        }}
                        className={`min-w-[170px] rounded-lg border px-3 py-1 font-mono text-[11px] transition ${
                          isRec
                            ? "border-indigo-400 bg-indigo-500/25 text-indigo-100"
                            : "border-white/10 bg-slate-950/80 text-slate-300 hover:border-white/25"
                        }`}
                      >
                        {isRec ? "Press shortcut..." : settings.shortcuts[action]}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "sessions" && (
            <div className="flex h-full gap-4">
              {/* Session List */}
              <div className="flex w-64 shrink-0 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Saved Sessions</h2>
                  {sessions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void window.glassApi.sessions.clear()}
                      className="text-[11px] text-rose-300 hover:text-rose-200"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div className="glass-scroll flex-1 space-y-1.5 overflow-y-auto">
                  {sessions.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center text-xs text-slate-500">
                      No saved sessions yet.
                    </div>
                  ) : (
                    sessions.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => setSelectedSessionId(s.id)}
                        className={`group flex cursor-pointer items-start justify-between rounded-xl border p-2.5 text-xs transition ${
                          selectedSession?.id === s.id
                            ? "border-indigo-400/40 bg-indigo-500/15 text-white"
                            : "border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{s.title}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {new Date(s.updatedAt).toLocaleString()} · {s.turns.length} msgs
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void window.glassApi.sessions.delete(s.id);
                          }}
                          className="ml-1 rounded p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Session Detail */}
              <div className="glass-scroll flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                {!selectedSession ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">
                    Select a session to inspect its conversation and transcripts.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="border-b border-white/10 pb-3">
                      <h3 className="text-sm font-semibold text-white">{selectedSession.title}</h3>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {selectedSession.provider.toUpperCase()} · {selectedSession.model} ·{" "}
                        {new Date(selectedSession.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="space-y-3">
                      {selectedSession.turns.map((t) => (
                        <div
                          key={t.id}
                          className={
                            t.role === "user"
                              ? "rounded-xl border border-indigo-400/20 bg-indigo-500/10 p-3 text-xs text-indigo-100"
                              : "rounded-xl border border-white/10 bg-slate-950/60 p-3"
                          }
                        >
                          {t.role === "user" ? (
                            <p className="whitespace-pre-wrap">{t.text}</p>
                          ) : (
                            <MarkdownView content={t.text} />
                          )}
                        </div>
                      ))}
                    </div>

                    {selectedSession.transcripts.length > 0 && (
                      <div className="space-y-2 border-t border-white/10 pt-3">
                        <h4 className="text-xs font-semibold text-slate-300">
                          Audio Transcript ({selectedSession.transcripts.length})
                        </h4>
                        {selectedSession.transcripts.map((seg) => (
                          <div
                            key={seg.id}
                            className="rounded-lg bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300"
                          >
                            <span className="mr-2 font-semibold text-indigo-300">
                              [{seg.source === "system" ? "System" : "You"}]
                            </span>
                            {seg.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
