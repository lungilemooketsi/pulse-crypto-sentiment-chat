"""Loading collected posts and labels, and the time-ordered split (subtask 3.5)."""

from __future__ import annotations

import json
import re
from pathlib import Path

LABELS = ["positive", "neutral", "negative", "off_topic"]
SENTIMENT = ["positive", "neutral", "negative"]


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as lines:
        return [json.loads(line) for line in lines if line.strip()]


def append_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as out:
        for row in rows:
            out.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def post_key(post: dict) -> str:
    return f"{post['source']}:{post['id']}"


def load_posts(raw: Path, sources: tuple[str, ...] = ("bluesky", "rss", "finnhub")) -> dict[str, dict]:
    """Every collected post, once, keyed by source and id. The same post seen on two days is kept once."""
    posts: dict[str, dict] = {}
    for source in sources:
        for path in sorted((raw / source).glob("*.jsonl")):
            for post in read_jsonl(path):
                lang = post.get("meta", {}).get("lang")
                if lang and lang != "en":
                    continue
                posts.setdefault(post_key(post), post)
    return posts


def load_transfers(raw: Path, source: str) -> list[dict]:
    """Every collected transfer from one source, once each, whatever day it was saved."""
    transfers: dict[tuple, dict] = {}
    for path in sorted((raw / source).glob("*.jsonl")):
        for row in read_jsonl(path):
            transfers.setdefault((row["tx_hash"], row["wallet"], row["asset"], row["direction"]), row)
    return list(transfers.values())


def load_labels(path: Path) -> dict[str, str]:
    """Key -> label; a later line for the same post wins, so a relabel is a new line."""
    return {row["key"]: row["label"] for row in read_jsonl(path) if row.get("label") in LABELS}


def normalise(text: str) -> str:
    """Text with links, case and punctuation removed, so reposts of one message compare as equal."""
    return " ".join(re.findall(r"\w+", re.sub(r"https?://\S+", " ", text.lower())))


def split_by_time(posts: dict[str, dict], labels: dict[str, str], test_share: float = 0.3, valid_share: float = 0.15) -> dict:
    """Train, validation and test sets ordered in time, so nothing from the future reaches training.

    Repeated text is kept once, at its earliest date. Without this, repost bots put the same message on both sides
    of the split and inflate the scores.
    """
    seen: set[str] = set()
    rows: list[tuple[dict, str]] = []
    for post in sorted((posts[key] for key in labels if key in posts), key=lambda p: (p["created_at"], post_key(p))):
        text = normalise(post["text"])
        if text and text not in seen:
            seen.add(text)
            rows.append((post, labels[post_key(post)]))
    if len(rows) < 20:
        raise ValueError(f"Need at least 20 distinct labelled posts, have {len(rows)}.")
    test_at = int(len(rows) * (1 - test_share))
    valid_at = int(test_at * (1 - valid_share))
    return {"train": rows[:valid_at], "valid": rows[valid_at:test_at], "test": rows[test_at:], "cutoff": rows[test_at][0]["created_at"]}
