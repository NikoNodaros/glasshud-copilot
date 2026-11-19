import { parseSseStream } from "./sse";

export interface ProviderImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataUrl: string;
}

export interface ProviderMessage {
  role: "user" | "assistant";
  text: string;
  images?: ProviderImage[];
}

export interface StreamCompletionParams {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ProviderMessage[];
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  fetchImpl?: typeof fetch;
}

function isReasoningModel(model: string): boolean {
  return /^(o1|o3|o4|gpt-5)/i.test(model);
}

export async function streamOpenAiCompletion(params: StreamCompletionParams): Promise<string> {
  const { apiKey, model, systemPrompt, messages, signal, onDelta, fetchImpl = fetch } = params;

  const formattedMessages: Array<Record<string, unknown>> = [
    { role: isReasoningModel(model) ? "developer" : "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === "user" && msg.images && msg.images.length > 0) {
      const content: Array<Record<string, unknown>> = [{ type: "text", text: msg.text }];
      for (const img of msg.images) {
        content.push({
          type: "image_url",
          image_url: { url: img.dataUrl, detail: "high" },
        });
      }
      formattedMessages.push({ role: "user", content });
    } else {
      formattedMessages.push({ role: msg.role, content: msg.text });
    }
  }

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: formattedMessages,
  };
  if (isReasoningModel(model)) {
    body.max_completion_tokens = 4096;
  } else {
    body.max_tokens = 4096;
    body.temperature = 0.25;
  }

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI API error (${response.status}): ${errText || response.statusText}`);
  }

  let fullText = "";
  for await (const evt of parseSseStream(response.body, signal)) {
    if (evt.data === "[DONE]") break;
    try {
      const parsed = JSON.parse(evt.data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        error?: { message?: string };
      };
      if (parsed.error?.message) {
        throw new Error(parsed.error.message);
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }
    } catch (err) {
      if (err instanceof SyntaxError) continue;
      throw err;
    }
  }

  return fullText;
}

export async function transcribeWithOpenAi(params: {
  apiKey: string;
  wavBytes: Uint8Array;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { apiKey, wavBytes, model = "gpt-4o-mini-transcribe", fetchImpl = fetch } = params;
  const form = new FormData();
  const arrayCopy = new Uint8Array(wavBytes.byteLength);
  arrayCopy.set(wavBytes);
  form.append("file", new Blob([arrayCopy], { type: "audio/wav" }), "utterance.wav");
  form.append("model", model);

  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    if (model !== "whisper-1" && response.status === 404) {
      return transcribeWithOpenAi({ apiKey, wavBytes, model: "whisper-1", fetchImpl });
    }
    throw new Error(`OpenAI STT error (${response.status}): ${errText || response.statusText}`);
  }

  const json = (await response.json()) as { text?: string };
  return (json.text ?? "").trim();
}
