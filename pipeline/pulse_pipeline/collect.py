"""Runs every collector once and writes today's dated files.

    python -m pulse_pipeline.collect --out data/raw [--only bluesky,rss]

A source whose credentials are missing is skipped with a note. A source that fails is reported and the
command exits 1 after the others have run, so one broken source never stops the rest. Each run appends a
line to <out>/_runs.jsonl saying what every source did.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

from . import http
from .collectors import chain, social
from .records import now_iso, write_records

COLLECTORS = {
    "bluesky": social.collect_bluesky,
    "rss": social.collect_rss,
    "finnhub": social.collect_finnhub,
    "arkham": chain.collect_arkham,
    "esplora": chain.collect_bitcoin,
    "etherscan": chain.collect_ethereum,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=Path("data/raw"))
    parser.add_argument("--only", help="comma-separated sources: " + ", ".join(COLLECTORS))
    args = parser.parse_args(argv)

    sources = args.only.split(",") if args.only else list(COLLECTORS)
    unknown = set(sources) - set(COLLECTORS)
    if unknown:
        parser.error(f"unknown source(s): {', '.join(sorted(unknown))}")

    run = {"started_at": now_iso(), "sources": {}}
    failed = False
    for source in sources:
        try:
            records = COLLECTORS[source]()
            new = write_records(args.out, source, records)
            run["sources"][source] = {"status": "ok", "fetched": len(records), "new": new}
            print(f"{source}: {len(records)} fetched, {new} new")
        except http.MissingCredentials as error:
            run["sources"][source] = {"status": "skipped", "reason": str(error)}
            print(f"{source}: skipped. {error}")
        except Exception as error:
            failed = True
            run["sources"][source] = {"status": "failed", "error": f"{type(error).__name__}: {error}"}
            print(f"{source}: FAILED. {type(error).__name__}: {error}", file=sys.stderr)
            traceback.print_exc()

    run["finished_at"] = now_iso()
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "_runs.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(run, sort_keys=True) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
