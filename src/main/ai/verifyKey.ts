import type { AiProvider, ApiKeyTestResult } from "@shared/types";

export async function verifyProviderApiKey(params: {
  provider: AiProvider;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<ApiKeyTestResult> {
  const { provider, fetchImpl = fetch } = params;
  const apiKey = params.apiKey.trim();
  const started = Date.now();

  if (!apiKey) {
    return {
      valid: false,
      provider,
      latencyMs: 0,
      error: "API key is empty.",
    };
  }

  try {
    let response: Response;
    if (provider === "openai") {
      response = await fetchImpl("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } else if (provider === "anthropic") {
      response = await fetchImpl("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
    } else {
      response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models", {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
      });
    }

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errJson = (await response.json()) as {
          error?: { message?: string };
          message?: string;
        };
        detail = errJson.error?.message || errJson.message || detail;
      } catch {
        // fallback to statusText
      }
      return {
        valid: false,
        provider,
        latencyMs,
        error: `HTTP ${response.status}: ${detail}`,
      };
    }

    let modelCount: number | undefined;
    try {
      const json = (await response.json()) as {
        data?: unknown[];
        models?: unknown[];
      };
      if (Array.isArray(json.data)) modelCount = json.data.length;
      else if (Array.isArray(json.models)) modelCount = json.models.length;
    } catch {
      // optional count
    }

    return {
      valid: true,
      provider,
      latencyMs,
      modelCount,
    };
  } catch (err) {
    return {
      valid: false,
      provider,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
