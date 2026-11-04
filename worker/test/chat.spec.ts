import { beforeEach, describe, expect, it } from "vitest";
import { resetFirebaseKeyCache } from "../src/auth";
import { MAX_BODY_BYTES, MAX_MESSAGE_CHARS, MAX_MESSAGES } from "../src/constants";
import { MAX_OUTPUT_TOKENS, TEXT_MODEL } from "../src/constants";
import { handleRequest } from "../src/index";
import { textToWorkersAiStream } from "../src/sse";

const PROJECT_ID = "demo-project";
const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const ORIGIN = "http://localhost:8080";
const aiCalls: { model: string; inputs: { messages?: unknown; stream?: boolean; max_tokens?: number } }[] = [];

type Limiter = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

beforeEach(() => {
  resetFirebaseKeyCache();
  aiCalls.length = 0;
});

describe("POST /chat", () => {
  it("sends a Firebase-authenticated chat to the model and streams chat SSE", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims());
    const { fetchImpl, jwksCalls } = mockFetch(signer.jwk);
    const runtime = env({
      AI: {
        run: async (model: string, inputs: { messages?: unknown; stream?: boolean; max_tokens?: number }) => {
          aiCalls.push({ model, inputs });
          return textToWorkersAiStream('data: {"response":"Hello"}\n\ndata: {"response":" world"}\n\ndata: [DONE]\n\n');
        },
      },
    });

    const response = await handleRequest(
      chatRequest(token, {
        message: "ignored when messages is present",
        messages: [
          { role: "system", content: "Be brief", extra: "drop-me" },
          { role: "user", content: "Hi" },
        ],
      }),
      runtime,
      { fetch: fetchImpl, now: () => NOW },
    );

    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(body).toContain(JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }));
    expect(body).toContain(JSON.stringify({ choices: [{ delta: { content: " world" } }] }));
    expect(body.trim().endsWith("data: [DONE]")).toBe(true);
    expect(aiCalls).toEqual([
      {
        model: TEXT_MODEL,
        inputs: {
          stream: true,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [
            { role: "system", content: "Be brief" },
            { role: "user", content: "Hi" },
          ],
        },
      },
    ]);
    expect(jwksCalls()).toBe(1);
  });

  it("accepts a single message string when messages is omitted", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims());
    const { fetchImpl } = mockFetch(signer.jwk);

    const response = await handleRequest(chatRequest(token, { message: "Just this" }), env(), {
      fetch: fetchImpl,
      now: () => NOW,
    });

    expect(response.status).toBe(200);
    expect(aiCalls[0]?.inputs.messages).toEqual([{ role: "user", content: "Just this" }]);
  });

  it("reuses cached Google signing keys", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims());
    const { fetchImpl, jwksCalls } = mockFetch(signer.jwk);
    const deps = { fetch: fetchImpl, now: () => NOW };

    expect((await handleRequest(chatRequest(token, { message: "One" }), env(), deps)).status).toBe(200);
    expect((await handleRequest(chatRequest(token, { message: "Two" }), env(), deps)).status).toBe(200);
    expect(jwksCalls()).toBe(1);
  });

  it("rejects missing, unsigned, and mistargeted tokens", async () => {
    const signer = await createSigner();
    const { fetchImpl } = mockFetch(signer.jwk);
    const deps = { fetch: fetchImpl, now: () => NOW };

    expect((await handleRequest(chatRequest(null, { message: "Hi" }), env(), deps)).status).toBe(401);

    const badSignature = await signJwt(signer.privateKey, claims());
    const tampered = `${badSignature.slice(0, -2)}aa`;
    expect((await handleRequest(chatRequest(tampered, { message: "Hi" }), env(), deps)).status).toBe(401);

    const wrongAud = await signJwt(signer.privateKey, claims({ aud: "other-project" }));
    expect((await handleRequest(chatRequest(wrongAud, { message: "Hi" }), env(), deps)).status).toBe(401);

    const wrongIss = await signJwt(
      signer.privateKey,
      claims({ iss: "https://securetoken.google.com/other-project" }),
    );
    expect((await handleRequest(chatRequest(wrongIss, { message: "Hi" }), env(), deps)).status).toBe(401);

    const expired = await signJwt(signer.privateKey, claims({ exp: Math.floor(NOW / 1000) - 120 }));
    expect((await handleRequest(chatRequest(expired, { message: "Hi" }), env(), deps)).status).toBe(401);

    const future = await signJwt(signer.privateKey, claims({ iat: Math.floor(NOW / 1000) + 120 }));
    expect((await handleRequest(chatRequest(future, { message: "Hi" }), env(), deps)).status).toBe(401);

    const emptySub = await signJwt(signer.privateKey, claims({ sub: "" }));
    expect((await handleRequest(chatRequest(emptySub, { message: "Hi" }), env(), deps)).status).toBe(401);

    const noneAlg = unsignedToken({ alg: "none", kid: "test-key" }, claims());
    expect((await handleRequest(chatRequest(noneAlg, { message: "Hi" }), env(), deps)).status).toBe(401);

    const unknownKid = await signJwt(signer.privateKey, claims(), "missing-kid");
    expect((await handleRequest(chatRequest(unknownKid, { message: "Hi" }), env(), deps)).status).toBe(401);

    expect(aiCalls).toHaveLength(0);
  });

  it("fails closed when Google signing keys cannot be fetched", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims());
    const { fetchImpl } = mockFetch(signer.jwk, { jwksStatus: 503 });
    const response = await handleRequest(chatRequest(token, { message: "Hi" }), env(), {
      fetch: fetchImpl,
      now: () => NOW,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rate limits per IP before doing any upstream work", async () => {
    const ipKeys: string[] = [];
    const userKeys: string[] = [];
    const { fetchImpl } = mockFetch(await jwkOnly());
    const response = await handleRequest(chatRequest("not-a-jwt", { message: "Hi" }, { ip: "203.0.113.10" }), env({
      IP_RATE_LIMITER: tracker(ipKeys, false),
      USER_RATE_LIMITER: tracker(userKeys, true),
    }), { fetch: fetchImpl, now: () => NOW });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(ipKeys).toEqual(["203.0.113.10"]);
    expect(userKeys).toEqual([]);
    expect(aiCalls).toHaveLength(0);
  });

  it("rate limits per user id after the token is verified", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims({ sub: "user-42" }));
    const userKeys: string[] = [];
    const { fetchImpl } = mockFetch(signer.jwk);
    const response = await handleRequest(chatRequest(token, { message: "Hi" }, { ip: "203.0.113.8" }), env({
      USER_RATE_LIMITER: tracker(userKeys, false),
    }), { fetch: fetchImpl, now: () => NOW });

    expect(response.status).toBe(429);
    expect(userKeys).toEqual(["user-42"]);
    expect(aiCalls).toHaveLength(0);
  });

  it("caps message count, message length, and body size", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims());
    const { fetchImpl } = mockFetch(signer.jwk);
    const deps = { fetch: fetchImpl, now: () => NOW };

    const tooMany = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: "user", content: "hi" }));
    expect((await handleRequest(chatRequest(token, { messages: tooMany }), env(), deps)).status).toBe(400);

    const tooLong = "a".repeat(MAX_MESSAGE_CHARS + 1);
    expect((await handleRequest(chatRequest(token, { message: tooLong }), env(), deps)).status).toBe(400);

    const atLimit = "b".repeat(MAX_MESSAGE_CHARS);
    expect((await handleRequest(chatRequest(token, { message: atLimit }), env(), deps)).status).toBe(200);

    expect((await handleRequest(chatRequest(token, { messages: [{ role: "system", content: "only" }] }), env(), deps)).status).toBe(400);
    expect((await handleRequest(chatRequest(token, { messages: [{ role: "tool", content: "nope" }] }), env(), deps)).status).toBe(400);
    expect((await handleRequest(chatRequest(token, { messages: "nope" }), env(), deps)).status).toBe(400);

    const invalid = new Request("https://astro-pulse-api.example/chat", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect((await handleRequest(invalid, env(), deps)).status).toBe(400);

    const huge = new Request("https://astro-pulse-api.example/chat", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });
    const hugeResponse = await handleRequest(huge, env(), deps);
    expect(hugeResponse.status).toBe(413);
    expect(await hugeResponse.json()).toEqual({ error: "invalid_request", message: "payload too large" });
    expect(aiCalls).toHaveLength(1);
  });

  it("allowlists CORS origins and rejects other routes and methods", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims());
    const { fetchImpl } = mockFetch(signer.jwk);
    const deps = { fetch: fetchImpl, now: () => NOW };

    const options = new Request("https://astro-pulse-api.example/chat", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    const preflight = await handleRequest(options, env(), deps);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");

    const blocked = await handleRequest(chatRequest(token, { message: "Hi" }, { origin: "https://evil.example" }), env(), deps);
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const get = new Request("https://astro-pulse-api.example/chat", { method: "GET", headers: { Origin: ORIGIN } });
    expect((await handleRequest(get, env(), deps)).status).toBe(405);

    const missing = new Request("https://astro-pulse-api.example/other", { method: "POST", headers: { Origin: ORIGIN } });
    expect((await handleRequest(missing, env(), deps)).status).toBe(404);

    const noOrigin = new Request("https://astro-pulse-api.example/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.4",
      },
      body: JSON.stringify({ message: "server side" }),
    });
    expect((await handleRequest(noOrigin, env(), deps)).status).toBe(200);
  });

  it("hides model failures and reports a missing Firebase project", async () => {
    const signer = await createSigner();
    const token = await signJwt(signer.privateKey, claims());
    const { fetchImpl } = mockFetch(signer.jwk);
    const failed = await handleRequest(
      chatRequest(token, { message: "Hi" }),
      env({
        AI: {
          run: async () => {
            throw new Error("secret upstream detail");
          },
        },
      }),
      { fetch: fetchImpl, now: () => NOW },
    );
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("secret upstream detail");

    const missingProject = await handleRequest(chatRequest(token, { message: "Hi" }), env({ FIREBASE_PROJECT_ID: "" }), {
      fetch: fetchImpl,
      now: () => NOW,
    });
    expect(missingProject.status).toBe(500);
    expect(aiCalls).toHaveLength(0);
  });
});

