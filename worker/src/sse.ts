const encoder = new TextEncoder();

/**
 * Normalises a model's SSE stream for the chat client, which reads
 * `choices[0].delta.content`, then `data: [DONE]`. Accepts chat-completion
 * chunks from the Meta Model API and a `response` text field. Anything else in a
 * chunk, such as reasoning text, is dropped, so only the answer reaches users.
 */
export function toChatSse(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let sentDone = false;

  return new ReadableStream({
    async start(controller) {
      const reader = source.getReader();
      const emit = (chunk: string) => {
        if (chunk.length === 0 || sentDone) return;
        controller.enqueue(encoder.encode(chatChunk(chunk)));
      };
      const finish = () => {
        if (sentDone) return;
        sentDone = true;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = consumeLines(buffer, emit, finish);
        }
        buffer += decoder.decode();
        if (buffer.length > 0) consumeLines(`${buffer}\n`, emit, finish);
        finish();
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export function textToWorkersAiStream(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function consumeLines(buffer: string, emit: (chunk: string) => void, finish: () => void): string {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(trimmed.startsWith("data: ") ? 6 : 5).trim();
    if (data === "[DONE]") {
      finish();
      continue;
    }
    emit(deltaFromEvent(data));
  }
  return rest;
}

function deltaFromEvent(data: string): string {
  try {
    const parsed = JSON.parse(data) as {
      response?: unknown;
      choices?: { delta?: { content?: unknown } }[];
    };
    if (typeof parsed.response === "string") return parsed.response;
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

function chatChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}
