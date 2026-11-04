"""Finds unusual market episodes in the price history and sorts them by type (subtasks 9.2 to 9.4, 9.8).

    python -m pulse_pipeline.anomalies --history ../data/history/history.json --out ../data/anomalies

Detection is a rule, not a model. A day is flagged when its 1-day or 3-day return passes either test:
- Sudden: at least Z_MIN standard deviations from that asset's previous 90 trading days, and large in absolute terms.
- Rare: among the asset's largest RARE_SHARE of moves over its whole history. The first test alone misses big falls
  in already turbulent months, when recent volatility is high. This one looks at the whole record, which is fine for
  a library of past events but means it can't be used to spot anything live.
Flagged days close together become one episode, and episodes in different assets that overlap are merged, so one market event
appears once. Each episode's type comes from Muse Spark reading that week's headlines (GDELT); without headlines or
an API key it stays "uncategorised". Results for episodes already categorised are reused.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from datetime import date, timedelta
from pathlib import Path

from . import http, llm
from .dataset import append_jsonl, read_jsonl
from .records import now_iso

WINDOW = 90
Z_MIN = 4.0
RARE_SHARE = 0.015
MIN_MOVE = {"crypto": 0.08, "forex": 0.015, "commodity": 0.05, "stock": 0.04}
MERGE_DAYS = 5
FOLLOW_DAYS = 30
KNOWN_EVENT_TOLERANCE = 3

CATEGORIES = {
    "crash": "A broad, fast fall in prices",
    "rally": "A broad, fast rise in prices",
    "bubble_top": "The sharp end of a long run-up",
    "flash_crash": "A fall that mostly reversed within days",
    "short_squeeze": "A rise forced by traders closing bets against the asset",
    "depeg": "A stablecoin or pegged asset losing its peg",
    "exchange_failure": "A hack or the failure of an exchange or lender",
    "regulation": "A government or regulator's action",
    "rate_shock": "A surprise in interest rates or central bank policy",
    "currency_shock": "A sharp move in a currency from politics or capital flows",
    "supply_shock": "A sudden change in supply, such as oil or mining",
    "geopolitical": "War, sanctions or a major political event",
    "uncategorised": "No category yet",
}

GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_WAIT = 8  # GDELT asks for one request every 5 seconds, and counts refused requests too
GDELT_BACKOFF = 45
SEARCH = {"crypto": "(bitcoin OR crypto OR cryptocurrency)", "forex": "(rand OR \"South Africa\")", "commodity": "(\"oil price\" OR crude)", "stock": "(stocks OR \"wall street\")"}


def returns(closes: list[float], start: str) -> list[tuple[date, float]]:
    """Daily returns on trading days. Days carried forward over a weekend are dropped so they don't shrink volatility."""
    first = date.fromisoformat(start)
    series: list[tuple[date, float]] = []
    previous = closes[0]
    for offset, close in enumerate(closes[1:], start=1):
        if close == previous:
            continue
        # abs() keeps the sign right through oil's negative close in April 2020.
        series.append((first + timedelta(days=offset), (close - previous) / abs(previous)))
        previous = close
    return series


def rare_cutoff(values: list[float], share: float) -> float:
    """The size a move must reach to be in the largest ``share`` of moves."""
    ordered = sorted((abs(v) for v in values), reverse=True)
    return ordered[max(0, int(len(ordered) * share) - 1)]


def flag_days(closes: list[float], start: str, kind: str, z_min: float = Z_MIN, rare_share: float = RARE_SHARE) -> list[dict]:
    series = returns(closes, start)
    three = [sum(r for _, r in series[i - 2 : i + 1]) if i >= 2 else 0.0 for i in range(len(series))]
    floor = MIN_MOVE[kind]
    rare1 = rare_cutoff([r for _, r in series], rare_share)
    rare3 = rare_cutoff(three, rare_share)
    flagged = []
    for i in range(WINDOW, len(series)):
        day, move = series[i]
        past = [r for _, r in series[i - WINDOW : i]]
        mean, deviation = statistics.fmean(past), statistics.stdev(past)
        past3 = three[i - WINDOW : i]
        mean3, deviation3 = statistics.fmean(past3), statistics.stdev(past3)
        z1 = (move - mean) / deviation if deviation else 0.0
        z3 = (three[i] - mean3) / deviation3 if deviation3 else 0.0
        if (abs(z1) >= z_min and abs(move) >= floor) or abs(move) >= rare1:
            flagged.append({"day": day, "move": move, "z": z1})
        elif (abs(z3) >= z_min and abs(three[i]) >= floor * 1.5) or abs(three[i]) >= rare3:
            flagged.append({"day": day, "move": three[i], "z": z3})
    return flagged


