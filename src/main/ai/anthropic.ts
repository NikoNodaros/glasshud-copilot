import type { StreamCompletionParams } from "./openai";
import { parseSseStream, stripDataUrlPrefix } from "./sse";

export async function streamAnthropicCompletion(params: StreamCompletionParams): Promise<string> {
  const { apiKey, model, systemPrompt, messages, signal, onDelta, fetchImpl = fetch } = params;

  const formattedMessages = messages.map((msg) => {
    if (msg.role === "user" && msg.images && msg.images.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      for (const img of msg.images) {
        const { mimeType, base64 } = stripDataUrlPrefix(img.dataUrl);
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: base64,
          },
        });
      }
      blocks.push({ type: "text", text: msg.text });
      return { role: "user", content: blocks };
    }
    return { role: msg.role, content: msg.text };
  });

  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.25,
      stream: true,
      system: systemPrompt,
      messages: formattedMessages,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Anthropic API error (${response.status}): ${errText || response.statusText}`);
  }

  let fullText = "";
  for await (const evt of parseSseStream(response.body, signal)) {
    if (!evt.data || evt.data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(evt.data) as {
        type?: string;
        delta?: { type?: string; text?: string };
        error?: { message?: string };
      };
      if (parsed.type === "error" || parsed.error) {
        throw new Error(parsed.error?.message || "Anthropic stream error");
      }
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
        fullText += parsed.delta.text;
        onDelta(parsed.delta.text);
      }
    } catch (err) {
      if (err instanceof SyntaxError) continue;
      throw err;
    }
  }

  return fullText;
}
