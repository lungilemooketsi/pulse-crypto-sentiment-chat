"""Post collectors: Bluesky (2.3), crypto news RSS (2.4) and stock news from Finnhub (7.4).

Bluesky and RSS posts are kept only when they mention a tracked coin, using the app's coin rules.
"""

from __future__ import annotations

import html
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from .. import http
from ..coins import STOCKS, detect_coins, search_terms
from ..records import Post, hash_author, to_iso

FEEDS = {
    "coindesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "cointelegraph": "https://cointelegraph.com/rss",
    "decrypt": "https://decrypt.co/feed",
    "bitcoinmagazine": "https://bitcoinmagazine.com/.rss/full/",
    "theblock": "https://www.theblock.co/rss.xml",
}

FINNHUB_NEWS = "https://finnhub.io/api/v1/company-news"

# api.bsky.app answers keyless searches; public.api.bsky.app returns 403 for searchPosts.
BLUESKY_SEARCH = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts"


def _clean(text: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()


# Bluesky


def parse_bluesky(reply: dict) -> list[Post]:
    posts = []
    for item in reply.get("posts", []):
        record = item.get("record", {})
        text = _clean(record.get("text", ""))
        coins = detect_coins(text)
        if not coins:
            continue
        handle = item.get("author", {}).get("handle", "")
        rkey = item["uri"].rsplit("/", 1)[-1]
        posts.append(
            Post(
                source="bluesky",
                id=item["uri"],
                url=f"https://bsky.app/profile/{handle}/post/{rkey}",
                created_at=to_iso(record.get("createdAt") or item["indexedAt"]),
                text=text,
                coins=coins,
                author=hash_author(item.get("author", {}).get("did")),
                meta={
                    "likes": item.get("likeCount"),
                    "reposts": item.get("repostCount"),
                    "replies": item.get("replyCount"),
                    "lang": (record.get("langs") or [None])[0],
                },
            )
        )
    return posts


def collect_bluesky() -> list[Post]:
    posts: list[Post] = []
    for term in search_terms():
        reply = http.get_json(BLUESKY_SEARCH, params={"q": term, "sort": "latest", "limit": 100, "lang": "en"})
        posts.extend(parse_bluesky(reply))
        time.sleep(0.5)
    return posts


# News RSS


def parse_rss(feed: str, xml_bytes: bytes) -> list[Post]:
    root = ET.fromstring(xml_bytes)
    posts = []
    for item in root.iter("item"):
        title = _clean(item.findtext("title") or "")
        summary = _clean(item.findtext("description") or "")
        text = f"{title}. {summary}" if summary else title
        coins = detect_coins(text)
        link = (item.findtext("link") or "").strip()
        published = item.findtext("pubDate")
        if not coins or not link or not published:
            continue
        posts.append(
            Post(
                source="rss",
                id=link,
                url=link,
                created_at=parsedate_to_datetime(published).astimezone().isoformat(timespec="seconds"),
                text=text[:2000],
                coins=coins,
                meta={"feed": feed, "headline": title},
            )
        )
    return posts


def collect_rss() -> list[Post]:
    """Every feed that answers; a feed that blocks or breaks is skipped. Fails only if none answer."""
    posts: list[Post] = []
    failed: dict[str, str] = {}
    for feed, url in FEEDS.items():
        try:
            posts.extend(parse_rss(feed, http.request(url)))
        except Exception as error:  # one blocked feed (some sit behind bot checks) shouldn't lose the rest
            failed[feed] = f"{type(error).__name__}: {str(error)[:120]}"
            print(f"  rss feed {feed} skipped: {failed[feed]}")
    if len(failed) == len(FEEDS):
        raise RuntimeError(f"No news feed answered: {failed}")
    for post in posts:
        post.created_at = to_iso(post.created_at)
    return posts


# Stock news


def parse_finnhub(symbol: str, articles: list[dict]) -> list[Post]:
    posts = []
    for item in articles:
        title = _clean(item.get("headline") or "")
        summary = _clean(item.get("summary") or "")
        link = (item.get("url") or "").strip()
        if not title or not link or not item.get("datetime"):
            continue
        posts.append(
            Post(
                source="finnhub",
                id=f"{symbol}:{item.get('id') or link}",  # one story can cover several companies
                url=link,
                created_at=to_iso(item["datetime"]),
                text=f"{title}. {summary}"[:2000] if summary else title,
                coins=[symbol],
                meta={"feed": item.get("source"), "headline": title},
            )
        )
    return posts


def collect_finnhub() -> list[Post]:
    """Yesterday's and today's news per stock. A symbol with no answer is skipped; fails only if none answer."""
    key = os.environ.get("FINNHUB_API_KEY")
    if not key:
        raise http.MissingCredentials("Set FINNHUB_API_KEY (a free key from finnhub.io).")
    today = datetime.now(timezone.utc).date()
    window = {"from": (today - timedelta(days=1)).isoformat(), "to": today.isoformat()}
    posts: list[Post] = []
    failed: dict[str, str] = {}
    for symbol in STOCKS:
        try:
            posts.extend(parse_finnhub(symbol, http.get_json(FINNHUB_NEWS, params={"symbol": symbol, "token": key, **window})))
        except Exception as error:
            failed[symbol] = type(error).__name__  # never the message, which could carry the key in its URL
            print(f"  finnhub {symbol} skipped: {failed[symbol]}")
        time.sleep(1.1)  # the free tier allows 60 calls a minute
    if len(failed) == len(STOCKS):
        raise RuntimeError(f"No stock news answered: {failed}")
    return posts
