"""Parser tests on sample responses in each API's documented shape, so collectors can be checked without keys."""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from pulse_pipeline import http
from pulse_pipeline.coins import detect_coins
from pulse_pipeline.collectors import chain, social
from pulse_pipeline.records import Post, write_records

WALLET_ETH = {"address": "0xAbC0000000000000000000000000000000000001", "label": "Exchange A", "kind": "exchange", "chain": "ethereum"}
WALLET_BTC = {"address": "bc1qexchangeaddress", "label": "Exchange B", "kind": "exchange", "chain": "bitcoin"}


class CoinDetection(unittest.TestCase):
    def test_matches_the_app(self):
        cases = {
            "Compare BTC vs ETH sentiment": ["BTC", "ETH"],
            "bitcoin vs bitcoin cash": ["BTC", "BCH"],
            "I'll link my wallet in the near future": [],
            "Compare sol and ada": [],
            "Is ether a good buy?": ["ETH"],
            "my $100 budget": [],
        }
        for text, expected in cases.items():
            self.assertEqual(detect_coins(text), expected, text)


class Finnhub(unittest.TestCase):
    def test_keeps_stories_under_their_stock(self):
        articles = [
            {"id": 7, "headline": "Apple beats on revenue", "summary": "Shares <b>rose</b> late.", "url": "https://example.com/a", "datetime": 1793700000, "source": "Reuters"},
            {"id": 8, "headline": "", "summary": "No headline", "url": "https://example.com/b", "datetime": 1793700000},
            {"id": 9, "headline": "No link", "url": "", "datetime": 1793700000},
        ]
        posts = social.parse_finnhub("AAPL", articles)
        self.assertEqual([p.id for p in posts], ["AAPL:7"])
        self.assertEqual(posts[0].coins, ["AAPL"])
        self.assertEqual(posts[0].text, "Apple beats on revenue. Shares rose late.")
        self.assertEqual(posts[0].meta, {"feed": "Reuters", "headline": "Apple beats on revenue"})

    def test_no_key_skips_the_source(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(http.MissingCredentials):
                social.collect_finnhub()

    def test_a_failure_never_prints_the_key(self):
        error = RuntimeError("token=secret-key")
        output = io.StringIO()
        with mock.patch.dict(os.environ, {"FINNHUB_API_KEY": "secret-key"}), mock.patch.object(social.http, "get_json", side_effect=error), mock.patch.object(social.time, "sleep"), redirect_stdout(output):
            with self.assertRaises(RuntimeError) as caught:
                social.collect_finnhub()
        self.assertNotIn("secret-key", output.getvalue() + str(caught.exception))


def arkham_row(source: dict, target: dict, **extra) -> dict:
    row = {"transactionHash": "0xabc", "blockTimestamp": "2026-11-04T10:00:00Z", "chain": "ethereum", "tokenSymbol": "ETH", "unitValue": 5000.5, "historicalUSD": 15000000.0, "fromAddress": source, "toAddress": target}
    return {**row, **extra}


BINANCE = {"address": "0x1", "arkhamEntity": {"id": "binance", "name": "Binance", "type": "cex"}}
COINBASE = {"address": "0x2", "arkhamEntity": {"id": "coinbase", "name": "Coinbase", "type": "cex"}}
FUND = {"address": "0x3", "arkhamEntity": {"id": "fund-a", "name": "A Fund", "type": "fund"}}
PERSON = {"address": "0x4", "arkhamEntity": {"id": "person", "name": "A Real Person", "type": "individual"}}
UNKNOWN = {"address": "0x5"}


class Arkham(unittest.TestCase):
    def test_a_move_onto_an_exchange(self):
        [move] = chain.parse_arkham([arkham_row(FUND, BINANCE)])
        self.assertEqual((move.wallet_label, move.direction, move.counterparty, move.usd), ("Binance", "in", "A Fund", 15000000.0))
        self.assertEqual(move.url, "https://intel.arkm.com/explorer/tx/0xabc")

    def test_a_move_off_an_exchange(self):
        [move] = chain.parse_arkham([arkham_row(BINANCE, UNKNOWN)])
        self.assertEqual((move.wallet_label, move.direction, move.counterparty), ("Binance", "out", None))

    def test_a_person_is_never_named(self):
        [move] = chain.parse_arkham([arkham_row(PERSON, BINANCE)])
        self.assertIsNone(move.counterparty)
        self.assertNotIn("Real Person", str(move))

    def test_a_type_not_on_the_list_is_never_named(self):
        other = {"address": "0x6", "arkhamEntity": {"id": "x", "name": "Someone New", "type": "something-new"}}
        self.assertIsNone(chain.parse_arkham([arkham_row(other, BINANCE)])[0].counterparty)

    def test_moves_inside_one_exchange_and_without_one_are_dropped(self):
        self.assertEqual(chain.parse_arkham([arkham_row(BINANCE, BINANCE), arkham_row(FUND, UNKNOWN)]), [])

    def test_a_native_coin_takes_its_chain_symbol(self):
        row = arkham_row(UNKNOWN, COINBASE, chain="bitcoin", tokenSymbol=None)
        self.assertEqual(chain.parse_arkham([row])[0].asset, "BTC")

    def test_a_chain_with_address_lists_is_read(self):
        row = arkham_row({}, {}, chain="bitcoin", tokenSymbol=None)
        del row["fromAddress"], row["toAddress"]
        row["fromAddresses"], row["toAddresses"] = [{"address": UNKNOWN}], [{"address": BINANCE}]
        self.assertEqual(chain.parse_arkham([row])[0].wallet_label, "Binance")

    def test_no_key_skips_the_source(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(http.MissingCredentials):
                chain.collect_arkham()


class Bluesky(unittest.TestCase):
    def test_builds_post_urls(self):
        reply = {"posts": [{"uri": "at://did:plc:xyz/app.bsky.feed.post/3abc", "author": {"did": "did:plc:xyz", "handle": "trader.bsky.social"}, "record": {"text": "Solana fees spiked today", "createdAt": "2026-11-03T10:00:00.000Z", "langs": ["en"]}, "indexedAt": "2026-11-03T10:00:01Z", "likeCount": 4}]}
        posts = social.parse_bluesky(reply)
        self.assertEqual(posts[0].url, "https://bsky.app/profile/trader.bsky.social/post/3abc")
        self.assertEqual(posts[0].coins, ["SOL"])
        self.assertEqual(posts[0].created_at, "2026-11-03T10:00:00+00:00")


class Rss(unittest.TestCase):
    def test_reads_items_with_coins(self):
        xml = b"""<rss><channel>
        <item><title>Bitcoin ETF flows turn positive</title><link>https://news.example/a</link><pubDate>Tue, 03 Nov 2026 09:00:00 +0000</pubDate><description>&lt;p&gt;Inflows return.&lt;/p&gt;</description></item>
        <item><title>Markets open flat</title><link>https://news.example/b</link><pubDate>Tue, 03 Nov 2026 09:00:00 +0000</pubDate></item>
        </channel></rss>"""
        posts = social.parse_rss("example", xml)
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0].text, "Bitcoin ETF flows turn positive. Inflows return.")