def group_days(symbol: str, flagged: list[dict]) -> list[dict]:
    """Flagged days within MERGE_DAYS of each other, as one run per asset."""
    runs: list[dict] = []
    for item in flagged:
        if runs and (item["day"] - runs[-1]["end"]).days <= MERGE_DAYS:
            run = runs[-1]
            run["end"] = item["day"]
            if abs(item["z"]) > abs(run["z"]):
                run.update(peak=item["day"], z=item["z"])
        else:
            runs.append({"symbol": symbol, "start": item["day"], "end": item["day"], "peak": item["day"], "z": item["z"]})
    return runs


def merge_runs(runs: list[dict]) -> list[dict]:
    """Runs in any assets that overlap or nearly touch become one episode."""
    episodes: list[dict] = []
    for run in sorted(runs, key=lambda r: r["start"]):
        if episodes and (run["start"] - episodes[-1]["end"]).days <= 2:
            episode = episodes[-1]
            episode["end"] = max(episode["end"], run["end"])
            episode["runs"].append(run)
        else:
            episodes.append({"start": run["start"], "end": run["end"], "runs": [run]})
    return episodes


def close_on(asset: dict, day: date) -> float | None:
    index = (day - date.fromisoformat(asset["start"])).days
    return asset["closes"][index] if 0 <= index < len(asset["closes"]) else None


def change(asset: dict, before: date, after: date) -> float | None:
    first, last = close_on(asset, before), close_on(asset, after)
    return None if first is None or last is None or first == 0 else round((last - first) / abs(first), 4)


def describe(episode: dict, assets: dict) -> dict:
    moves = []
    for run in sorted(episode["runs"], key=lambda r: -abs(r["z"])):
        asset = assets[run["symbol"]]
        moves.append(
            {
                "asset": run["symbol"],
                "name": asset["name"],
                "kind": asset["kind"],
                "peak_day": run["peak"].isoformat(),
                "z": round(run["z"], 1),
                "move": change(asset, episode["start"] - timedelta(days=1), episode["end"]),
                "next_30_days": change(asset, episode["end"], episode["end"] + timedelta(days=FOLLOW_DAYS)),
            }
        )
    return {"id": episode["start"].isoformat(), "start": episode["start"].isoformat(), "end": episode["end"].isoformat(), "assets": moves}


def detect(history: dict, z_min: float = Z_MIN, rare_share: float = RARE_SHARE) -> list[dict]:
    runs = []
    for symbol, asset in history["assets"].items():
        runs.extend(group_days(symbol, flag_days(asset["closes"], asset["start"], asset["kind"], z_min, rare_share)))
    return [describe(episode, history["assets"]) for episode in merge_runs(runs)]


def recall(episodes: list[dict], known: list[dict], assets: dict) -> dict:
    """The share of known events, in assets with data, that fall within an episode for that asset."""
    tolerance = timedelta(days=KNOWN_EVENT_TOLERANCE)
    found, missed = [], []
    for event in known:
        day = date.fromisoformat(event["date"])
        if event["asset"] not in assets:
            continue
        hit = any(
            date.fromisoformat(e["start"]) - tolerance <= day <= date.fromisoformat(e["end"]) + tolerance and any(m["asset"] == event["asset"] for m in e["assets"])
            for e in episodes
        )
        (found if hit else missed).append(event)
    total = len(found) + len(missed)
    return {"found": len(found), "total": total, "recall": round(len(found) / total, 3) if total else None, "missed": missed}


# Categorising


def headlines_for(episode: dict) -> list[dict]:
    """English headlines from the episode's peak, from GDELT, which covers 2017 onward."""
    start = date.fromisoformat(episode["start"])
    if start < date(2017, 3, 1):
        return []
    peak = date.fromisoformat(episode["assets"][0]["peak_day"])
    query = f"{SEARCH[episode['assets'][0]['kind']]} sourcelang:english"
    try:
        reply = http.request(
            GDELT,
            params={
                "query": query,
                "mode": "artlist",
                "format": "json",
                "maxrecords": 25,
                "sort": "hybridrel",
                "startdatetime": (peak - timedelta(days=1)).strftime("%Y%m%d000000"),
                "enddatetime": (peak + timedelta(days=2)).strftime("%Y%m%d000000"),
            },
            attempts=1,  # a quick retry only prolongs a 429
            timeout=60,
        )
    finally:
        time.sleep(GDELT_WAIT)  # also after a refusal, or one 429 turns into a run of them
    articles = json.loads(reply).get("articles", []) if reply.strip().startswith(b"{") else []
    seen, result = set(), []
    for article in articles:
        title = article.get("title", "").strip()
        if title and title.lower() not in seen:
            seen.add(title.lower())
            result.append({"title": title, "url": article.get("url"), "source": article.get("domain")})
    return result[:12]


