import { MAX_MESSAGE_CHARS, MAX_MESSAGES } from "./constants";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

const ROLES = new Set<ChatRole>(["system", "user", "assistant"]);

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

export class PayloadTooLargeError extends RequestError {
  constructor() {
    super("payload too large");
    this.name = "PayloadTooLargeError";
  }
}

export function messagesFromBody(body: unknown): ChatMessage[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("Expected a JSON object");
  }

  const record = body as { message?: unknown; messages?: unknown };
  let source: unknown[];

  if (record.messages !== undefined) {
    if (!Array.isArray(record.messages)) {
      throw new RequestError("messages must be an array");
    }
    source = record.messages;
  } else if (typeof record.message === "string") {
    source = [{ role: "user", content: record.message }];
  } else {
    throw new RequestError("message or messages is required");
  }

  if (source.length === 0 || source.length > MAX_MESSAGES) {
    throw new RequestError(`messages must contain 1 to ${MAX_MESSAGES} items`);
  }

  const messages = source.map((item) => parseMessage(item));
  if (!messages.some((message) => message.role === "user")) {
    throw new RequestError("at least one user message is required");
  }
  return messages;
}

function parseMessage(item: unknown): ChatMessage {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new RequestError("each message must be an object");
  }
  const record = item as { role?: unknown; content?: unknown };
  if (typeof record.role !== "string" || !ROLES.has(record.role as ChatRole)) {
    throw new RequestError("message role must be system, user, or assistant");
  }
  if (typeof record.content !== "string") {
    throw new RequestError("message content must be a string");
  }
  if (record.content.trim().length === 0) {
    throw new RequestError("message content is empty");
  }
  if (record.content.length > MAX_MESSAGE_CHARS) {
    throw new RequestError(`message content exceeds ${MAX_MESSAGE_CHARS} characters`);
  }
  return { role: record.role as ChatRole, content: record.content };
}
