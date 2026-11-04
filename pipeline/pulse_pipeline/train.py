"""Trains Pulse's own sentiment model from Muse Spark's labels, and compares it with simple baselines (3.5 to 4.4).

    pip install -r requirements-ml.txt
    python -m pulse_pipeline.train classic --raw ../data/raw --labels ../data/labels --out ../data/model
    python -m pulse_pipeline.train transformer --name distilroberta --base distilroberta-base   (also needs torch, transformers)
    python -m pulse_pipeline.train pick

This is distillation: the labels are Muse Spark's, and no person has checked them. Every score below therefore
measures agreement with Muse Spark on later posts, not accuracy against the truth.

Candidates train on the earliest posts, are chosen on the validation posts and reported on the latest posts, which
nothing has seen. Scores are macro-F1, over all four labels and over the three sentiment labels on on-topic posts.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from .dataset import LABELS, SENTIMENT, load_labels, load_posts, split_by_time
from .records import now_iso

BOOTSTRAP = 1000
RESULTS = "results.json"


def load_split(raw: Path, labels: Path) -> dict:
    split = split_by_time(load_posts(raw), load_labels(labels / "draft.jsonl"))
    return {name: ([post["text"] for post, _ in split[name]], [label for _, label in split[name]]) for name in ("train", "valid", "test")} | {"cutoff": split["cutoff"]}


def macro_f1(truth: list[str], predicted: list[str], labels: list[str]) -> float:
    return float(f1_score(truth, predicted, labels=labels, average="macro", zero_division=0))


def interval(truth: list[str], predicted: list[str], labels: list[str]) -> list[float]:
    """A 95% bootstrap interval, resampling test posts."""
    random_source = random.Random(1)
    size = len(truth)
    draws = []
    for _ in range(BOOTSTRAP):
        picks = [random_source.randrange(size) for _ in range(size)]
        draws.append(macro_f1([truth[i] for i in picks], [predicted[i] for i in picks], labels))
    draws.sort()
    return [round(draws[int(BOOTSTRAP * 0.025)], 3), round(draws[int(BOOTSTRAP * 0.975)], 3)]


def evaluate(truth: list[str], predicted: list[str]) -> dict:
    on_topic = [(t, p) for t, p in zip(truth, predicted) if t in SENTIMENT]
    topic_truth, topic_predicted = [t for t, _ in on_topic], [p for _, p in on_topic]
    return {
        "all_labels": {"macro_f1": round(macro_f1(truth, predicted, LABELS), 3), "interval": interval(truth, predicted, LABELS)},
        "on_topic": {"macro_f1": round(macro_f1(topic_truth, topic_predicted, SENTIMENT), 3), "interval": interval(topic_truth, topic_predicted, SENTIMENT)},
        "agreement": round(sum(t == p for t, p in zip(truth, predicted)) / len(truth), 3),
        "confusion": {"labels": LABELS, "rows_are_muse": confusion_matrix(truth, predicted, labels=LABELS).tolist()},
    }


def vader_label(analyzer: SentimentIntensityAnalyzer, text: str) -> str:
    # The thresholds VADER's authors recommend for its compound score.
    compound = analyzer.polarity_scores(text)["compound"]
    return "positive" if compound >= 0.05 else "negative" if compound <= -0.05 else "neutral"


def fit_tfidf(texts: list[str], labels: list[str], strength: float, max_n: int) -> tuple[TfidfVectorizer, LogisticRegression]:
    vectoriser = TfidfVectorizer(ngram_range=(1, max_n), min_df=2, sublinear_tf=True, max_features=20000)
    model = LogisticRegression(C=strength, max_iter=3000, class_weight="balanced")
    model.fit(vectoriser.fit_transform(texts), labels)
    return vectoriser, model


def export_tfidf(vectoriser: TfidfVectorizer, model: LogisticRegression, max_n: int) -> dict:
    terms = vectoriser.get_feature_names_out().tolist()
    return {
        "labels": model.classes_.tolist(),
        "max_n": max_n,
        "terms": terms,
        "idf": [round(float(value), 5) for value in vectoriser.idf_],
        "weights": [[round(float(value), 5) for value in row] for row in model.coef_],
        "bias": [round(float(value), 5) for value in model.intercept_],
    }


def classic(args) -> None:
    split = load_split(args.raw, args.labels)
    (train_text, train_truth), (valid_text, valid_truth), (test_text, test_truth) = split["train"], split["valid"], split["test"]

    results = {
        "at": now_iso(),
        "teacher": "Muse Spark",
        "test_starts": split["cutoff"],
        "sizes": {name: len(split[name][0]) for name in ("train", "valid", "test")},
        "test_labels": dict(Counter(test_truth)),
        "models": {},
    }

    common = Counter(train_truth).most_common(1)[0][0]
    results["models"]["most_common_label"] = {"test": evaluate(test_truth, [common] * len(test_truth))}
    analyzer = SentimentIntensityAnalyzer()
    results["models"]["vader"] = {"test": evaluate(test_truth, [vader_label(analyzer, text) for text in test_text])}

    best = None
    for strength in (0.3, 1, 3, 10, 30):
        for max_n in (1, 2):
            vectoriser, model = fit_tfidf(train_text, train_truth, strength, max_n)
            score = macro_f1(valid_truth, list(model.predict(vectoriser.transform(valid_text))), LABELS)
            if best is None or score > best[0]:
                best = (score, strength, max_n, vectoriser, model)
    score, strength, max_n, vectoriser, model = best
    results["models"]["tfidf_logreg"] = {
        "valid_macro_f1": round(score, 3),
        "settings": {"C": strength, "max_n": max_n},
        "test": evaluate(test_truth, list(model.predict(vectoriser.transform(test_text)))),
    }

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "tfidf_logreg.json").write_text(json.dumps(export_tfidf(vectoriser, model, max_n), ensure_ascii=False), encoding="utf-8")
    save(args.out, results)


def transformer(args) -> None:
    """Fine-tunes one pretrained model on the training posts, keeping the epoch that does best on validation."""
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    torch.manual_seed(1)
    split = load_split(args.raw, args.labels)
    (train_text, train_truth), (valid_text, valid_truth), (test_text, test_truth) = split["train"], split["valid"], split["test"]
    tokenizer = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForSequenceClassification.from_pretrained(args.base, num_labels=len(LABELS), ignore_mismatched_sizes=True)
    targets = [LABELS.index(label) for label in train_truth]
    counts = Counter(targets)
    weights = torch.tensor([len(targets) / (len(LABELS) * max(counts[i], 1)) for i in range(len(LABELS))])
    loss_of = torch.nn.CrossEntropyLoss(weight=weights)
    optimiser = torch.optim.AdamW(model.parameters(), lr=args.rate, weight_decay=0.01)

    def encode(texts: list[str]):
        return tokenizer(texts, truncation=True, max_length=args.length, padding=True, return_tensors="pt")

    def predict(texts: list[str]) -> list[str]:
        model.eval()
        labels: list[str] = []
        with torch.no_grad():
            for start in range(0, len(texts), 32):
                logits = model(**encode(texts[start : start + 32])).logits
                labels.extend(LABELS[i] for i in logits.argmax(dim=1).tolist())
        return labels

    best_score, best_state = -1.0, None
    order = list(range(len(train_text)))
    for epoch in range(args.epochs):
        model.train()
        random.Random(epoch).shuffle(order)
        for start in range(0, len(order), args.batch):
            picks = order[start : start + args.batch]
            optimiser.zero_grad()
            logits = model(**encode([train_text[i] for i in picks])).logits
            loss = loss_of(logits, torch.tensor([targets[i] for i in picks]))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
        score = macro_f1(valid_truth, predict(valid_text), LABELS)
        print(f"  {args.name} epoch {epoch + 1}: validation macro-F1 {score:.3f}")
        if score > best_score:
            best_score, best_state = score, {key: value.clone() for key, value in model.state_dict().items()}

    model.load_state_dict(best_state)
    folder = args.out / "weights" / args.name
    folder.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(folder)
    tokenizer.save_pretrained(folder)

    results = json.loads((args.out / RESULTS).read_text(encoding="utf-8"))
    results["models"][args.name] = {"valid_macro_f1": round(best_score, 3), "settings": {"base": args.base, "epochs": args.epochs, "rate": args.rate}, "test": evaluate(test_truth, predict(test_text))}
    save(args.out, results)


def pick(args) -> None:
    """The candidate that did best on validation. The test scores play no part in the choice."""
    results = json.loads((args.out / RESULTS).read_text(encoding="utf-8"))
    candidates = {name: model for name, model in results["models"].items() if "valid_macro_f1" in model}
    results["chosen"] = max(candidates, key=lambda name: candidates[name]["valid_macro_f1"])
    save(args.out, results)


def save(out: Path, results: dict) -> None:
    (out / RESULTS).write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Train {results['sizes']['train']}, validation {results['sizes']['valid']}, test {results['sizes']['test']} posts from {results['test_starts']}.")
    for name, model in results["models"].items():
        test = model["test"]
        print(f"  {name:20} all labels {test['all_labels']['macro_f1']:.3f} {test['all_labels']['interval']}  on-topic {test['on_topic']['macro_f1']:.3f} {test['on_topic']['interval']}  validation {model.get('valid_macro_f1', '-')}")
    if results.get("chosen"):
        print(f"Chosen on validation: {results['chosen']}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, func in {"classic": classic, "transformer": transformer, "pick": pick}.items():
        command = sub.add_parser(name)
        command.set_defaults(func=func)
        command.add_argument("--raw", type=Path, default=Path("../data/raw"))
        command.add_argument("--labels", type=Path, default=Path("../data/labels"))
        command.add_argument("--out", type=Path, default=Path("../data/model"))
        if name == "transformer":
            command.add_argument("--name", required=True)
            command.add_argument("--base", required=True)
            command.add_argument("--epochs", type=int, default=4)
            command.add_argument("--batch", type=int, default=16)
            command.add_argument("--rate", type=float, default=2e-5)
            command.add_argument("--length", type=int, default=96)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
