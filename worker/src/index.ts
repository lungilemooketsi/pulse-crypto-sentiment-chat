import { AuthError, verifyFirebaseIdToken } from "./auth";
import { MAX_BODY_BYTES, MAX_OUTPUT_TOKENS, MAX_TOKEN_CHARS, MODEL_API_URL, REASONING_EFFORT, TEXT_MODEL } from "./constants";
import { toChatSse } from "./sse";
import { PayloadTooLargeError, RequestError, type ChatMessage, messagesFromBody } from "./validate";

export type HandlerDeps = {
  fetch?: typeof fetch;
  now?: () => number;
};

// The model behind /chat. Production calls the Meta Model API; tests pass their own.
type ModelClient = {
  run(
    model: typeof TEXT_MODEL,
    inputs: { messages: ChatMessage[]; stream: true; max_tokens: number },
  ): Promise<ReadableStream<Uint8Array> | { response?: string }>;
};

type WorkerEnv = Env & { MODEL_API_KEY?: string };

type AppEnv = {
  AI: ModelClient;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  USER_RATE_LIMITER: RateLimit;
  IP_RATE_LIMITER: RateLimit;
};

const encoder = new TextEncoder();

export default {
  async fetch(request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, {
      AI: {
        run: (model, inputs) => runMetaModel(env.MODEL_API_KEY, model, inputs),
      },
      FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
      ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
      USER_RATE_LIMITER: env.USER_RATE_LIMITER,
      IP_RATE_LIMITER: env.IP_RATE_LIMITER,
    });
  },
} satisfies ExportedHandler<WorkerEnv>;

/** Streams a chat completion from the Meta Model API; its SSE chunks already use choices[0].delta.content. */
async function runMetaModel(
  apiKey: string | undefined,
  model: typeof TEXT_MODEL,
  inputs: { messages: ChatMessage[]; stream: true; max_tokens: number },
): Promise<ReadableStream<Uint8Array>> {
  if (!apiKey) throw new Error("MODEL_API_KEY is not set");
  const response = await fetch(MODEL_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: inputs.messages,
      stream: inputs.stream,
      max_completion_tokens: inputs.max_tokens,
      reasoning_effort: REASONING_EFFORT,
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Meta Model API returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.body;
}

export async function handleRequest(
  request: Request,
  env: AppEnv,
  deps: HandlerDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const cors = corsHeaders(origin, allowedOrigins);

  if (url.pathname !== "/chat") {
    return json({ error: "not_found" }, 404, cors);
  }

  if (origin && !allowedOrigins.has(origin)) {
    return json({ error: "origin_not_allowed" }, 403, cors);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, cors);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "missing";
  const ipLimit = await limit(env.IP_RATE_LIMITER, ip);
  if (!ipLimit.success) {
    log({ message: "rate_limited", scope: "ip", status: 429 });
    return json({ error: "rate_limited" }, 429, cors);
  }

  const token = bearerToken(request);
  if (!token) {
    return json({ error: "unauthorized" }, 401, cors);
  }

  if (!env.FIREBASE_PROJECT_ID) {
    log({ message: "misconfigured", missing: "FIREBASE_PROJECT_ID", status: 500 });
    return json({ error: "server_misconfigured" }, 500, cors);
  }

  let uid: string;
  try {
    const verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID, fetchImpl, now());
    uid = verified.uid;
  } catch (error) {
    const reason = error instanceof AuthError ? error.message : "Unauthorized";
    log({ message: "auth_failed", reason, status: 401 });
    return json({ error: "unauthorized" }, 401, cors);
  }

  const userLimit = await limit(env.USER_RATE_LIMITER, uid);
  if (!userLimit.success) {
    log({ message: "rate_limited", scope: "user", uid, status: 429 });
    return json({ error: "rate_limited" }, 429, cors);
  }

  let messages;
  try {
    const raw = await readBody(request);
    messages = messagesFromBody(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return json({ error: "invalid_request", message: error.message }, 413, cors);
    }
    const reason = error instanceof RequestError || error instanceof SyntaxError ? error.message : "Invalid request";
    return json({ error: "invalid_request", message: reason }, 400, cors);
  }

  let output: ReadableStream<Uint8Array> | { response?: string };
  try {
    output = await env.AI.run(TEXT_MODEL, {
      messages,
      stream: true,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
  } catch (error) {
    log({
      message: "model_failed",
      uid,
      status: 502,
      reason: error instanceof Error ? error.message : "inference failed",
    });
    return json({ error: "upstream_failed" }, 502, cors);
  }

  const source = output instanceof ReadableStream ? output : textEventStream(output.response ?? "");
  const headers = new Headers(cors);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  log({ message: "chat_stream", uid, model: TEXT_MODEL, status: 200 });
  return new Response(toChatSse(source), { status: 200, headers });
}

function textEventStream(response: string): ReadableStream<Uint8Array> {
  const body = `data: ${JSON.stringify({ response })}\n\ndata: [DONE]\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

function corsHeaders(origin: string | null, allowed: Set<string>): Headers {
  const headers = new Headers();
  headers.set("Vary", "Origin");
  if (origin && allowed.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const token = match[1];
  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) return null;
  return token;
}

async function readBody(request: Request): Promise<string> {
  const declared = request.headers.get("Content-Length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  return text;
}

async function limit(limiter: RateLimit, key: string): Promise<RateLimitOutcome> {
  return limiter.limit({ key });
}

function json(body: unknown, status: number, extra: Headers): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function log(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ source: "astro-pulse-api", ...event }));
}
