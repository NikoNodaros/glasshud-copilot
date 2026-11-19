import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AiProvider,
  ApiKeyStatus,
  AppSettings,
  CustomPrompt,
  SessionRecord,
} from "@shared/types";
import { BUILT_IN_PROMPTS, DEFAULT_SETTINGS, DEFAULT_SHORTCUTS } from "@shared/defaults";

interface StoredKeyEntry {
  encrypted: boolean;
  value: string;
}

interface PersistedState {
  settings: AppSettings;
  customPrompts: CustomPrompt[];
  sessions: SessionRecord[];
  apiKeys: Partial<Record<AiProvider, StoredKeyEntry>>;
}

export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const MAX_SESSIONS = 100;

export class LocalStore {
  private readonly filePath: string;
  private readonly cipher?: SecretCipher;
  private state: PersistedState;

  constructor(userDataDir: string, cipher?: SecretCipher) {
    mkdirSync(userDataDir, { recursive: true });
    this.filePath = join(userDataDir, "glasshud-store.json");
    this.cipher = cipher;
    this.state = this.load();
  }

  private load(): PersistedState {
    if (!existsSync(this.filePath)) {
      return {
        settings: structuredClone(DEFAULT_SETTINGS),
        customPrompts: [],
        sessions: [],
        apiKeys: {},
      };
    }

    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PersistedState>;
      return {
        settings: {
          ...DEFAULT_SETTINGS,
          ...(raw.settings ?? {}),
          models: {
            ...DEFAULT_SETTINGS.models,
            ...(raw.settings?.models ?? {}),
          },
          shortcuts: {
            ...DEFAULT_SHORTCUTS,
            ...(raw.settings?.shortcuts ?? {}),
          },
        },
        customPrompts: Array.isArray(raw.customPrompts) ? raw.customPrompts : [],
        sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
        apiKeys: raw.apiKeys ?? {},
      };
    } catch {
      return {
        settings: structuredClone(DEFAULT_SETTINGS),
        customPrompts: [],
        sessions: [],
        apiKeys: {},
      };
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  getSettings(): AppSettings {
    return structuredClone(this.state.settings);
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.state.settings = {
      ...this.state.settings,
      ...patch,
      models: {
        ...this.state.settings.models,
        ...(patch.models ?? {}),
      },
      shortcuts: {
        ...this.state.settings.shortcuts,
        ...(patch.shortcuts ?? {}),
      },
    };
    this.persist();
    return this.getSettings();
  }

  setApiKey(provider: AiProvider, key: string | null): ApiKeyStatus {
    const trimmed = key?.trim() ?? "";
    if (!trimmed) {
      delete this.state.apiKeys[provider];
    } else if (this.cipher?.isEncryptionAvailable()) {
      const buf = this.cipher.encryptString(trimmed);
      this.state.apiKeys[provider] = {
        encrypted: true,
        value: buf.toString("base64"),
      };
    } else {
      this.state.apiKeys[provider] = {
        encrypted: false,
        value: trimmed,
      };
    }
    this.persist();
    return this.getApiKeyStatus();
  }

  getApiKey(provider: AiProvider): string | null {
    const entry = this.state.apiKeys[provider];
    if (!entry) return null;
    if (entry.encrypted) {
      if (!this.cipher?.isEncryptionAvailable()) return null;
      try {
        return this.cipher.decryptString(Buffer.from(entry.value, "base64"));
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  getApiKeyStatus(): ApiKeyStatus {
    return {
      openai: Boolean(this.getApiKey("openai")),
      anthropic: Boolean(this.getApiKey("anthropic")),
      gemini: Boolean(this.getApiKey("gemini")),
    };
  }

  listPrompts(): CustomPrompt[] {
    return [...BUILT_IN_PROMPTS, ...this.state.customPrompts];
  }

  upsertPrompt(prompt: Omit<CustomPrompt, "updatedAt">): CustomPrompt[] {
    const existingIdx = this.state.customPrompts.findIndex((p) => p.id === prompt.id);
    const record: CustomPrompt = {
      id: prompt.id,
      title: prompt.title.trim() || "Untitled Prompt",
      content: prompt.content,
      builtIn: false,
      updatedAt: Date.now(),
    };
    if (existingIdx >= 0) {
      this.state.customPrompts[existingIdx] = record;
    } else {
      this.state.customPrompts.unshift(record);
    }
    this.persist();
    return this.listPrompts();
  }

  deletePrompt(id: string): CustomPrompt[] {
    this.state.customPrompts = this.state.customPrompts.filter((p) => p.id !== id);
    if (this.state.settings.activePromptId === id) {
      this.state.settings.activePromptId = BUILT_IN_PROMPTS[0].id;
    }
    this.persist();
    return this.listPrompts();
  }

  listSessions(): SessionRecord[] {
    return structuredClone(this.state.sessions);
  }

  saveSession(session: SessionRecord): SessionRecord[] {
    const idx = this.state.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.state.sessions[idx] = session;
    } else {
      this.state.sessions.unshift(session);
    }
    this.state.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    if (this.state.sessions.length > MAX_SESSIONS) {
      this.state.sessions = this.state.sessions.slice(0, MAX_SESSIONS);
    }
    this.persist();
    return this.listSessions();
  }

  deleteSession(id: string): SessionRecord[] {
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
    this.persist();
    return this.listSessions();
  }

  clearSessions(): SessionRecord[] {
    this.state.sessions = [];
    this.persist();
    return [];
  }
}
