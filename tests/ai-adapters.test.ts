import { describe, expect, it } from "vitest";
import { streamOpenAiCompletion, transcribeWithOpenAi } from "../src/main/ai/openai";
import { streamAnthropicCompletion } from "../src/main/ai/anthropic";
import { streamGeminiCompletion, transcribeWithGemini } from "../src/main/ai/gemini";
import { verifyProviderApiKey } from "../src/main/ai/verifyKey";
import { encodePcm16ToWav } from "../src/shared/wav";

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("AI streaming adapters", () => {
  it("streams OpenAI Chat Completions with vision images", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world!"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    };

    const deltas: string[] = [];
    const result = await streamOpenAiCompletion({
      apiKey: "sk-test",
      model: "gpt-4.1",
      systemPrompt: "Be concise.",
      messages: [
        {
          role: "user",
          text: "Solve this",
          images: [{ mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AAAA" }],
        },
      ],
      signal: new AbortController().signal,
      onDelta: (d) => deltas.push(d),
      fetchImpl: mockFetch,
    });

    expect(result).toBe("Hello world!");
    expect(deltas).toEqual(["Hello ", "world!"]);
    expect(capturedBody).not.toBeNull();
    const msgs = capturedBody!.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0]).toEqual({ role: "system", content: "Be concise." });
    expect(Array.isArray(msgs[1].content)).toBe(true);
  });

  it("streams Anthropic Messages with base64 image blocks", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> | null = null;

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"O(n) "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"time."}}\n\n',
      ]);
    };

    const deltas: string[] = [];
    const result = await streamAnthropicCompletion({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      systemPrompt: "Senior engineer",
      messages: [
        {
          role: "user",
          text: "Complexity?",
          images: [{ mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,BBBB" }],
        },
      ],
      signal: new AbortController().signal,
      onDelta: (d) => deltas.push(d),
      fetchImpl: mockFetch,
    });

    expect(result).toBe("O(n) time.");
    expect(deltas).toEqual(["O(n) ", "time."]);
    expect(capturedHeaders["x-api-key"]).toBe("sk-ant-test");
    const msgs = capturedBody!.messages as Array<{ content: Array<{ type: string }> }>;
    expect(msgs[0].content[0].type).toBe("image");
    expect(msgs[0].content[1].type).toBe("text");
  });

  it("streams Google Gemini SSE with inline_data image parts", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> | null = null;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Use a "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"hash map."}]}}]}\n\n',
      ]);
    };

    const deltas: string[] = [];
    const result = await streamGeminiCompletion({
      apiKey: "AIza-test",
      model: "gemini-2.5-flash",
      systemPrompt: "Concise",
      messages: [
        {
          role: "user",
          text: "Two sum",
          images: [{ mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,CCCC" }],
        },
      ],
      signal: new AbortController().signal,
      onDelta: (d) => deltas.push(d),
      fetchImpl: mockFetch,
    });

    expect(result).toBe("Use a hash map.");
    expect(deltas).toEqual(["Use a ", "hash map."]);
    expect(capturedUrl).toContain("gemini-2.5-flash:streamGenerateContent?alt=sse");
    expect(capturedHeaders["x-goog-api-key"]).toBe("AIza-test");
    const contents = capturedBody!.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    expect(contents[0].parts[0]).toHaveProperty("inline_data");
  });

  it("transcribes WAV buffers via OpenAI and Gemini STT", async () => {
    const wav = encodePcm16ToWav(new Uint8Array(320), 16000, 1);

    const openAiText = await transcribeWithOpenAi({
      apiKey: "sk-test",
      wavBytes: wav,
      fetchImpl: async () =>
        new Response(JSON.stringify({ text: "Tell me about dynamic programming." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    expect(openAiText).toBe("Tell me about dynamic programming.");

    const geminiText = await transcribeWithGemini({
      apiKey: "AIza-test",
      wavBytes: wav,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "What is the space complexity?" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    expect(geminiText).toBe("What is the space complexity?");
  });

  it("verifies live API keys for OpenAI, Anthropic, and Gemini", async () => {
    const okOpenAi = await verifyProviderApiKey({
      provider: "openai",
      apiKey: "sk-proj-test-key",
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.openai.com/v1/models");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-proj-test-key");
        return new Response(JSON.stringify({ data: [{ id: "gpt-4.1" }, { id: "gpt-4o" }] }), {
          status: 200,
        });
      },
    });
    expect(okOpenAi.valid).toBe(true);
    expect(okOpenAi.modelCount).toBe(2);

    const okAnthropic = await verifyProviderApiKey({
      provider: "anthropic",
      apiKey: "sk-ant-api03-test",
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.anthropic.com/v1/models");
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-api03-test");
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4-20250514" }] }), {
          status: 200,
        });
      },
    });
    expect(okAnthropic.valid).toBe(true);
    expect(okAnthropic.modelCount).toBe(1);

    const badGemini = await verifyProviderApiKey({
      provider: "gemini",
      apiKey: "AIza-invalid",
      fetchImpl: async (_url, init) => {
        expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-invalid");
        return new Response(JSON.stringify({ error: { message: "API key not valid." } }), {
          status: 400,
        });
      },
    });
    expect(badGemini.valid).toBe(false);
    expect(badGemini.error).toContain("API key not valid.");
  });
});
