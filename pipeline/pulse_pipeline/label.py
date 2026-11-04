"""Labelling: by hand (3.2), drafted by an LLM (3.3), and the hand audit of the drafts (3.4).

    python -m pulse_pipeline.label hand  --raw ../data/raw --labels ../data/labels --count 300
    python -m pulse_pipeline.label draft --raw ../data/raw --labels ../data/labels --count 3000
    python -m pulse_pipeline.label audit --raw ../data/raw --labels ../data/labels --share 0.1
    python -m pulse_pipeline.label report --labels ../data/labels

Hand labels go to hand.jsonl, drafts to draft.jsonl, audit labels to audit.jsonl. Hand and audit sessions can
be stopped with q and resumed: posts already labelled are skipped. Drafting needs MODEL_API_KEY (Meta Model API).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import textwrap
import time
from pathlib import Path

from . import llm
from .dataset import LABELS, append_jsonl, load_labels, load_posts, post_key
from .records import now_iso

MODEL = llm.MODEL
RULES = (Path(__file__).resolve().parents[1] / "LABELLING.md").read_text(encoding="utf-8")
KEYS = {"p": "positive", "n": "neutral", "x": "negative", "o": "off_topic"}
BATCH = 20


def _sample(posts: dict[str, dict], exclude: set[str], count: int, seed: int) -> list[dict]:
    """A reproducible random sample, spread over sources and days rather than the newest posts only."""
    pool = sorted((p for k, p in posts.items() if k not in exclude), key=post_key)
    random.Random(seed).shuffle(pool)
    return pool[:count]


def _ask(post: dict, done: int, total: int) -> str | None:
    print(f"\n[{done + 1}/{total}] {post['source']} · {post['created_at'][:10]} · coins: {', '.join(post['coins'])}")
    print(textwrap.fill(post["text"][:800], 100, initial_indent="  ", subsequent_indent="  "))
    while True:
        answer = input("  label: p positive · n neutral · x negative · o off-topic · s skip · q quit > ").strip().lower()
        if answer == "q":
            return None
        if answer == "s":
            return ""
        if answer in KEYS:
            return KEYS[answer]


def _label_by_hand(posts: list[dict], out: Path, already: int, total: int, labeller: str) -> int:
    done = already
    for post in posts:
        label = _ask(post, done, total)
        if label is None:
            break
        if label:
            append_jsonl(out, [{"key": post_key(post), "label": label, "by": labeller, "at": now_iso()}])
            done += 1
    return done


def hand(args) -> None:
    posts = load_posts(args.raw)
    path = args.labels / "hand.jsonl"
    labelled = load_labels(path)
    remaining = max(0, args.count - len(labelled))
    if not remaining:
        print(f"{len(labelled)} hand labels already; target {args.count} reached.")
        return
    print(open_rules_hint())
    done = _label_by_hand(_sample(posts, set(labelled), remaining, args.seed), path, len(labelled), args.count, args.by)
    print(f"\n{done} of {args.count} hand labels saved to {path}.")


def audit(args) -> None:
    posts = load_posts(args.raw)
    drafts = load_labels(args.labels / "draft.jsonl")
    path = args.labels / "audit.jsonl"
    audited = load_labels(path)
    target = max(1, round(len(drafts) * args.share))
    # The sample is fixed by the seed, so a resumed audit continues the same posts.
    chosen = _sample({k: posts[k] for k in drafts if k in posts}, set(), target, args.seed + 1)
    todo = [p for p in chosen if post_key(p) not in audited]
    print(open_rules_hint())
    print(f"Auditing {target} of {len(drafts)} drafts ({args.share:.0%}). The draft label is hidden so it can't sway you.")
    _label_by_hand(todo, path, target - len(todo), target, args.by)
    report(args)


def open_rules_hint() -> str:
    return "Label by the rules in pipeline/LABELLING.md. Keep it open while you work."


# Drafting with the LLM


def _run_model(prompt: str) -> str:
    # Labelling is a simple task, so reasoning is kept to a minimum; the answer still needs room for 20 labels.
    return llm.complete([{"role": "user", "content": prompt}], max_tokens=4000, effort="minimal")


def draft_prompt(batch: list[dict]) -> str:
    numbered = "\n".join(f"{i + 1}. [{', '.join(p['coins'])}] {p['text'][:600]}" for i, p in enumerate(batch))
    return (
        f"{RULES}\n\nLabel each post below by these rules. Answer with a JSON array only, one object per post, "
        f'in order: [{{"n": 1, "label": "positive|neutral|negative|off_topic"}}, ...]\n\nPosts:\n{numbered}'
    )


def parse_draft(text: str, size: int) -> list[str | None]:
    """Labels in post order; None where the model's answer for a post is missing or not a label."""
    labels: list[str | None] = [None] * size
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        return labels
    try:
        items = json.loads(match.group(0))
    except json.JSONDecodeError:
        return labels
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and isinstance(item.get("n"), int) and 1 <= item["n"] <= size and item.get("label") in LABELS:
            labels[item["n"] - 1] = item["label"]
    return labels


