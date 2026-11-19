import type {
  AiProvider,
  AiStreamEvent,
  AiStreamRequest,
  AppSettings,
  CustomPrompt,
  TranscriptSegment,
} from "@shared/types";
import { streamOpenAiCompletion, type ProviderMessage } from "./openai";
import { streamAnthropicCompletion } from "./anthropic";
import { streamGeminiCompletion } from "./gemini";

const QUICK_ACTION_INSTRUCTIONS: Record<NonNullable<AiStreamRequest["quickAction"]>, string> = {
  solve:
    "Analyze the attached screenshot(s) and context. Identify the exact problem, explain the optimal approach briefly, write clean working code, and give time/space complexity.",
  say_next:
    "Based on the live transcript and current screen, suggest a concise, natural verbal response (2-4 clear bullet points) I can use next.",
  optimize:
    "Review the code/solution shown on screen or in prior turns. Identify bugs, edge cases, and time/space optimizations, then provide the improved version.",
  summarize:
    "Summarize the conversation transcript and on-screen context into key points, open questions, and concrete next steps.",
  follow_up:
    "Anticipate likely follow-up questions or edge cases based on the current topic and provide crisp answers for each.",
};

export function buildSystemPrompt(
  settings: AppSettings,
  prompts: CustomPrompt[],
): string {
  const active = prompts.find((p) => p.id === settings.activePromptId) ?? prompts[0];
  const sections: string[] = [active?.content ?? "You are a helpful desktop AI assistant."];

  if (settings.programmingLanguage && settings.programmingLanguage !== "Auto") {
    sections.push(
      `Preferred programming language for code examples: ${settings.programmingLanguage}.`,
    );
  }

  return sections.join("\n\n");
}

export function buildUserTurnText(
  userPrompt: string,
  quickAction: AiStreamRequest["quickAction"],
  transcripts: TranscriptSegment[],
  hasScreenshots: boolean,
): string {
  const parts: string[] = [];

  if (transcripts.length > 0) {
    const recent = transcripts.slice(-30);
    const formatted = recent
      .map((seg) => `[${seg.source === "system" ? "System Audio" : "You"}] ${seg.text}`)
      .join("\n");
    parts.push(`### Recent Audio Transcript\n${formatted}`);
  }

  const trimmed = userPrompt.trim();
  if (quickAction && !trimmed) {
    parts.push(QUICK_ACTION_INSTRUCTIONS[quickAction]);
  } else if (quickAction && trimmed) {
    parts.push(`${QUICK_ACTION_INSTRUCTIONS[quickAction]}\n\nAdditional user note: ${trimmed}`);
  } else if (trimmed) {
    parts.push(trimmed);
  } else if (hasScreenshots) {
    parts.push("Analyze the attached screenshot(s) and provide the most helpful response.");
  } else if (transcripts.length > 0) {
    parts.push("Respond to the most recent point or question in the transcript above.");
  } else {
    parts.push("How can you help me right now?");
  }

  return parts.join("\n\n");
}

export class AiOrchestrator {
  private readonly activeRequests = new Map<string, AbortController>();

  cancel(requestId?: string): void {
    if (requestId) {
      this.activeRequests.get(requestId)?.abort();
      this.activeRequests.delete(requestId);
      return;
    }
    for (const ctrl of this.activeRequests.values()) {
      ctrl.abort();
    }
    this.activeRequests.clear();
  }

  async stream(params: {
    request: AiStreamRequest;
    settings: AppSettings;
    prompts: CustomPrompt[];
    getApiKey: (provider: AiProvider) => string | null;
    emit: (event: AiStreamEvent) => void;
  }): Promise<void> {
    const { request, settings, prompts, getApiKey, emit } = params;
    const provider = request.overrideProvider ?? settings.provider;
    const model = request.overrideModel ?? settings.models[provider];
    const apiKey = getApiKey(provider);

    if (!apiKey) {
      emit({
        requestId: request.requestId,
        type: "error",
        error: `No API key saved for ${provider.toUpperCase()}. Open Settings to add your key.`,
      });
      return;
    }

    const controller = new AbortController();
    this.activeRequests.set(request.requestId, controller);

    const systemPrompt = buildSystemPrompt(settings, prompts);
    const messages: ProviderMessage[] = request.history.slice(-10).map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));

    const userText = buildUserTurnText(
      request.userPrompt,
      request.quickAction,
      request.transcripts,
      request.screenshots.length > 0,
    );

    messages.push({
      role: "user",
      text: userText,
      images: request.screenshots.map((s) => ({
        mimeType: s.mimeType,
        dataUrl: s.dataUrl,
      })),
    });

    const startedAt = Date.now();
    let ttftMs = 0;

    const onDelta = (delta: string) => {
      if (ttftMs === 0) ttftMs = Date.now() - startedAt;
      emit({ requestId: request.requestId, type: "delta", delta });
    };

    try {
      let fullText = "";
      if (provider === "openai") {
        fullText = await streamOpenAiCompletion({
          apiKey,
          model,
          systemPrompt,
          messages,
          signal: controller.signal,
          onDelta,
        });
      } else if (provider === "anthropic") {
        fullText = await streamAnthropicCompletion({
          apiKey,
          model,
          systemPrompt,
          messages,
          signal: controller.signal,
          onDelta,
        });
      } else {
        fullText = await streamGeminiCompletion({
          apiKey,
          model,
          systemPrompt,
          messages,
          signal: controller.signal,
          onDelta,
        });
      }

      if (!controller.signal.aborted) {
        emit({
          requestId: request.requestId,
          type: "done",
          text: fullText,
          ttftMs: ttftMs || Date.now() - startedAt,
          totalMs: Date.now() - startedAt,
          provider,
          model,
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      emit({
        requestId: request.requestId,
        type: "error",
        error: message,
      });
    } finally {
      this.activeRequests.delete(request.requestId);
    }
  }
}
