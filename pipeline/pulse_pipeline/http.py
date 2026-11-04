"""A small HTTP client: JSON or text, with retries on network errors, 429 and 5xx."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = os.environ.get("PULSE_USER_AGENT", "pulse-pipeline/0.1 (+https://pulse.lungilemooketsi.engineer)")


class MissingCredentials(RuntimeError):
    """A source can't run yet: its key or its setup is missing."""


class HttpError(RuntimeError):
    def __init__(self, url: str, status: int, body: str):
        super().__init__(f"{status} from {urllib.parse.urlsplit(url).netloc}: {body[:200]}")
        self.status = status


def request(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    data: bytes | None = None,
    attempts: int = 3,
    timeout: float = 30,
) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    merged = {"User-Agent": USER_AGENT, **(headers or {})}
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=merged), timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            if error.code not in (429, 500, 502, 503, 504) or attempt == attempts:
                raise HttpError(url, error.code, body) from None
            retry_after = error.headers.get("Retry-After")
            time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else 2 * attempt)
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts:
                raise
            time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def get_json(url: str, **kwargs) -> dict | list:
    return json.loads(request(url, **kwargs))