def draft(args) -> None:
    if not llm.available():
        sys.exit("Set MODEL_API_KEY (a Meta Model API key).")
    posts = load_posts(args.raw)
    path = args.labels / "draft.jsonl"
    exclude = set(load_labels(path)) | set(load_labels(args.labels / "hand.jsonl"))
    todo = _sample(posts, exclude, max(0, args.count - len(load_labels(path))), args.seed + 2)
    saved = missing = 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start : start + BATCH]
        try:
            labels = parse_draft(_run_model(draft_prompt(batch)), len(batch))
        except Exception as error:  # the posts stay unlabelled for the next run
            print(f"  batch at {start} failed: {str(error)[:120]}")
            missing += len(batch)
            continue
        rows = [{"key": post_key(p), "label": label, "by": MODEL, "at": now_iso()} for p, label in zip(batch, labels) if label]
        append_jsonl(path, rows)
        saved += len(rows)
        missing += len(batch) - len(rows)
        print(f"  {start + len(batch)}/{len(todo)} posts, {saved} labelled, {missing} unreadable")
        time.sleep(0.5)
    print(f"{saved} drafts saved to {path}. {missing} posts got no usable label and stay unlabelled.")


# Report


def report(args) -> None:
    hand_labels = load_labels(args.labels / "hand.jsonl")
    drafts = load_labels(args.labels / "draft.jsonl")
    audited = load_labels(args.labels / "audit.jsonl")
    def counts(labels: dict[str, str]) -> dict[str, int]:
        return {name: list(labels.values()).count(name) for name in LABELS}

    pairs = [(audited[k], drafts[k]) for k in audited if k in drafts]
    agreement = sum(a == d for a, d in pairs) / len(pairs) if pairs else None
    summary = {
        "hand": {"total": len(hand_labels), **counts(hand_labels)},
        "draft": {"total": len(drafts), **counts(drafts)},
        "audit": {"total": len(pairs), "agreement": round(agreement, 3) if agreement is not None else None},
        "drafts_usable": agreement is not None and agreement >= 0.8,
    }
    if pairs:
        summary["audit"]["confusion"] = {a: {d: sum(1 for x, y in pairs if x == a and y == d) for d in LABELS} for a in LABELS}
    out = args.labels / "report.json"
    out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    if agreement is not None and agreement < 0.8:
        print("Agreement is under 80%: the PRD says don't train on these drafts. Tighten LABELLING.md and redraft.")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, func in {"hand": hand, "draft": draft, "audit": audit, "report": report}.items():
        cmd = sub.add_parser(name)
        cmd.set_defaults(func=func)
        cmd.add_argument("--labels", type=Path, default=Path("../data/labels"))
        if name != "report":
            cmd.add_argument("--raw", type=Path, default=Path("../data/raw"))
            cmd.add_argument("--seed", type=int, default=7)
        if name in ("hand", "draft"):
            cmd.add_argument("--count", type=int, default=300 if name == "hand" else 3000)
        if name in ("hand", "audit"):
            cmd.add_argument("--by", default=os.environ.get("USER") or os.environ.get("USERNAME") or "human")
        if name == "audit":
            cmd.add_argument("--share", type=float, default=0.1)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
