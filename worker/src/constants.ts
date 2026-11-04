export const MAX_BODY_BYTES = 100_000;
export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_TOKEN_CHARS = 8_192;

// Meta's Muse Spark through the Meta Model API chat completions endpoint.
export const TEXT_MODEL = "muse-spark-1.3";
export const MODEL_API_URL = "https://api.meta.ai/v1/chat/completions";
// Muse Spark always reasons, and reasoning counts against this limit, so it leaves room beyond the reply itself.
export const MAX_OUTPUT_TOKENS = 4096;
export const REASONING_EFFORT = "low";

export const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export const CLOCK_SKEW_SECONDS = 60;
