"""Calls Meta's Muse Spark through the Meta Model API chat completions endpoint.

Needs MODEL_API_KEY. PULSE_MODEL picks the model (default muse-spark-1.3). Contributor-mode models are cheaper
but let Meta train on what is sent, so they are only used if PULSE_MODEL names one.
"""

from __future__ import annotations

import json
import os

from . import http

API = "https://api.meta.ai/v1/chat/completions"
MODEL = os.environ.get("PULSE_MODEL", "muse-spark-1.3")


def available() -> bool:
    return bool(os.environ.get("MODEL_API_KEY"))


def complete(messages: list[dict], max_tokens: int = 2000, effort: str = "low") -> str:
    """The reply text. Muse Spark always reasons; ``effort`` keeps that short for simple tasks like labelling."""
    key = os.environ.get("MODEL_API_KEY")
    if not key:
        raise http.MissingCredentials("Set MODEL_API_KEY (a Meta Model API key).")
    reply = http.get_json(
        API,
        data=json.dumps({"model": MODEL, "messages": messages, "max_completion_tokens": max_tokens, "reasoning_effort": effort}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        timeout=120,
    )
    content = reply["choices"][0]["message"].get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError(f"Meta Model API returned no text (finish_reason {reply['choices'][0].get('finish_reason')}).")
    return content
