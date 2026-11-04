"""The plain-Python scorer must give the same answers as the scikit-learn model it was exported from."""

import unittest

from pulse_pipeline.sentiment_model import SentimentModel

try:
    from pulse_pipeline import train
except ImportError:  # the machine-learning packages are optional
    train = None

TEXTS = [
    ("bitcoin surges to a record high, great news", "positive"),
    ("ethereum rally continues, strong gains today", "positive"),
    ("solana breaks out, huge gains and strong demand", "positive"),
    ("bitcoin crashes hard, terrible losses everywhere", "negative"),
    ("ethereum dumps again, huge losses and panic", "negative"),
    ("solana collapse wipes out gains, terrible day", "negative"),
    ("bitcoin price is flat today, no change", "neutral"),
    ("ethereum network upgrade scheduled for next week", "neutral"),
    ("solana update released, no change to fees", "neutral"),
    ("tron the film has a great soundtrack", "off_topic"),
    ("polygon meshes in my 3d art project", "off_topic"),
    ("tron film poster in my 3d art room", "off_topic"),
]


class Scorer(unittest.TestCase):
    def test_counts_repeats_with_a_log_and_normalises(self):
        model = SentimentModel({"labels": ["negative", "positive"], "max_n": 1, "terms": ["bad", "good"], "idf": [1.0, 1.0], "weights": [[1.0, -1.0], [-1.0, 1.0]], "bias": [0.0, 0.0]})
        self.assertEqual(model.predict("good GOOD news"), "positive")
        self.assertEqual(model.predict("bad bad good"), "negative")

    def test_text_with_no_known_terms_falls_back_to_the_bias(self):
        model = SentimentModel({"labels": ["negative", "neutral"], "max_n": 1, "terms": ["bad"], "idf": [1.0], "weights": [[1.0], [-1.0]], "bias": [0.0, 0.5]})
        self.assertEqual(model.predict("nothing here"), "neutral")

    @unittest.skipIf(train is None, "needs requirements-ml.txt")
    def test_matches_the_trained_model(self):
        texts, labels = zip(*TEXTS)
        vectoriser, trained = train.fit_tfidf(list(texts), list(labels), 10, 2)
        model = SentimentModel(train.export_tfidf(vectoriser, trained, 2))
        samples = list(texts) + ["bitcoin gains after a terrible day", "great 3d art of the film", "no change in losses", "unseen words only"]
        self.assertEqual([model.predict(text) for text in samples], list(trained.predict(vectoriser.transform(samples))))


if __name__ == "__main__":
    unittest.main()
