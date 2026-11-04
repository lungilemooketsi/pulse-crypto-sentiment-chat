"""The dated dataset format (subtask 2.1).

Every collector writes JSON Lines to ``<out>/<source>/<YYYY-MM-DD>.jsonl``, one file per source per UTC day of
collection. Each record carries where it came from (``url`` or ``tx_hash``), when it was created and collected,
and the coins it mentions, so later phases can rebuild any split from the raw files alone.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def to_iso(value: float | int | str) -> str:
    """Unix seconds or an ISO string, as a UTC ISO string."""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).replace(microsecond=0).isoformat()
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def hash_author(handle: str | None) -> str | None:
    """Authors are stored hashed: enough to filter bots and repeat posters, without keeping handles."""
    if not handle:
        return None
    return hashlib.sha256(handle.lower().encode()).hexdigest()[:16]


@dataclass
class Post:
    source: str  # bluesky | rss | finnhub
    id: str
    url: str
    created_at: str
    text: str
    coins: list[str]
    author: str | None = None
    collected_at: str = field(default_factory=now_iso)
    meta: dict = field(default_factory=dict)
    kind: str = "post"


@dataclass
class Transfer:
    source: str  # etherscan | esplora | arkham
    chain: str  # bitcoin | ethereum | solana
    tx_hash: str
    url: str
    created_at: str
    wallet: str
    wallet_label: str
    wallet_kind: str  # exchange | whale | fund | other
    direction: str  # in | out
    asset: str
    amount: float
    counterparty: str | None = None
    usd: float | None = None
    collected_at: str = field(default_factory=now_iso)
    kind: str = "transfer"

    @property
    def id(self) -> str:
        return f"{self.tx_hash}:{self.wallet}:{self.asset}:{self.direction}"


Record = Post | Transfer


def write_records(out_dir: Path, source: str, records: list[Record], day: str | None = None) -> int:
    """Appends records to today's file for ``source``, skipping any id already in it. Returns how many were new."""
    day = day or datetime.now(timezone.utc).date().isoformat()
    path = out_dir / source / f"{day}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    if path.exists():
        with path.open(encoding="utf-8") as existing:
            for line in existing:
                if line.strip():
                    seen.add(record_id(json.loads(line)))

    written = 0
    with path.open("a", encoding="utf-8") as out:
        for record in records:
            data = asdict(record)
            key = record_id(data)
            if key in seen:
                continue
            seen.add(key)
            out.write(json.dumps(data, ensure_ascii=False, sort_keys=True) + "\n")
            written += 1
    return written


def record_id(data: dict) -> str:
    if data.get("kind") == "transfer":
        return f"{data['tx_hash']}:{data['wallet']}:{data['asset']}:{data['direction']}"
    return f"{data['source']}:{data['id']}"
