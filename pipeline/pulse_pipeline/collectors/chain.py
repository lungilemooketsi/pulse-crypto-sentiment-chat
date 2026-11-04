"""Transfer collectors: large moves onto and off exchanges from Arkham, and watched wallets through Esplora (2.7)
and Etherscan (2.6), which stay available for wallets listed by hand in wallets.json.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .. import http
from ..records import Transfer, to_iso

WALLETS_FILE = Path(__file__).resolve().parents[2] / "wallets.json"

# mempool.space first; Blockstream runs the same Esplora API and answers when mempool.space doesn't.
ESPLORA = ["https://mempool.space/api", "https://blockstream.info/api"]
ETHERSCAN = "https://api.etherscan.io/v2/api"

ARKHAM_TRANSFERS = "https://api.arkm.com/transfers"
ARKHAM_EXPLORER = "https://intel.arkm.com/explorer/tx/"
# Each row costs 2 credits, and a free trial pauses at its cap, so a run stays small.
ARKHAM_QUERY = {"base": "type:cex", "chains": "bitcoin,ethereum,solana", "usdGte": 10_000_000, "timeLast": "4h", "limit": 30}
NATIVE = {"bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL"}
# Only these kinds of organisation are named. Anything else, a person included, stays an unnamed wallet.
NAMED_TYPES = {"cex", "fund", "dex", "stablecoin", "lending-decentralized", "yield", "liquid-staking", "cdp"}

# Smallest move worth recording, per asset.
MIN_AMOUNT = {"BTC": 10.0, "ETH": 100.0, "USDT": 1_000_000.0, "USDC": 1_000_000.0, "WBTC": 10.0}

# ERC-20 tokens followed on Ethereum: contract address -> (symbol, decimals).
TOKENS = {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": ("USDT", 6),
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": ("USDC", 6),
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": ("WBTC", 8),
}


def load_wallets(chain: str, path: Path = WALLETS_FILE) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    wallets = [wallet for wallet in data["wallets"] if wallet["chain"] == chain]
    if not wallets:
        raise http.MissingCredentials(f"No {chain} wallets in {path.name} yet (subtask 2.5).")
    return wallets


# Bitcoin


def _esplora(path: str) -> list | dict:
    last: Exception | None = None
    for base in ESPLORA:
        try:
            return http.get_json(f"{base}{path}", attempts=2, timeout=20)
        except Exception as error:  # try the next Esplora host
            last = error
    raise RuntimeError(f"No Esplora host answered {path}: {last}")


def parse_esplora(wallet: dict, txs: list[dict]) -> list[Transfer]:
    address = wallet["address"]
    transfers = []
    for tx in txs:
        status = tx.get("status", {})
        if not status.get("confirmed"):
            continue
        sent = sum(v["prevout"]["value"] for v in tx["vin"] if v.get("prevout", {}).get("scriptpubkey_address") == address)
        received = sum(o["value"] for o in tx["vout"] if o.get("scriptpubkey_address") == address)
        net = (received - sent) / 1e8
        if abs(net) < MIN_AMOUNT["BTC"]:
            continue
        if net > 0:
            others = [v.get("prevout", {}).get("scriptpubkey_address") for v in tx["vin"]]
        else:
            others = [o.get("scriptpubkey_address") for o in tx["vout"]]
        counterparty = next((other for other in others if other and other != address), None)
        transfers.append(
            Transfer(
                source="esplora",
                chain="bitcoin",
                tx_hash=tx["txid"],
                url=f"https://mempool.space/tx/{tx['txid']}",
                created_at=to_iso(status["block_time"]),
                wallet=address,
                wallet_label=wallet["label"],
                wallet_kind=wallet["kind"],
                direction="in" if net > 0 else "out",
                asset="BTC",
                amount=round(abs(net), 8),
                counterparty=counterparty,
            )
        )
    return transfers


def collect_bitcoin(path: Path = WALLETS_FILE) -> list[Transfer]:
    transfers: list[Transfer] = []
    for wallet in load_wallets("bitcoin", path):
        transfers.extend(parse_esplora(wallet, _esplora(f"/address/{wallet['address']}/txs")))
        time.sleep(0.5)
    return transfers


# Ethereum


def _etherscan(params: dict) -> list[dict]:
    key = os.environ.get("ETHERSCAN_API_KEY")
    if not key:
        raise http.MissingCredentials("Set ETHERSCAN_API_KEY (free at etherscan.io/myapikey).")
    reply = http.get_json(ETHERSCAN, params={"chainid": 1, "page": 1, "offset": 100, "sort": "desc", "apikey": key, **params})
    if reply.get("status") == "1":
        return reply["result"]
    if reply.get("message", "").startswith("No transactions"):
        return []
    raise RuntimeError(f"Etherscan: {reply.get('message')}: {reply.get('result')}")


def parse_etherscan(wallet: dict, rows: list[dict], token: bool) -> list[Transfer]:
    address = wallet["address"].lower()
    transfers = []
    for row in rows:
        if row.get("isError") == "1":
            continue
        if token:
            contract = row.get("contractAddress", "").lower()
            if contract not in TOKENS:
                continue
            asset, decimals = TOKENS[contract]
        else:
            asset, decimals = "ETH", 18
        amount = int(row["value"]) / 10**decimals
        if amount < MIN_AMOUNT[asset]:
            continue
        incoming = row["to"].lower() == address
        transfers.append(
            Transfer(
                source="etherscan",
                chain="ethereum",
                tx_hash=row["hash"],
                url=f"https://etherscan.io/tx/{row['hash']}",
                created_at=to_iso(int(row["timeStamp"])),
                wallet=address,
                wallet_label=wallet["label"],
                wallet_kind=wallet["kind"],
                direction="in" if incoming else "out",
                asset=asset,
                amount=round(amount, 6),
                counterparty=(row["from"] if incoming else row["to"]).lower() or None,
            )
        )
    return transfers


def collect_ethereum(path: Path = WALLETS_FILE) -> list[Transfer]:
    transfers: list[Transfer] = []
    for wallet in load_wallets("ethereum", path):
        for action, token in (("txlist", False), ("tokentx", True)):
            rows = _etherscan({"module": "account", "action": action, "address": wallet["address"]})
            transfers.extend(parse_etherscan(wallet, rows, token))
            time.sleep(0.3)  # the free tier allows 5 calls a second
    return transfers


# Arkham


def _side(row: dict, name: str) -> dict:
    """One end of a transfer. UTXO chains can list several addresses, so the first stands for that side."""
    single = row.get(f"{name}Address")
    if single:
        return single
    several = row.get(f"{name}Addresses") or [{}]
    return several[0].get("address", several[0])


def _entity(side: dict) -> dict:
    return side.get("arkhamEntity") or {}


def _organisation(side: dict) -> str | None:
    entity = _entity(side)
    return entity.get("name") if entity.get("type") in NAMED_TYPES else None


def parse_arkham(rows: list[dict]) -> list[Transfer]:
    """Moves between an exchange and anywhere else. A move inside one exchange is housekeeping, so it is dropped."""
    transfers = []
    for row in rows:
        source, target = _side(row, "from"), _side(row, "to")
        into = _entity(target).get("type") == "cex"
        out_of = _entity(source).get("type") == "cex"
        if not (into or out_of) or _entity(source).get("id") == _entity(target).get("id"):
            continue
        exchange, other = (target, source) if into else (source, target)
        chain = row.get("chain", "")
        transfers.append(
            Transfer(
                source="arkham",
                chain=chain,
                tx_hash=row["transactionHash"],
                url=f"{ARKHAM_EXPLORER}{row['transactionHash']}",
                created_at=to_iso(row["blockTimestamp"]),
                wallet=exchange.get("address", ""),
                wallet_label=_entity(exchange)["name"],
                wallet_kind="exchange",
                direction="in" if into else "out",
                asset=(row.get("tokenSymbol") or NATIVE.get(chain, "")).upper(),
                amount=round(float(row.get("unitValue") or 0), 6),
                counterparty=_organisation(other),
                usd=round(float(row.get("historicalUSD") or 0), 2),
            )
        )
    return transfers


def collect_arkham() -> list[Transfer]:
    key = os.environ.get("ARKHAM_API_KEY")
    if not key:
        raise http.MissingCredentials("Set ARKHAM_API_KEY (an Arkham API key).")
    return parse_arkham(http.get_json(ARKHAM_TRANSFERS, params=ARKHAM_QUERY, headers={"API-Key": key}, attempts=1).get("transfers", []))