def category_prompt(episode: dict, headlines: list[dict]) -> str:
    moves = "; ".join(f"{m['name']} {m['move']:+.1%}" for m in episode["assets"] if m["move"] is not None)
    options = "\n".join(f"- {name}: {meaning}" for name, meaning in CATEGORIES.items())
    titles = "\n".join(f"{i + 1}. {h['title']}" for i, h in enumerate(headlines))
    return (
        f"A market episode ran from {episode['start']} to {episode['end']}. Moves: {moves}.\n\n"
        f"Headlines from that time:\n{titles}\n\nChoose the one category that fits, using only these headlines and moves:\n{options}\n\n"
        'If the headlines don\'t explain the moves, use "uncategorised". Answer with JSON only: '
        '{"category": "<name>", "summary": "<one plain sentence on what happened, past tense, under 30 words>", "headlines": [<numbers of the headlines you relied on>]}'
    )


def parse_category(text: str, headlines: list[dict]) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if data.get("category") not in CATEGORIES or not isinstance(data.get("summary"), str):
        return None
    used = [headlines[n - 1] for n in data.get("headlines", []) if isinstance(n, int) and 1 <= n <= len(headlines)]
    return {"category": data["category"], "summary": data["summary"].strip(), "headlines": used[:4]}


def saved_row(episode: dict, known: dict[str, dict]) -> dict | None:
    """The stored result for an episode. New data can move an episode's start, so a row dated inside it still counts."""
    if episode["id"] in known:
        return known[episode["id"]]
    inside = [day for day in known if episode["start"] <= day <= episode["end"] and known[day]["category"] != "uncategorised"]
    return known[min(inside)] if inside else None


def categorise(episodes: list[dict], store: Path, limit: int, minutes: float = 35) -> int:
    """Adds category, summary and headlines to each episode; new ones cost a GDELT call and a model call.

    Stops looking up new episodes at the limit or the time budget, so a run always ends with its results saved.
    """
    known = {row["id"]: row for row in read_jsonl(store)}
    done = 0
    deadline = time.monotonic() + minutes * 60
    for episode in sorted(episodes, key=lambda e: -abs(e["assets"][0]["z"])):
        episode.update({"category": "uncategorised", "summary": None, "headlines": []})
        row = saved_row(episode, known)
        if row is None and llm.available() and done < limit and time.monotonic() < deadline:
            try:
                headlines = headlines_for(episode)
                result = parse_category(llm.complete([{"role": "user", "content": category_prompt(episode, headlines)}], max_tokens=1500, effort="low"), headlines) if headlines else None
            except http.HttpError as error:  # one failed lookup leaves the episode for the next run
                print(f"  {episode['id']} failed: {str(error)[:80]}")
                if error.status == 429:
                    time.sleep(GDELT_BACKOFF)
                continue
            except Exception as error:
                print(f"  {episode['id']} failed: {str(error)[:80]}")
                continue
            if result:
                row = {"id": episode["id"], "by": llm.MODEL, "at": now_iso(), **result}
                append_jsonl(store, [row])
                done += 1
                print(f"  {episode['id']} {result['category']}: {result['summary']}")
            else:
                print(f"  {episode['id']} left uncategorised")
        if row is not None:
            episode.update({k: row[k] for k in ("category", "summary", "headlines")})
    return done


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--history", type=Path, default=Path("../data/history/history.json"))
    parser.add_argument("--known", type=Path, default=Path("known_events.json"))
    parser.add_argument("--out", type=Path, default=Path("../data/anomalies"))
    parser.add_argument("--max-new", type=int, default=120)
    parser.add_argument("--max-minutes", type=float, default=35)
    args = parser.parse_args(argv)

    history = json.loads(args.history.read_text(encoding="utf-8"))
    episodes = detect(history)
    measured = recall(episodes, json.loads(args.known.read_text(encoding="utf-8"))["events"], history["assets"])
    args.out.mkdir(parents=True, exist_ok=True)
    new = categorise(episodes, args.out / "categories.jsonl", args.max_new, args.max_minutes)
    episodes.sort(key=lambda e: e["start"], reverse=True)
    result = {
        "generated_at": now_iso(),
        "method": {"z_min": Z_MIN, "rare_share": RARE_SHARE, "window_days": WINDOW, "min_move": MIN_MOVE, "categoriser": llm.MODEL, "headlines": "GDELT"},
        "categories": CATEGORIES,
        "known_events": measured,
        "episodes": episodes,
    }
    (args.out / "anomalies.json").write_text(json.dumps(result, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(episodes)} episodes, {new} newly categorised. Known events found: {measured['found']} of {measured['total']}.")
    for event in measured["missed"]:
        print(f"  missed {event['date']} {event['asset']}: {event['event']}")


if __name__ == "__main__":
    main()
