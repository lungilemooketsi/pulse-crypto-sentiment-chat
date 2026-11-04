"""The 24-hour sentiment snapshot the app shows and the chat cites.

    python -m pulse_pipeline.snapshot --raw ../data/raw --labels ../data/labels --out ../data/snapshot

Pulse's own model (score.py) labels Bluesky posts and crypto headlines. Muse Spark labels everything else, such as
stock news, plus a small sample of the model's posts each run, which gives a live check of how often the two agree.
No human has checked either, and sentiment.json says so. If the model didn't run, Muse Spark labels what it can.
Needs MODEL_API_KEY (Meta Model API) to label; without it, it summarises whatever is already labelled.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import http, llm
from .coins import COINS, STOCKS
from .dataset import SENTIMENT, append_jsonl, load_labels, load_posts, load_transfers, post_key
from .label import BATCH, MODEL, _run_model, draft_prompt, parse_draft
from .records import now_iso
from .score import MODEL_NAME

CHECK_SAMPLE = 40  # the model's posts Muse Spark also labels each run
MIN_POSTS = 5  # a coin needs this many on-topic posts before its mood is shown
NAMES = {coin["symbol"]: coin["name"] for coin in COINS} | STOCKS
FEAR_GREED = "https://api.alternative.me/fng/"
SAME_AS = {"WETH": "ETH", "WBTC": "BTC", "CBBTC": "BTC", "WSOL": "SOL"}  # wrapped forms count as the coin
MOST_MOVES = 40


def large_moves(transfers: list[dict], since: str) -> list[dict]:
    """The biggest recent moves onto and off exchanges, for the coins Pulse tracks."""
    moves = []
    for row in transfers:
        asset = SAME_AS.get(row["asset"], row["asset"])
        if row["created_at"] >= since and asset in NAMES and row.get("usd"):
            moves.append({"asset": asset, "usd": row["usd"], "amount": row["amount"], "exchange": row["wallet_label"], "direction": row["direction"], "counterparty": row.get("counterparty"), "at": row["created_at"], "url": row["url"]})
    return sorted(moves, key=lambda move: -move["usd"])[:MOST_MOVES]


def parse_fear_greed(reply: dict) -> dict:
    latest = reply["data"][0]
    return {"value": int(latest["value"]), "label": latest["value_classification"], "at": datetime.fromtimestamp(int(latest["timestamp"]), timezone.utc).date().isoformat()}


def fear_greed() -> dict | None:
    """Alternative.me's market-wide index. Their terms ask for a credit beside it wherever it is shown."""
    try:
        return parse_fear_greed(http.get_json(FEAR_GREED, params={"limit": 1}))
    except Exception as error:  # the mood stands without it
        print(f"Fear & Greed skipped: {str(error)[:120]}")
        return None


def muse_todo(posts: list[dict], muse: set[str], model: set[str], max_new: int, check: int = CHECK_SAMPLE) -> list[dict]:
    """Posts for Muse Spark: those the model can't label, then a sample of those it did, newest first."""
    newest = sorted((p for p in posts if post_key(p) not in muse), key=lambda p: p["created_at"], reverse=True)
    needed = [p for p in newest if post_key(p) not in model]
    sample = [p for p in newest if post_key(p) in model][:check]
    return (needed + sample)[:max_new]


def agreement(posts: list[dict], muse: dict[str, str], model: dict[str, str]) -> dict:
    """How often the model and Muse Spark gave a post in this window the same label."""
    pairs = [(muse[key], model[key]) for key in map(post_key, posts) if key in muse and key in model]
    return {"name": MODEL_NAME, "checked": len(pairs), "agreement": round(sum(a == b for a, b in pairs) / len(pairs), 3) if pairs else None}


def label_window(posts: list[dict], labels_dir: Path, max_new: int) -> int:
    if not llm.available():
        print("No MODEL_API_KEY: summarising existing labels only.")
        return 0
    muse = load_labels(labels_dir / "draft.jsonl") | load_labels(labels_dir / "hand.jsonl")
    todo = muse_todo(posts, set(muse), set(load_labels(labels_dir / "model.jsonl")), max_new)
    saved = 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start : start + BATCH]
        try:
            labels = parse_draft(_run_model(draft_prompt(batch)), len(batch))
        except Exception as error:  # one failed batch shouldn't lose the rest
            print(f"  batch {start // BATCH + 1} failed: {error}")
            continue
        rows = [{"key": post_key(p), "label": y, "by": MODEL, "at": now_iso()} for p, y in zip(batch, labels) if y]
        append_jsonl(labels_dir / "draft.jsonl", rows)
        saved += len(rows)
        time.sleep(0.3)
    return saved