function env(overrides: Record<string, unknown> = {}) {
  return {
    FIREBASE_PROJECT_ID: PROJECT_ID,
    ALLOWED_ORIGINS: `${ORIGIN},http://127.0.0.1:8080`,
    USER_RATE_LIMITER: allowLimiter(),
    IP_RATE_LIMITER: allowLimiter(),
    AI: {
      run: async (model: string, inputs: { messages?: unknown; stream?: boolean; max_tokens?: number }) => {
        aiCalls.push({ model, inputs });
        return textToWorkersAiStream('data: {"response":"Hello"}\n\ndata: [DONE]\n\n');
      },
    },
    ...overrides,
  };
}

function allowLimiter(): Limiter {
  return { limit: async () => ({ success: true }) };
}

function tracker(keys: string[], success: boolean): Limiter {
  return {
    limit: async ({ key }) => {
      keys.push(key);
      return { success };
    },
  };
}

function chatRequest(
  token: string | null,
  body: unknown,
  options: { origin?: string; ip?: string } = {},
): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    "CF-Connecting-IP": options.ip ?? "203.0.113.10",
  });
  if (options.origin !== "") headers.set("Origin", options.origin ?? ORIGIN);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://astro-pulse-api.example/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function mockFetch(jwk: JsonWebKey, options: { jwksStatus?: number } = {}) {
  let jwks = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("googleapis.com")) throw new Error(`unexpected fetch ${url}`);
    jwks += 1;
    if (options.jwksStatus) return new Response("unavailable", { status: options.jwksStatus });
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  };
  return { fetchImpl, jwksCalls: () => jwks };
}

