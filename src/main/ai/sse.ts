export interface SseMessage {
  event?: string;
  data: string;
}

/**
 * Parses a Server-Sent Events (SSE) byte stream into complete event frames.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newlineIdx = buffer.indexOf("\n");

      while (newlineIdx !== -1) {
        const rawLine = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");

        if (rawLine === "") {
          if (dataLines.length > 0) {
            yield { event: currentEvent, data: dataLines.join("\n") };
            currentEvent = undefined;
            dataLines = [];
          }
          continue;
        }

        if (rawLine.startsWith(":")) continue;

        const colonIdx = rawLine.indexOf(":");
        const field = colonIdx === -1 ? rawLine : rawLine.slice(0, colonIdx);
        let valueStr = colonIdx === -1 ? "" : rawLine.slice(colonIdx + 1);
        if (valueStr.startsWith(" ")) valueStr = valueStr.slice(1);

        if (field === "event") {
          currentEvent = valueStr;
        } else if (field === "data") {
          dataLines.push(valueStr);
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      for (const rawLine of buffer.split(/\r?\n/)) {
        if (rawLine.startsWith("data:")) {
          dataLines.push(rawLine.slice(5).trimStart());
        } else if (rawLine.startsWith("event:")) {
          currentEvent = rawLine.slice(6).trimStart();
        }
      }
    }
    if (dataLines.length > 0) {
      yield { event: currentEvent, data: dataLines.join("\n") };
    }
  } finally {
    reader.releaseLock();
  }
}

export function stripDataUrlPrefix(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: "image/jpeg", base64: dataUrl };
}
