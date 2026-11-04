import { CLOCK_SKEW_SECONDS, FIREBASE_JWKS_URL } from "./constants";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type CachedKeys = {
  expiresAt: number;
  keys: Map<string, CryptoKey>;
};

let cachedKeys: CachedKeys | null = null;

export function resetFirebaseKeyCache(): void {
  cachedKeys = null;
}

type JwtHeader = {
  alg?: string;
  kid?: string;
};

type JwtPayload = {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
};

type JwkWithKid = JsonWebKey & { kid?: string };

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<{ uid: string }> {
  if (!projectId) {
    throw new AuthError("Firebase project is not configured");
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new AuthError("Malformed token");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson<JwtHeader>(encodedHeader);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
    throw new AuthError("Unsupported token");
  }

  const key = await getKey(header.kid, fetchImpl, nowMs);
  if (!key) {
    throw new AuthError("Unknown signing key");
  }

  const signedBytes = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64UrlToBytes(encodedSignature);
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signature,
    signedBytes,
  );
  if (!valid) {
    throw new AuthError("Invalid signature");
  }

  const payload = decodeJson<JwtPayload>(encodedPayload);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (payload.aud !== projectId) {
    throw new AuthError("Invalid audience");
  }
  if (payload.iss !== expectedIssuer) {
    throw new AuthError("Invalid issuer");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128) {
    throw new AuthError("Invalid subject");
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new AuthError("Token expired");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new AuthError("Token issued in the future");
  }

  return { uid: payload.sub };
}

async function getKey(kid: string, fetchImpl: typeof fetch, nowMs: number): Promise<CryptoKey | null> {
  const fresh = await loadKeys(fetchImpl, nowMs, false);
  const cached = fresh.get(kid);
  if (cached) return cached;
  const refreshed = await loadKeys(fetchImpl, nowMs, true);
  return refreshed.get(kid) ?? null;
}

async function loadKeys(
  fetchImpl: typeof fetch,
  nowMs: number,
  force: boolean,
): Promise<Map<string, CryptoKey>> {
  if (!force && cachedKeys && cachedKeys.expiresAt > nowMs) {
    return cachedKeys.keys;
  }

  const response = await fetchImpl(FIREBASE_JWKS_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new AuthError("Signing keys unavailable");
  }

  const body = (await response.json()) as { keys?: JwkWithKid[] };
  if (!body || !Array.isArray(body.keys)) {
    throw new AuthError("Signing keys unavailable");
  }

  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keys.set(jwk.kid, cryptoKey);
  }

  const maxAge = cacheMaxAgeMs(response.headers.get("cache-control"));
  cachedKeys = { keys, expiresAt: nowMs + maxAge };
  return keys;
}

function cacheMaxAgeMs(cacheControl: string | null): number {
  const match = /max-age=(\d+)/i.exec(cacheControl ?? "");
  const fallback = 60 * 60;
  if (!match) return fallback * 1000;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback * 1000;
  return Math.min(seconds, 6 * 60 * 60) * 1000;
}

function decodeJson<T>(segment: string): T {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(segment));
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as T;
  } catch {
    throw new AuthError("Malformed token");
  }
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