async function jwkOnly(): Promise<JsonWebKey> {
  return (await createSigner()).jwk;
}

function claims(overrides: Record<string, unknown> = {}) {
  const iat = Math.floor(NOW / 1000);
  return {
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: "user-1",
    iat,
    exp: iat + 3600,
    ...overrides,
  };
}

type SigningJwk = JsonWebKey & { kid: string; alg: string; use: string };

async function createSigner(): Promise<{ privateKey: CryptoKey; jwk: SigningJwk }> {
  const generated = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!isKeyPair(generated)) {
    throw new Error("expected an RSA key pair");
  }
  const exported = await crypto.subtle.exportKey("jwk", generated.publicKey);
  if (!isJwk(exported) || typeof exported.n !== "string" || typeof exported.e !== "string") {
    throw new Error("expected an RSA JWK");
  }
  const jwk: SigningJwk = { ...exported, kid: "test-key", alg: "RS256", use: "sig" };
  return { privateKey: generated.privateKey, jwk };
}

function isKeyPair(value: CryptoKey | CryptoKeyPair): value is CryptoKeyPair {
  return "privateKey" in value && "publicKey" in value;
}

function isJwk(value: JsonWebKey | ArrayBuffer): value is JsonWebKey {
  return !(value instanceof ArrayBuffer) && typeof value.kty === "string";
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>, kid = "test-key"): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = base64Url(JSON.stringify(payload));
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${base64Url(signature)}`;
}

function unsignedToken(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  return `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}.x`;
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
