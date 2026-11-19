import type { StreamCompletionParams } from "./openai";
import { parseSseStream, stripDataUrlPrefix } from "./sse";

export async function streamGeminiCompletion(params: StreamCompletionParams): Promise<string> {
  const { apiKey, model, systemPrompt, messages, signal, onDelta, fetchImpl = fetch } = params;

  const contents = messages.map((msg) => {
    const parts: Array<Record<string, unknown>> = [];
    if (msg.role === "user" && msg.images && msg.images.length > 0) {
      for (const img of msg.images) {
        const { mimeType, base64 } = stripDataUrlPrefix(img.dataUrl);
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64,
          },
        });
      }
    }
    parts.push({ text: msg.text });
    return {
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    };
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 4096,
      },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini API error (${response.status}): ${errText || response.statusText}`);
  }

  let fullText = "";
  for await (const evt of parseSseStream(response.body, signal)) {
    if (!evt.data || evt.data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(evt.data) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        error?: { message?: string };
      };
      if (parsed.error?.message) {
        throw new Error(parsed.error.message);
      }
      const parts = parsed.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text) {
          fullText += part.text;
          onDelta(part.text);
        }
      }
    } catch (err) {
      if (err instanceof SyntaxError) continue;
      throw err;
    }
  }

  return fullText;
}

export async function transcribeWithGemini(params: {
  apiKey: string;
  wavBytes: Uint8Array;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { apiKey, wavBytes, model = "gemini-2.5-flash", fetchImpl = fetch } = params;
  const base64Audio = Buffer.from(wavBytes).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: "audio/wav",
                data: base64Audio,
              },
            },
            {
              text: "Transcribe the speech in this audio clip verbatim. Return ONLY the spoken text with punctuation. If there is only silence or background noise with no clear speech, return an empty string.",
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini STT error (${response.status}): ${errText || response.statusText}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  return text === '""' ? "" : text;
}
