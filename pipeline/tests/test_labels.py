"""The split must never let a later post into training, and drafts must never save a garbled label."""

import unittest

from pulse_pipeline.dataset import split_by_time
from pulse_pipeline.label import parse_draft


def post(i: int) -> dict:
    return {"source": "rss", "id": str(i), "created_at": f"2026-10-{i + 1:02d}T00:00:00+00:00", "text": f"post {i}", "coins": ["BTC"]}


class SplitByTime(unittest.TestCase):
    def setUp(self):
        self.posts = {f"rss:{i}": post(i) for i in range(30)}
        self.labels = {key: "positive" for key in self.posts}

    def test_training_ends_before_validation_and_validation_before_test(self):
        split = split_by_time(self.posts, self.labels)
        last = lambda name: max(p["created_at"] for p, _ in split[name])
        first = lambda name: min(p["created_at"] for p, _ in split[name])
        self.assertLess(last("train"), first("valid"))
        self.assertLess(last("valid"), first("test"))
        self.assertEqual(split["cutoff"], first("test"))

    def test_a_repost_stays_out_of_the_test_set(self):
        self.posts["rss:29"]["text"] = "POST 0!! https://example.com/x"
        split = split_by_time(self.posts, self.labels)
        self.assertEqual(sum(len(split[name]) for name in ("train", "valid", "test")), 29)
        self.assertNotIn("29", [p["id"] for p, _ in split["test"]])

    def test_unlabelled_posts_are_left_out(self):
        del self.labels["rss:3"]
        split = split_by_time(self.posts, self.labels)
        self.assertNotIn("3", [p["id"] for p, _ in split["train"]])

    def test_refuses_too_few_posts(self):
        with self.assertRaises(ValueError):
            split_by_time(self.posts, {"rss:0": "positive"})


class ParseDraft(unittest.TestCase):
    def test_reads_labels_in_order_and_drops_bad_ones(self):
        text = 'Here you go:\n[{"n": 1, "label": "positive"}, {"n": 3, "label": "bullish"}, {"n": 2, "label": "off_topic"}, {"n": 9, "label": "neutral"}]'
        self.assertEqual(parse_draft(text, 3), ["positive", "off_topic", None])

    def test_unreadable_answer_labels_nothing(self):
        self.assertEqual(parse_draft("Sorry, I can't help with that.", 2), [None, None])
        self.assertEqual(parse_draft("[{broken json", 2), [None, None])


if __name__ == "__main__":
    unittest.main()
