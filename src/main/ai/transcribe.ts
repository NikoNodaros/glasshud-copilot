import { randomUUID } from "node:crypto";
import type { AudioChannel, SttProvider, TranscriptSegment } from "@shared/types";
import { encodePcm16ToWav } from "@shared/wav";
import { transcribeWithOpenAi } from "./openai";
import { transcribeWithGemini } from "./gemini";

export interface TranscribeUtteranceParams {
  source: AudioChannel;
  pcmBytes: Uint8Array;
  sampleRate: number;
  sttProvider: SttProvider;
  getApiKey: (provider: "openai" | "gemini") => string | null;
}

/**
 * Resolves the active STT provider (OpenAI or Google Gemini) from configured BYOK keys
 * and transcribes a VAD-framed PCM16 utterance.
 */
export async function transcribePcmUtterance(
  params: TranscribeUtteranceParams,
): Promise<TranscriptSegment | null> {
  const { source, pcmBytes, sampleRate, sttProvider, getApiKey } = params;
  const openAiKey = getApiKey("openai");
  const geminiKey = getApiKey("gemini");

  let chosen: "openai" | "gemini" | null = null;
  if (sttProvider === "openai" && openAiKey) chosen = "openai";
  else if (sttProvider === "gemini" && geminiKey) chosen = "gemini";
  else if (sttProvider === "auto") {
    if (openAiKey) chosen = "openai";
    else if (geminiKey) chosen = "gemini";
  }

  if (!chosen) {
    throw new Error(
      "Live transcription requires an OpenAI or Google Gemini API key configured in Settings.",
    );
  }

  const wavBytes = encodePcm16ToWav(pcmBytes, sampleRate, 1);
  const started = Date.now();
  const text =
    chosen === "openai"
      ? await transcribeWithOpenAi({ apiKey: openAiKey!, wavBytes })
      : await transcribeWithGemini({ apiKey: geminiKey!, wavBytes });

  const cleaned = text.trim();
  if (!cleaned) return null;

  return {
    id: randomUUID(),
    source,
    text: cleaned,
    timestamp: Date.now(),
    latencyMs: Date.now() - started,
  };
}