def summarise(posts: list[dict], labels: dict[str, str], since: datetime, until: datetime, own_model: bool = False) -> dict:
    coins: dict[str, dict] = {}
    for post in posts:
        label = labels.get(post_key(post))
        if not label:
            continue
        for symbol in post["coins"]:
            entry = coins.setdefault(symbol, {"positive": 0, "neutral": 0, "negative": 0, "off_topic": 0, "sources": {}, "headlines": []})
            entry[label] += 1
            if label == "off_topic":
                continue
            entry["sources"][post["source"]] = entry["sources"].get(post["source"], 0) + 1
            if post["source"] in ("rss", "finnhub"):
                entry["headlines"].append(
                    {"title": post.get("meta", {}).get("headline") or post["text"][:140], "url": post["url"], "feed": post.get("meta", {}).get("feed"), "label": label, "created_at": post["created_at"]}
                )

    result = {}
    for symbol, entry in coins.items():
        on_topic = sum(entry[name] for name in SENTIMENT)
        if on_topic < MIN_POSTS:
            continue
        score = (entry["positive"] - entry["negative"]) / on_topic
        result[symbol] = {
            "name": NAMES.get(symbol, symbol),
            "kind": "stock" if symbol in STOCKS else "crypto",
            "posts": on_topic,
            "off_topic": entry["off_topic"],
            "share": {name: round(entry[name] / on_topic, 3) for name in SENTIMENT},
            # -1 (all negative) to +1 (all positive).
            "score": round(score, 3),
            "mood": "positive" if score >= 0.2 else "negative" if score <= -0.2 else "mixed",
            "sources": entry["sources"],
            "headlines": sorted(entry["headlines"], key=lambda h: h["created_at"], reverse=True)[:3],
        }
    return {
        "generated_at": now_iso(),
        "window": {"from": since.replace(microsecond=0).isoformat(), "to": until.replace(microsecond=0).isoformat()},
        "method": {
            "labeller": "Pulse's own model, fine-tuned from FinBERT on Muse Spark's labels, and Muse Spark for stock news" if own_model else f"Muse Spark ({MODEL}), Meta's model",
            "labels": "AI-generated following pipeline/LABELLING.md; not yet checked by a human",
            "sources": "Bluesky posts and crypto news headlines naming the coin, and Finnhub company news for stocks",
            "min_posts": MIN_POSTS,
        },
        "coins": dict(sorted(result.items(), key=lambda item: -item[1]["posts"])),
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--raw", type=Path, default=Path("../data/raw"))
    parser.add_argument("--labels", type=Path, default=Path("../data/labels"))
    parser.add_argument("--out", type=Path, default=Path("../data/snapshot"))
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--max-new", type=int, default=300)
    args = parser.parse_args(argv)

    until = datetime.now(timezone.utc)
    since = until - timedelta(hours=args.hours)
    window = [p for p in load_posts(args.raw).values() if since.isoformat() <= p["created_at"] <= until.isoformat()]
    new = label_window(window, args.labels, args.max_new)
    muse = load_labels(args.labels / "draft.jsonl") | load_labels(args.labels / "hand.jsonl")
    model = load_labels(args.labels / "model.jsonl")
    labels = muse | model
    own_model = any(post_key(p) in model for p in window)
    snapshot = summarise(window, labels, since, until, own_model)
    snapshot["model"] = agreement(window, muse, model)
    snapshot["fear_greed"] = fear_greed()
    snapshot["large_moves"] = large_moves(load_transfers(args.raw, "arkham"), since.isoformat())
    snapshot["coverage"] = {"posts_in_window": len(window), "labelled": sum(1 for p in window if post_key(p) in labels), "labelled_this_run": new}

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "sentiment.json").write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # One line per run per coin, kept for the price test (PRICE_TEST.md).
    append_jsonl(args.out / "history.jsonl", [{"at": snapshot["generated_at"], "coin": s, "score": c["score"], "posts": c["posts"]} for s, c in snapshot["coins"].items()])
    cov = snapshot["coverage"]
    print(f"{len(snapshot['coins'])} coins with a mood; {cov['labelled']} of {cov['posts_in_window']} posts labelled ({new} this run).")
    for symbol, coin in snapshot["coins"].items():
        print(f"  {symbol:5} {coin['mood']:8} score {coin['score']:+.2f} from {coin['posts']} posts")


if __name__ == "__main__":
    main()
