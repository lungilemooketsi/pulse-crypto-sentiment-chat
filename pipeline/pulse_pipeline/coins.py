"""Which coins a post mentions, with the same rules as the app's src/lib/market.ts.

A coin matches by full name (any case, except names that are also ordinary words), by ticker written in
capitals or as a $cashtag, and a few tickers that are never English words also match in lower case. A match
inside a longer one is dropped, so "Bitcoin Cash" is BCH, not BTC as well.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

_DATA = json.loads((Path(__file__).parent / "coins.json").read_text(encoding="utf-8"))
# Stocks and ETFs, as in STOCKS in src/lib/market.ts; keep them in step.
STOCKS = {
    "SPY": "SPDR S&P 500 ETF",
    "QQQ": "Invesco QQQ ETF",
    "VTI": "Vanguard Total Stock Market ETF",
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "NVDA": "Nvidia",
    "AMZN": "Amazon",
    "GOOGL": "Alphabet",
    "META": "Meta Platforms",
    "TSLA": "Tesla",
}

COINS: list[dict] = _DATA["coins"]
BY_ID = {coin["id"]: coin for coin in COINS}


@lru_cache(maxsize=None)
def _patterns() -> list[tuple[str, list[re.Pattern[str]]]]:
    case_sensitive = set(_DATA["case_sensitive_names"])
    any_case = set(_DATA["any_case_tickers"])
    result = []
    for coin in COINS:
        name_flags = 0 if coin["name"] in case_sensitive else re.IGNORECASE
        ticker_flags = re.IGNORECASE if coin["symbol"] in any_case else 0
        name, symbol = re.escape(coin["name"]), re.escape(coin["symbol"])
        result.append(
            (
                coin["symbol"],
                [
                    re.compile(rf"(?<![\w$]){name}(?!\w)", name_flags),
                    re.compile(rf"(?<![\w$]){symbol}(?!\w)", ticker_flags),
                    re.compile(rf"\${symbol}(?!\w)", re.IGNORECASE),
                ],
            )
        )
    for alias, coin_id in _DATA["aliases"].items():
        result.append((BY_ID[coin_id]["symbol"], [re.compile(rf"(?<![\w$]){re.escape(alias)}(?!\w)", re.IGNORECASE)]))
    return result


def detect_coins(text: str) -> list[str]:
    """Tickers of the coins the text mentions, in order of first mention."""
    hits: list[tuple[int, int, str]] = []
    for symbol, patterns in _patterns():
        for pattern in patterns:
            for match in pattern.finditer(text):
                hits.append((match.start(), match.end(), symbol))

    outer = [
        hit
        for hit in hits
        if not any(o is not hit and o[0] <= hit[0] and o[1] >= hit[1] and o[1] - o[0] > hit[1] - hit[0] for o in hits)
    ]
    ordered: list[str] = []
    for _, _, symbol in sorted(outer):
        if symbol not in ordered:
            ordered.append(symbol)
    return ordered


def search_terms() -> list[str]:
    """One search query per coin (its name), for sources searched by keyword."""
    return [coin["name"] for coin in COINS]
