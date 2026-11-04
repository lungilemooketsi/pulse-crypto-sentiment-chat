"""The snapshot must mark stocks as stocks and read the Fear & Greed reply correctly."""

import unittest
from datetime import datetime, timezone

from pulse_pipeline.dataset import post_key
from pulse_pipeline.score import to_score
from pulse_pipeline.snapshot import agreement, large_moves, muse_todo, parse_fear_greed, summarise


def post(i: int, source: str, symbol: str) -> dict:
    return {"source": source, "id": str(i), "url": f"https://example.com/{i}", "created_at": "2026-11-04T10:00:00+00:00", "text": f"story {i}", "coins": [symbol], "meta": {"feed": "Reuters", "headline": f"Story {i}"}}


class Summary(unittest.TestCase):
    def test_stock_news_gives_a_stock_a_mood_with_headlines(self):
        posts = [post(i, "finnhub", "AAPL") for i in range(5)] + [post(i + 5, "bluesky", "BTC") for i in range(5)]
        labels = {post_key(p): "positive" for p in posts}
        now = datetime(2026, 11, 4, tzinfo=timezone.utc)
        coins = summarise(posts, labels, now, now)["coins"]
        self.assertEqual((coins["AAPL"]["kind"], coins["AAPL"]["name"]), ("stock", "Apple"))
        self.assertEqual(len(coins["AAPL"]["headlines"]), 3)
        self.assertEqual(coins["BTC"]["kind"], "crypto")
        self.assertEqual(coins["BTC"]["headlines"], [])


class SharedLabelling(unittest.TestCase):
    def setUp(self):
        self.posts = [post(i, "bluesky", "BTC") for i in range(4)] + [post(i + 4, "finnhub", "AAPL") for i in range(2)]
        self.keys = [post_key(p) for p in self.posts]

    def test_muse_takes_what_the_model_cannot_then_a_sample(self):
        todo = muse_todo(self.posts, set(), set(self.keys[:4]), max_new=10, check=1)
        self.assertEqual([p["source"] for p in todo], ["finnhub", "finnhub", "bluesky"])

    def test_the_cap_keeps_needed_posts_ahead_of_the_sample(self):
        todo = muse_todo(self.posts, set(), set(self.keys[:4]), max_new=2, check=4)
        self.assertEqual([p["source"] for p in todo], ["finnhub", "finnhub"])

    def test_nothing_is_labelled_twice(self):
        self.assertEqual(muse_todo(self.posts, set(self.keys), set(), max_new=10), [])

    def test_agreement_counts_only_posts_both_labelled(self):
        muse = {self.keys[0]: "positive", self.keys[1]: "negative", self.keys[4]: "neutral"}
        model = {self.keys[0]: "positive", self.keys[1]: "neutral", self.keys[2]: "neutral"}
        self.assertEqual(agreement(self.posts, muse, model), {"name": "pulse-finbert-v1", "checked": 2, "agreement": 0.5})

    def test_no_overlap_gives_no_rate(self):
        self.assertIsNone(agreement(self.posts, {}, {})["agreement"])


class Scoring(unittest.TestCase):
    def test_scores_only_new_recent_posts_from_trained_sources(self):
        posts = {post_key(p): p for p in [post(1, "bluesky", "BTC"), post(2, "rss", "ETH"), post(3, "finnhub", "AAPL"), post(4, "bluesky", "BTC")]}
        posts["bluesky:4"]["created_at"] = "2026-11-01T00:00:00+00:00"
        todo = to_score(posts, {"rss:2"}, "2026-11-04T00:00:00+00:00")
        self.assertEqual([p["id"] for p in todo], ["1"])


class LargeMoves(unittest.TestCase):
    def row(self, asset: str, usd: float, at: str = "2026-11-04T10:00:00+00:00") -> dict:
        return {"asset": asset, "usd": usd, "amount": 1.0, "wallet_label": "Binance", "direction": "in", "counterparty": None, "created_at": at, "url": "https://example.com"}

    def test_recent_tracked_coins_biggest_first_with_wrapped_forms_counted(self):
        rows = [self.row("BTC", 20e6), self.row("WETH", 30e6), self.row("USDT", 90e6), self.row("BTC", 80e6, "2026-11-01T00:00:00+00:00")]
        moves = large_moves(rows, "2026-11-04T00:00:00+00:00")
        self.assertEqual([(m["asset"], m["usd"]) for m in moves], [("ETH", 30e6), ("BTC", 20e6)])


class FearGreed(unittest.TestCase):
    def test_reads_the_latest_value(self):
        reply = {"data": [{"value": "34", "value_classification": "Fear", "timestamp": "1793750400"}]}
        self.assertEqual(parse_fear_greed(reply), {"value": 34, "label": "Fear", "at": "2026-11-04"})


if __name__ == "__main__":
    unittest.main()
