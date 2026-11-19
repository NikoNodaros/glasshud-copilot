import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore, type SecretCipher } from "../src/main/store";
import { buildSystemPrompt, buildUserTurnText } from "../src/main/ai";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "glasshud-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("LocalStore and prompt assembly", () => {
  it("encrypts and decrypts BYOK API keys via cipher and persists settings", () => {
    const dir = makeTempDir();
    const mockCipher: SecretCipher = {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`enc:${plain}`, "utf8"),
      decryptString: (buf) => buf.toString("utf8").replace(/^enc:/, ""),
    };

    const store = new LocalStore(dir, mockCipher);
    expect(store.getApiKeyStatus()).toEqual({
      openai: false,
      anthropic: false,
      gemini: false,
    });

    store.setApiKey("openai", "sk-secret-123");
    store.setApiKey("anthropic", "sk-ant-456");
    store.setApiKey("gemini", "AIza-789");
    store.updateSettings({ provider: "anthropic", programmingLanguage: "Python" });

    // Re-open from disk
    const reloaded = new LocalStore(dir, mockCipher);
    expect(reloaded.getApiKey("openai")).toBe("sk-secret-123");
    expect(reloaded.getApiKey("anthropic")).toBe("sk-ant-456");
    expect(reloaded.getApiKey("gemini")).toBe("AIza-789");
    expect(reloaded.getSettings().provider).toBe("anthropic");
    expect(reloaded.getSettings().programmingLanguage).toBe("Python");
  });

  it("builds system prompt with preferred language and user turn with transcript context", () => {
    const dir = makeTempDir();
    const store = new LocalStore(dir);
    store.upsertPrompt({
      id: "custom-1",
      title: "Rust Tutor",
      content: "Explain ownership clearly.",
    });
    const settings = store.updateSettings({
      activePromptId: "custom-1",
      programmingLanguage: "Rust",
    });

    const sys = buildSystemPrompt(settings, store.listPrompts());
    expect(sys).toContain("Explain ownership clearly.");
    expect(sys).toContain("Preferred programming language for code examples: Rust.");

    const turn = buildUserTurnText(
      "Why does this borrow fail?",
      "optimize",
      [
        {
          id: "t1",
          source: "system",
          text: "Can we avoid cloning here?",
          timestamp: Date.now(),
        },
      ],
      true,
    );
    expect(turn).toContain("[System Audio] Can we avoid cloning here?");
    expect(turn).toContain("Why does this borrow fail?");
  });
});
