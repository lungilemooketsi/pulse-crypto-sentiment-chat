# Pulse data pipeline

Collects the posts and on-chain transfers that Pulse's sentiment model and whale alerts are built from. Python 3.12+, standard library only.

```sh
cd pipeline
python -m pulse_pipeline.collect --out ../data/raw            # every source
python -m pulse_pipeline.collect --out ../data/raw --only rss # one source
python -m unittest -v                                          # parser tests, no network
```

The `Collect` workflow runs every 3 hours and commits new files to the `data` branch.

## Labels and baselines

```sh
pip install -r requirements-ml.txt
python -m pulse_pipeline.label hand   # label 300 posts by hand (resumable: q to stop)
python -m pulse_pipeline.label draft  # LLM drafts for about 3,000 more (needs MODEL_API_KEY, a Meta Model API key)
python -m pulse_pipeline.label audit  # re-label 10% of the drafts blind, then report agreement
python -m pulse_pipeline.train classic  # VADER, TF-IDF + logistic regression, macro-F1 against Muse Spark
python -m pulse_pipeline.score --weights <folder>  # label recent posts with the published model
```

Run these from `pipeline/` with the `data` branch checked out at `../data` (`git worktree add ../data data`). Labels go to `data/labels/` and results to `data/results/`.

- **Labelling rules:** [LABELLING.md](LABELLING.md). Hand labels, audits and LLM drafts all follow it.
- **Splits:** by time only. The test set is the latest 30% of hand-labelled posts, and training uses only posts created before it starts.
- **Drafts:** if the audit agrees with them less than 80% of the time, they aren't used.
- **Price tests:** [PRICE_TEST.md](PRICE_TEST.md) fixes their method before any results exist.

## History and anomalies

```sh
python -m pulse_pipeline.history --out ../data/history                # daily closes for the Lab and the library
python -m pulse_pipeline.anomalies --history ../data/history/history.json --out ../data/anomalies
```

The `History` workflow runs both once a day, commits to the `data` branch and deploys.

- **Sources:** Coinbase candles for crypto; FRED for USD/ZAR, WTI oil and US rates (public-domain series only, so not the S&P 500 or Nasdaq); World Bank for South African inflation.
- **Stocks and ETFs** come from Twelve Data and switch on when the repository secret `TWELVE_DATA_API_KEY` exists. They then appear in the Lab and the library by themselves.
- **Detection** is written up on the model card and at the top of `anomalies.py`. [known_events.json](known_events.json) is its test list.
- **Categories** come from Muse Spark reading GDELT headlines, and are stored in `data/anomalies/categories.jsonl` so each episode is only categorised once. GDELT allows one request every 5 seconds.

## Sources

| Source | Collects | Needs |
| --- | --- | --- |
| `rss` | Headlines from CoinDesk, Cointelegraph, Decrypt, Bitcoin Magazine and The Block | Nothing |
| `bluesky` | Latest English posts naming each tracked coin, through `api.bsky.app` | Nothing |
| `finnhub` | Company news for each stock and ETF | `FINNHUB_API_KEY` |
| `arkham` | Moves of $10M or more onto and off exchanges on Bitcoin, Ethereum and Solana. Costs 2 credits a row, at most 30 rows a run | `ARKHAM_API_KEY` |
| `esplora` | Large moves by watched Bitcoin wallets, through mempool.space (Blockstream as fallback) | Wallets in `wallets.json` |
| `etherscan` | Large ETH, USDT, USDC and WBTC moves by watched Ethereum wallets | `ETHERSCAN_API_KEY`, wallets in `wallets.json` |

A source without what it needs is skipped and noted in `_runs.jsonl`. It doesn't fail the run.

Posts are kept only when they name a tracked coin, using the same rules as the app (`coins.json` is copied from `src/lib/market.ts`; keep them in step). Name searches also catch off-topic posts, such as "Tron" the film or "Polygon" in 3D art, so labelling has an off-topic class.

"Large" means at least 10 BTC or WBTC, 100 ETH, or 1,000,000 USDT or USDC (`MIN_AMOUNT` in `collectors/chain.py`).

## Setup

1. **Etherscan:** create a free key at [etherscan.io/myapikey](https://etherscan.io/myapikey) and add it as the secret `ETHERSCAN_API_KEY`.
2. **Wallets:** add exchange and whale wallets to `wallets.json` from [Arkham](https://intel.arkm.com)'s free website. Add only addresses Arkham attributes, and never guess:

   ```json
   {"chain": "ethereum", "address": "0x…", "label": "Exchange name, hot wallet", "kind": "exchange"}
   ```

   `kind` is `exchange`, `whale`, `fund` or `other`. Exchange wallets give the direction feature in phase 5: a move onto an exchange is often a sale.

## Data format

Each source writes JSON Lines to `data/raw/<source>/<YYYY-MM-DD>.jsonl`, one file per UTC day of collection, never rewriting a record it has already saved.

- **Posts** carry `source`, `id`, `url`, `created_at`, `collected_at`, `text`, `coins` (tickers), `author` and `meta` (score, likes, feed). `author` is a 16-character hash of the handle or DID: enough to spot bots and repeat posters without storing who they are.
- **Transfers** carry `chain`, `tx_hash`, `url`, `created_at`, `wallet`, `wallet_label`, `wallet_kind`, `direction` (`in` or `out`), `asset`, `amount` and `counterparty`.

Each run appends a line to `data/raw/_runs.jsonl` with what every source fetched, saved, skipped or failed.
