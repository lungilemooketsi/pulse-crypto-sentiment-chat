"""Labels recent posts with Pulse's own sentiment model, fine-tuned from FinBERT on Muse Spark's labels (4.5).

    python -m pulse_pipeline.score --weights <folder> --raw ../data/raw --labels ../data/labels

Needs torch and transformers. It scores only the sources the model was trained on: stock news wasn't in its training
data, so Muse Spark keeps labelling that until the model is retrained. Results go to model.jsonl.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .dataset import LABELS, append_jsonl, load_labels, load_posts, post_key
from .records import now_iso

MODEL_NAME = "pulse-finbert-v1"
TRAINED_SOURCES = ("bluesky", "rss")
BATCH = 32
LENGTH = 96  # the length it was trained with


def to_score(posts: dict[str, dict], done: set[str], since: str) -> list[dict]:
    """Posts from the trained sources in the window that have no model label yet."""
    return [post for key, post in posts.items() if key not in done and post["source"] in TRAINED_SOURCES and post["created_at"] >= since]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--raw", type=Path, default=Path("../data/raw"))
    parser.add_argument("--labels", type=Path, default=Path("../data/labels"))
    parser.add_argument("--hours", type=int, default=24)
    args = parser.parse_args(argv)

    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    path = args.labels / "model.jsonl"
    since = (datetime.now(timezone.utc) - timedelta(hours=args.hours)).isoformat()
    todo = to_score(load_posts(args.raw), set(load_labels(path)), since)
    tokenizer = AutoTokenizer.from_pretrained(args.weights)
    model = AutoModelForSequenceClassification.from_pretrained(args.weights).eval()

    with torch.no_grad():
        for start in range(0, len(todo), BATCH):
            batch = todo[start : start + BATCH]
            encoded = tokenizer([post["text"] for post in batch], truncation=True, max_length=LENGTH, padding=True, return_tensors="pt")
            picks = model(**encoded).logits.argmax(dim=1).tolist()
            append_jsonl(path, [{"key": post_key(post), "label": LABELS[pick], "by": MODEL_NAME, "at": now_iso()} for post, pick in zip(batch, picks)])
    print(f"{len(todo)} posts labelled by {MODEL_NAME}.")


if __name__ == "__main__":
    main()
