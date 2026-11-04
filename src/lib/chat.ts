import { apiUrl } from "./firebase";
import { SYSTEM_PROMPT } from "./prompt";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const MAX_HISTORY_MESSAGES = 30;

export async function sendChatMessage(
  message: string,
  conversationHistory: ChatMessage[] = [],
  idToken: string,
  // Data for this question only, such as the sentiment snapshot; sent as a system message, never stored.
  context: string | null = null,
): Promise<Response> {
  if (!apiUrl) {
    throw new Error("VITE_API_URL is not configured");
  }
  if (!idToken) {
    throw new Error("Not signed in");
  }

  const recentHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  const response = await fetch(`${apiUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      message,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...recentHistory,
        ...(context ? [{ role: "system", content: context }] : []),
        { role: "user", content: message },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send message: ${errorText}`);
  }

  return response;
}

export async function* streamChatResponse(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const chunk = parseSseLine(line);
        if (chunk === null) return;
        if (chunk) yield chunk;
      }
    }

    const trailing = parseSseLine(buffer);
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function parseSseLine(line: string): string | null | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return undefined;

  const data = trimmed.slice(6);
  if (data === "[DONE]") return null;

  try {
    const parsed = JSON.parse(data);
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : undefined;
  } catch (error) {
    console.warn("Failed to parse SSE data:", error);
    return undefined;
  }
}
