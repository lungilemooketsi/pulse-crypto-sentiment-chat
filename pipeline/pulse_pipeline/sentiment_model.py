"""Runs Pulse's own sentiment model: TF-IDF features and logistic regression, read from a JSON file.

Plain Python, so the scheduled Collect job needs no machine-learning packages to use it. train.py writes the file.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

TOKEN = re.compile(r"(?u)\b\w\w+\b")  # scikit-learn's default, so features match training


class SentimentModel:
    def __init__(self, data: dict):
        self.labels: list[str] = data["labels"]
        self.max_n: int = data["max_n"]
        self.index = {term: i for i, term in enumerate(data["terms"])}
        self.idf: list[float] = data["idf"]
        self.weights: list[list[float]] = data["weights"]  # one row per label
        self.bias: list[float] = data["bias"]

    @classmethod
    def load(cls, path: Path) -> "SentimentModel":
        return cls(json.loads(path.read_text(encoding="utf-8")))

    def _features(self, text: str) -> dict[int, float]:
        tokens = TOKEN.findall(text.lower())
        counts: dict[int, int] = {}
        for size in range(1, self.max_n + 1):
            for start in range(len(tokens) - size + 1):
                index = self.index.get(" ".join(tokens[start : start + size]))
                if index is not None:
                    counts[index] = counts.get(index, 0) + 1
        features = {index: (1 + math.log(count)) * self.idf[index] for index, count in counts.items()}
        length = math.sqrt(sum(value * value for value in features.values()))
        return {index: value / length for index, value in features.items()} if length else {}

    def predict(self, text: str) -> str:
        features = self._features(text)
        scores = [bias + sum(row[index] * value for index, value in features.items()) for row, bias in zip(self.weights, self.bias)]
        return self.labels[scores.index(max(scores))]
