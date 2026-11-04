"""Detection on made-up series, so the rules can be checked without network or real data."""

import random
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from pulse_pipeline import anomalies, history


def walk(days: int, shocks: dict[int, float] | None = None, seed: int = 3) -> list[float]:
    rng = random.Random(seed)
    closes = [100.0]
    for day in range(1, days):
        closes.append(closes[-1] * (1 + rng.gauss(0, 0.01) + (shocks or {}).get(day, 0)))
    return closes


class Detection(unittest.TestCase):
    def test_flags_a_sudden_crash(self):
        flagged = anomalies.flag_days(walk(400, {300: -0.3}), "2020-01-01", "crypto")
        self.assertIn(date(2020, 1, 1) + timedelta(days=300), [item["day"] for item in flagged])

    def test_a_calm_series_flags_only_its_rarest_days(self):
        flagged = anomalies.flag_days(walk(1000), "2020-01-01", "crypto")
        self.assertLess(len(flagged), 1000 * anomalies.RARE_SHARE * 3)

    def test_a_negative_price_keeps_its_direction(self):
        series = anomalies.returns([18.0, -37.0, 9.0], "2020-04-19")
        self.assertLess(series[0][1], 0)
        self.assertGreater(series[1][1], 0)

    def test_weekend_carry_forward_is_not_a_trading_day(self):
        self.assertEqual(len(anomalies.returns([10.0, 10.0, 10.0, 11.0], "2020-01-03")), 1)

    def test_runs_in_different_assets_merge_into_one_episode(self):
        day = date(2022, 11, 8)
        runs = [
            {"symbol": "BTC", "start": day, "end": day, "peak": day, "z": -6.0},
            {"symbol": "ETH", "start": day + timedelta(days=1), "end": day + timedelta(days=2), "peak": day, "z": -5.0},
            {"symbol": "WTI", "start": day + timedelta(days=40), "end": day + timedelta(days=40), "peak": day, "z": 5.0},
        ]
        episodes = anomalies.merge_runs(runs)
        self.assertEqual([len(e["runs"]) for e in episodes], [2, 1])


class Recall(unittest.TestCase):
    def test_counts_only_the_same_asset_near_the_date(self):
        episodes = [{"start": "2022-11-08", "end": "2022-11-10", "assets": [{"asset": "BTC"}]}]
        known = [
            {"asset": "BTC", "date": "2022-11-12", "event": "near"},
            {"asset": "BTC", "date": "2022-12-30", "event": "far"},
            {"asset": "ETH", "date": "2022-11-09", "event": "other asset"},
            {"asset": "TSLA", "date": "2022-11-09", "event": "no data"},
        ]
        result = anomalies.recall(episodes, known, {"BTC": {}, "ETH": {}})
        self.assertEqual((result["found"], result["total"]), (1, 3))


class Categories(unittest.TestCase):
    headlines = [{"title": "FTX files for bankruptcy", "url": "https://news.example/a", "source": "news.example"}]

    def test_reads_a_category_and_the_headlines_used(self):
        result = anomalies.parse_category('Here: {"category": "exchange_failure", "summary": "FTX failed.", "headlines": [1, 9]}', self.headlines)
        self.assertEqual(result["category"], "exchange_failure")
        self.assertEqual(result["headlines"], self.headlines)

    def test_rejects_invented_categories_and_bad_json(self):
        self.assertIsNone(anomalies.parse_category('{"category": "aliens", "summary": "x"}', self.headlines))
        self.assertIsNone(anomalies.parse_category("no idea", self.headlines))


class Categorise(unittest.TestCase):
    def test_a_saved_result_survives_a_moved_start(self):
        episode = {"id": "2022-11-04", "start": "2022-11-04", "end": "2022-11-10"}
        row = {"id": "2022-11-08", "category": "exchange_failure", "summary": "FTX failed.", "headlines": []}
        self.assertEqual(anomalies.saved_row(episode, {"2022-11-08": row}), row)
        self.assertIsNone(anomalies.saved_row(episode, {"2022-11-12": row}))

    def test_an_exact_match_comes_first(self):
        episode = {"id": "2022-11-04", "start": "2022-11-04", "end": "2022-11-10"}
        exact = {"id": "2022-11-04", "category": "crash", "summary": "A fall.", "headlines": []}
        other = {"id": "2022-11-08", "category": "exchange_failure", "summary": "FTX failed.", "headlines": []}
        self.assertEqual(anomalies.saved_row(episode, {"2022-11-04": exact, "2022-11-08": other}), exact)

    def test_every_episode_gets_its_fields_when_a_lookup_fails(self):
        episodes = [{"id": "2022-11-08", "start": "2022-11-08", "end": "2022-11-08", "assets": [{"z": -6.0, "peak_day": "2022-11-08", "kind": "crypto", "name": "Bitcoin", "move": -0.2}]}]

        def refuse(_episode):
            raise RuntimeError("no answer")

        lookup, available = anomalies.headlines_for, anomalies.llm.available
        anomalies.headlines_for, anomalies.llm.available = refuse, lambda: True
        try:
            with tempfile.TemporaryDirectory() as folder:
                anomalies.categorise(episodes, Path(folder) / "categories.jsonl", 5)
        finally:
            anomalies.headlines_for, anomalies.llm.available = lookup, available
        self.assertEqual((episodes[0]["category"], episodes[0]["summary"], episodes[0]["headlines"]), ("uncategorised", None, []))


class History(unittest.TestCase):
    def test_calendar_carries_the_last_value_over_gaps(self):
        start, values = history.to_calendar({date(2024, 1, 5): 10.0, date(2024, 1, 8): 12.0})
        self.assertEqual((start, values), ("2024-01-05", [10.0, 10.0, 10.0, 12.0]))

    def test_parses_each_source(self):
        fred = history.parse_fred("observation_date,DEXSFUS\n2020-03-02,15.5\n2020-03-03,\n2010-01-01,7.0\n")
        self.assertEqual(fred, {date(2020, 3, 2): 15.5})
        candles = history.parse_candles([[1584057600, 1, 2, 1.5, 1.8, 100]])
        self.assertEqual(candles, {date(2020, 3, 13): 1.8})
        stocks = history.parse_twelve_data({"values": [{"datetime": "2026-11-03", "close": "331.9"}]})
        self.assertEqual(stocks, {date(2026, 11, 3): 331.9})
        with self.assertRaises(RuntimeError):
            history.parse_twelve_data({"status": "error", "message": "limit reached"})


if __name__ == "__main__":
    unittest.main()
