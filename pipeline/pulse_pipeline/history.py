"""Daily price history for the Simulation Lab and the Anomaly Library (subtasks 8.1, 8.6).

    python -m pulse_pipeline.history --out ../data/history

Sources, all usable without a key except stocks:
- Crypto: Coinbase Exchange public candles.
- USD/ZAR, WTI oil and US rates: FRED series in the public domain. The S&P 500 and Nasdaq series are copyrighted,
  so they are left out.
- South African inflation: World Bank.
- US stocks and ETFs: Twelve Data, only when TWELVE_DATA_API_KEY is set. Prices are unadjusted for dividends.

Each asset is stored as a start date and one close per calendar day. Markets closed at weekends carry the last
close forward, so every asset can be replayed on the same calendar.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import http
from .coins import STOCKS
from .records import now_iso

START = date(2015, 1, 1)
COINBASE = "https://api.exchange.coinbase.com/products/{}-USD/candles"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"
TWELVE_DATA = "https://api.twelvedata.com/time_series"
WORLD_BANK = "https://api.worldbank.org/v2/country/ZA/indicator/FP.CPI.TOTL.ZG"

CRYPTO = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "SOL": "Solana",
    "DOGE": "Dogecoin",
    "ADA": "Cardano",
    "LTC": "Litecoin",
    "AVAX": "Avalanche",
    "LINK": "Chainlink",
    "DOT": "Polkadot",
    "BCH": "Bitcoin Cash",
}
FRED_ASSETS = {
    "USDZAR": ("DEXSFUS", "US dollar in rand", "forex"),
    "WTI": ("DCOILWTICO", "WTI crude oil", "commodity"),
}
CONTEXT = {
    "DFF": ("US federal funds rate", "%"),
    "DGS10": ("US 10-year Treasury yield", "%"),
}

def to_calendar(points: dict[date, float]) -> tuple[str, list[float]]:
    """One value per calendar day from the first point to the last, carrying the last value over gaps."""
    days = sorted(points)
    values: list[float] = []
    day, last = days[0], points[days[0]]
    while day <= days[-1]:
        last = points.get(day, last)
        values.append(float(f"{last:.6g}"))
        day += timedelta(days=1)
    return days[0].isoformat(), values


def parse_fred(text: str) -> dict[date, float]:
    points = {}
    for row in csv.DictReader(io.StringIO(text)):
        day, value = date.fromisoformat(row["observation_date"]), list(row.values())[1]
        if day >= START and value not in ("", "."):
            points[day] = float(value)
    return points


def fred_series(series: str) -> dict[date, float]:
    return parse_fred(http.request(FRED, params={"id": series}, timeout=60).decode("utf-8"))


def parse_candles(rows: list[list[float]]) -> dict[date, float]:
    """Coinbase candles are [time, low, high, open, close, volume]; a day's time is its 00:00 UTC start."""
    return {datetime.fromtimestamp(row[0], timezone.utc).date(): row[4] for row in rows}


def coinbase_series(symbol: str, today: date) -> dict[date, float]:
    """Walks back 300 days at a time, the most one request returns, until the product has no older data."""
    points: dict[date, float] = {}
    end = today
    while end > START:
        begin = max(START, end - timedelta(days=299))
        rows = http.get_json(COINBASE.format(symbol), params={"granularity": 86400, "start": begin.isoformat(), "end": end.isoformat()})
        if not rows:
            break
        points.update(parse_candles(rows))
        end = begin - timedelta(days=1)
        time.sleep(0.25)
    return points


def parse_twelve_data(reply: dict) -> dict[date, float]:
    if reply.get("status") == "error":
        raise RuntimeError(f"Twelve Data: {reply.get('message')}")
    return {date.fromisoformat(row["datetime"][:10]): float(row["close"]) for row in reply.get("values", [])}


def stock_series(symbol: str, key: str) -> dict[date, float]:
    reply = http.get_json(TWELVE_DATA, params={"symbol": symbol, "interval": "1day", "outputsize": 5000, "start_date": START.isoformat(), "apikey": key})
    return parse_twelve_data(reply)


def sa_inflation() -> dict[str, float]:
    reply = http.get_json(WORLD_BANK, params={"format": "json", "per_page": 30})
    return {row["date"]: round(row["value"], 2) for row in reply[1] if row["value"] is not None and int(row["date"]) >= START.year}


def build(today: date) -> dict:
    assets: dict[str, dict] = {}
    notes: list[str] = []

    def add(symbol: str, name: str, kind: str, source: str, points: dict[date, float]) -> None:
        start, closes = to_calendar(points)
        assets[symbol] = {"name": name, "kind": kind, "source": source, "start": start, "closes": closes}
        print(f"  {symbol:7} {start} to {today}, {len(closes)} days")

    for symbol, name in CRYPTO.items():
        add(symbol, name, "crypto", "Coinbase", coinbase_series(symbol, today))
    for symbol, (series, name, kind) in FRED_ASSETS.items():
        add(symbol, name, kind, "FRED", fred_series(series))

    key = os.environ.get("TWELVE_DATA_API_KEY")
    if key:
        for symbol, name in STOCKS.items():
            try:
                add(symbol, name, "stock", "Twelve Data", stock_series(symbol, key))
            except Exception as error:  # a symbol a key can't reach shouldn't lose the rest
                notes.append(f"{symbol}: {error}")
                print(f"  {symbol} skipped: {error}")
            time.sleep(8)  # the free tier allows 8 calls a minute
    else:
        notes.append("Stocks are off: TWELVE_DATA_API_KEY is not set.")

    context = {}
    for series, (name, unit) in CONTEXT.items():
        start, values = to_calendar(fred_series(series))
        context[series] = {"name": name, "unit": unit, "source": "FRED", "start": start, "values": values}

    return {"generated_at": now_iso(), "assets": assets, "context": context, "sa_inflation": sa_inflation(), "notes": notes}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=Path("../data/history"))
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    data = build(datetime.now(timezone.utc).date())
    path = args.out / "history.json"
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(data['assets'])} assets, {path.stat().st_size // 1024} KB. {' '.join(data['notes'])}")


if __name__ == "__main__":
    main()
