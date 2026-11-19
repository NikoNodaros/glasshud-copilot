import type { AiProvider, AppSettings, CustomPrompt, ShortcutAction, ShortcutMap } from "./types";

export const MODEL_PRESETS: Record<AiProvider, Array<{ id: string; label: string }>> = {
  openai: [
    { id: "gpt-4.1", label: "GPT-4.1 (Vision & Coding)" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini (Fast)" },
    { id: "gpt-4o", label: "GPT-4o (Multimodal)" },
    { id: "o4-mini", label: "o4-mini (Reasoning)" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Recommended)" },
    { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (Fast)" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Deep Reasoning)" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast & Multimodal)" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  toggle_overlay: "Show / Hide Overlay",
  trigger_ai: "Ask AI (Send Context)",
  capture_screenshot: "Capture Screen",
  delete_last_screenshot: "Delete Last Screenshot",
  clear_session: "Start New Session",
  toggle_audio: "Toggle Audio Capture",
  opacity_down: "Decrease Overlay Opacity",
  opacity_up: "Increase Overlay Opacity",
  zoom_out: "Zoom Out Overlay",
  zoom_in: "Zoom In Overlay",
  zoom_reset: "Reset Overlay Zoom",
  move_up: "Nudge HUD Up",
  move_down: "Nudge HUD Down",
  move_left: "Nudge HUD Left",
  move_right: "Nudge HUD Right",
  scroll_up: "Scroll Response Up",
  scroll_down: "Scroll Response Down",
  tab_response: "Switch to Response Tab",
  tab_transcript: "Switch to Transcript Tab",
};

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggle_overlay: "CommandOrControl+B",
  trigger_ai: "CommandOrControl+Enter",
  capture_screenshot: "CommandOrControl+H",
  delete_last_screenshot: "CommandOrControl+L",
  clear_session: "CommandOrControl+G",
  toggle_audio: "CommandOrControl+Shift+\\",
  opacity_down: "CommandOrControl+[",
  opacity_up: "CommandOrControl+]",
  zoom_out: "CommandOrControl+-",
  zoom_in: "CommandOrControl+=",
  zoom_reset: "CommandOrControl+0",
  move_up: "CommandOrControl+Up",
  move_down: "CommandOrControl+Down",
  move_left: "CommandOrControl+Left",
  move_right: "CommandOrControl+Right",
  scroll_up: "CommandOrControl+Shift+Up",
  scroll_down: "CommandOrControl+Shift+Down",
  tab_response: "Alt+1",
  tab_transcript: "Alt+2",
};

export const BUILT_IN_PROMPTS: CustomPrompt[] = [
  {
    id: "coding-assistant",
    title: "Coding Assistant",
    builtIn: true,
    updatedAt: 0,
    content: [
      "You are a concise, senior software engineering copilot displayed in a compact desktop overlay.",
      "When given screenshots of code, errors, or problem statements, provide:",
      "1. A 2-sentence approach overview (algorithm / root cause).",
      "2. Clean, well-structured code in the requested programming language.",
      "3. Time and space complexity (Big-O) plus edge cases.",
      "Keep formatting scannable with short bullet points and fenced code blocks.",
    ].join("\n"),
  },
  {
    id: "system-design",
    title: "System Design",
    builtIn: true,
    updatedAt: 0,
    content: [
      "You are a principal distributed systems architect in a compact desktop overlay.",
      "Structure responses into: Requirements & Scale, High-Level Architecture, Data Model & Storage, Bottlenecks & Trade-offs.",
      "Favor concrete numbers, clear component names, and concise bullet lists.",
    ].join("\n"),
  },
  {
    id: "meeting-copilot",
    title: "Meeting Copilot",
    builtIn: true,
    updatedAt: 0,
    content: [
      "You are a live meeting & conversation assistant.",
      "Use the live audio transcript (System = other participants, You = local microphone) and any attached screen context to answer questions concisely, suggest clarifying points, or summarize decisions and action items.",
      "Lead with the most direct answer first (2-4 bullet points max unless asked for more detail).",
    ].join("\n"),
  },
  {
    id: "general-qa",
    title: "General Assistant",
    builtIn: true,
    updatedAt: 0,
    content: [
      "You are a fast, accurate desktop assistant. Analyze any screenshots, live transcripts, and user instructions, and respond clearly and concisely in Markdown.",
    ].join("\n"),
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  provider: "openai",
  models: {
    openai: "gpt-4.1",
    anthropic: "claude-sonnet-4-20250514",
    gemini: "gemini-2.5-flash",
  },
  sttProvider: "auto",
  activePromptId: "coding-assistant",
  programmingLanguage: "TypeScript",
  contentProtection: true,
  overlayOpacity: 0.92,
  incognito: false,
  captureSystemAudio: true,
  captureMicAudio: true,
  autoLaunch: false,
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

export const PROGRAMMING_LANGUAGES = [
  "Auto",
  "TypeScript",
  "Python",
  "JavaScript",
  "Go",
  "Rust",
  "Java",
  "C++",
  "C#",
  "Swift",
  "SQL",
];