class RssFeeds(unittest.TestCase):
    def test_one_blocked_feed_does_not_lose_the_others(self):
        good = b"<rss><channel><item><title>Bitcoin climbs</title><link>https://news.example/a</link><pubDate>Tue, 03 Nov 2026 09:00:00 +0000</pubDate></item></channel></rss>"

        def fake_request(url, **kwargs):
            if "blocked" in url:
                raise social.http.HttpError(url, 403, "Just a moment...")
            return good

        feeds, request = social.FEEDS, social.http.request
        social.FEEDS, social.http.request = {"ok": "https://ok.example/rss", "blocked": "https://blocked.example/rss"}, fake_request
        try:
            self.assertEqual([p.url for p in social.collect_rss()], ["https://news.example/a"])
            social.FEEDS = {"blocked": "https://blocked.example/rss"}
            with self.assertRaises(RuntimeError):
                social.collect_rss()
        finally:
            social.FEEDS, social.http.request = feeds, request


class Etherscan(unittest.TestCase):
    def test_eth_and_tokens_above_threshold(self):
        native = [
            {"hash": "0x1", "from": "0xdead", "to": WALLET_ETH["address"].lower(), "value": str(250 * 10**18), "timeStamp": "1793700000", "isError": "0"},
            {"hash": "0x2", "from": WALLET_ETH["address"].lower(), "to": "0xbeef", "value": str(5 * 10**18), "timeStamp": "1793700000", "isError": "0"},
            {"hash": "0x3", "from": "0xdead", "to": WALLET_ETH["address"].lower(), "value": str(900 * 10**18), "timeStamp": "1793700000", "isError": "1"},
        ]
        tokens = [
            {"hash": "0x4", "from": WALLET_ETH["address"].lower(), "to": "0xbeef", "value": str(2_000_000 * 10**6), "timeStamp": "1793700000", "contractAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7"},
            {"hash": "0x5", "from": "0xdead", "to": WALLET_ETH["address"].lower(), "value": "1", "timeStamp": "1793700000", "contractAddress": "0x0000000000000000000000000000000000000bad"},
        ]
        eth = chain.parse_etherscan(WALLET_ETH, native, token=False)
        usdt = chain.parse_etherscan(WALLET_ETH, tokens, token=True)
        self.assertEqual([(t.tx_hash, t.direction, t.amount) for t in eth], [("0x1", "in", 250.0)])
        self.assertEqual([(t.asset, t.direction, t.amount, t.counterparty) for t in usdt], [("USDT", "out", 2_000_000.0, "0xbeef")])


class Esplora(unittest.TestCase):
    def test_net_flow_for_the_watched_address(self):
        txs = [
            {"txid": "aa", "status": {"confirmed": True, "block_time": 1793700000}, "vin": [{"prevout": {"scriptpubkey_address": "bc1qwhale", "value": 50 * 10**8}}], "vout": [{"scriptpubkey_address": WALLET_BTC["address"], "value": 49 * 10**8}, {"scriptpubkey_address": "bc1qwhale", "value": 1 * 10**8}]},
            {"txid": "bb", "status": {"confirmed": False}, "vin": [], "vout": [{"scriptpubkey_address": WALLET_BTC["address"], "value": 99 * 10**8}]},
            {"txid": "cc", "status": {"confirmed": True, "block_time": 1793700000}, "vin": [], "vout": [{"scriptpubkey_address": WALLET_BTC["address"], "value": 1 * 10**8}]},
        ]
        transfers = chain.parse_esplora(WALLET_BTC, txs)
        self.assertEqual([(t.tx_hash, t.direction, t.amount, t.counterparty) for t in transfers], [("aa", "in", 49.0, "bc1qwhale")])


class Records(unittest.TestCase):
    def test_appends_without_duplicates(self):
        post = Post(source="rss", id="x", url="https://news.example/x", created_at="2026-11-03T00:00:00+00:00", text="Bitcoin", coins=["BTC"])
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            self.assertEqual(write_records(out, "rss", [post, post], day="2026-11-03"), 1)
            self.assertEqual(write_records(out, "rss", [post], day="2026-11-03"), 0)
            lines = (out / "rss" / "2026-11-03.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(json.loads(lines[0])["url"], "https://news.example/x")


if __name__ == "__main__":
    unittest.main()
