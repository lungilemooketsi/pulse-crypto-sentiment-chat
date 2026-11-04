// Finds the coins and stocks a message names, and fetches their recent prices. Coins come from CoinGecko's public API,
// which allows browser requests without a key; stocks come from the daily history file.
import { loadHistory } from "./datasets";

const API = "https://api.coingecko.com/api/v3";
const CACHE_MS = 60_000;
const MAX_COINS_PER_MESSAGE = 2;

export type Coin = { id: string; name: string; symbol: string };

// A coin named in a message: either resolved from the list below, or a $cashtag to look up.
export type CoinQuery = { coin: Coin } | { cashtag: string };

export type ChartRange = "1" | "7" | "30";

export type PricePoint = { time: number; price: number };

// Matched by full name (any case) or by ticker written in capitals or as a $cashtag,
// so ordinary words such as "near", "link" or "dot" don't summon a chart.
const KNOWN_COINS: Coin[] = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC" },
  { id: "ethereum", name: "Ethereum", symbol: "ETH" },
  { id: "solana", name: "Solana", symbol: "SOL" },
  { id: "ripple", name: "XRP", symbol: "XRP" },
  { id: "binancecoin", name: "BNB", symbol: "BNB" },
  { id: "dogecoin", name: "Dogecoin", symbol: "DOGE" },
  { id: "cardano", name: "Cardano", symbol: "ADA" },
  { id: "tron", name: "TRON", symbol: "TRX" },
  { id: "hyperliquid", name: "Hyperliquid", symbol: "HYPE" },
  { id: "monero", name: "Monero", symbol: "XMR" },
  { id: "chainlink", name: "Chainlink", symbol: "LINK" },
  { id: "stellar", name: "Stellar", symbol: "XLM" },
  { id: "bitcoin-cash", name: "Bitcoin Cash", symbol: "BCH" },
  { id: "near", name: "NEAR Protocol", symbol: "NEAR" },
  { id: "uniswap", name: "Uniswap", symbol: "UNI" },
  { id: "litecoin", name: "Litecoin", symbol: "LTC" },
  { id: "avalanche-2", name: "Avalanche", symbol: "AVAX" },
  { id: "sui", name: "Sui", symbol: "SUI" },
  { id: "shiba-inu", name: "Shiba Inu", symbol: "SHIB" },
  { id: "pepe", name: "Pepe", symbol: "PEPE" },
  { id: "polkadot", name: "Polkadot", symbol: "DOT" },
  { id: "arbitrum", name: "Arbitrum", symbol: "ARB" },
  { id: "polygon-ecosystem-token", name: "Polygon", symbol: "POL" },
  { id: "aptos", name: "Aptos", symbol: "APT" },
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Names that are also everyday words only match when capitalised.
const CASE_SENSITIVE_NAMES = new Set(["Sui", "Pepe", "Stellar", "Avalanche"]);

// Tickers that are never ordinary words also match in lower case ("btc", "eth").
const ANY_CASE_TICKERS = new Set(["BTC", "ETH", "BNB", "DOGE", "TRX", "XMR", "XLM", "BCH", "LTC", "AVAX", "SHIB"]);

// Stocks and ETFs in the daily history file (pipeline/pulse_pipeline/history.py). Names match only when capitalised
// and tickers only in capitals or as a $cashtag. They stay off until enableStocks says the history has them.
const STOCKS: Coin[] = [
  { id: "stock:SPY", name: "SPDR S&P 500 ETF", symbol: "SPY" },
  { id: "stock:QQQ", name: "Invesco QQQ ETF", symbol: "QQQ" },
  { id: "stock:VTI", name: "Vanguard Total Stock Market ETF", symbol: "VTI" },
  { id: "stock:AAPL", name: "Apple", symbol: "AAPL" },
  { id: "stock:MSFT", name: "Microsoft", symbol: "MSFT" },
  { id: "stock:NVDA", name: "Nvidia", symbol: "NVDA" },
  { id: "stock:AMZN", name: "Amazon", symbol: "AMZN" },
  { id: "stock:GOOGL", name: "Alphabet", symbol: "GOOGL" },
  { id: "stock:META", name: "Meta Platforms", symbol: "META" },
  { id: "stock:TSLA", name: "Tesla", symbol: "TSLA" },
];

let enabledStocks = new Set<string>();

/** Turns on chat detection for the stocks the history file actually holds. */
export function enableStocks(symbols: string[]) {
  enabledStocks = new Set(symbols);
}

const isStock = (id: string) => id.startsWith("stock:");

const wholeWord = (text: string, flags = "") => new RegExp(`(^|[^\\w$])${escape(text)}(?![\\w])`, flags);

const matcher = (coin: Coin, nameFlags: string, tickerFlags: string) => ({
  coin,
  name: wholeWord(coin.name, nameFlags),
  ticker: wholeWord(coin.symbol, tickerFlags),
  cashtag: new RegExp(`\\$${escape(coin.symbol)}(?![\\w])`, "i"),
});

const stockMatchers = STOCKS.map((coin) => matcher(coin, "", ""));

const matchers = KNOWN_COINS.map((coin) =>
  matcher(coin, CASE_SENSITIVE_NAMES.has(coin.name) ? "" : "i", ANY_CASE_TICKERS.has(coin.symbol) ? "i" : ""),
);

// "Ether" alone is common shorthand for Ethereum.
const ALIASES: Array<[RegExp, string]> = [[/(^|[^\w$])ether(?![\w])/i, "ethereum"]];

/** The coins a message asks about, in the order they appear, at most two. */
export function detectCoins(text: string): CoinQuery[] {
  type Hit = { start: number; end: number; query: CoinQuery; key: string };
  const hits: Hit[] = [];
  const add = (match: RegExpExecArray | RegExpMatchArray | null, query: CoinQuery, key: string) => {
    if (!match || match.index === undefined) return;
    const start = match.index + (match[1] && !match[0].startsWith("$") ? match[1].length : 0);
    hits.push({ start, end: match.index + match[0].length, query, key });
  };

  const liveStocks = stockMatchers.filter(({ coin }) => enabledStocks.has(coin.symbol));
  for (const { coin, name, ticker, cashtag } of [...matchers, ...liveStocks]) {
    for (const pattern of [name, ticker, cashtag]) add(pattern.exec(text), { coin }, coin.id);
  }

  for (const [pattern, id] of ALIASES) {
    const coin = KNOWN_COINS.find((item) => item.id === id);
    if (coin) add(pattern.exec(text), { coin }, coin.id);
  }

  // Cashtags for coins not in the list are looked up by ticker.
  for (const match of text.matchAll(/\$([a-z][a-z0-9]{1,9})(?![\w])/gi)) {
    const symbol = match[1].toUpperCase();
    const known = KNOWN_COINS.some((coin) => coin.symbol === symbol) || enabledStocks.has(symbol);
    if (!known) add(match, { cashtag: symbol }, `$${symbol}`);
  }

  // "Bitcoin Cash" also contains "Bitcoin": a match inside a longer one is dropped.
  const outer = hits.filter(
    (hit) => !hits.some((other) => other !== hit && other.start <= hit.start && other.end >= hit.end && other.end - other.start > hit.end - hit.start),
  );

  const seen = new Set<string>();
  return outer
    .sort((a, b) => a.start - b.start)
    .filter((hit) => (seen.has(hit.key) ? false : (seen.add(hit.key), true)))
    .slice(0, MAX_COINS_PER_MESSAGE)
    .map((hit) => hit.query);
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly rateLimited = false,
  ) {
    super(message);
  }
}

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  // A failed request is not kept, so Retry asks again.
  value.catch(() => cache.delete(key));
  return value;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal, headers: { Accept: "application/json" } });
  if (response.status === 429) throw new MarketDataError("CoinGecko is limiting requests right now.", true);
  if (!response.ok) throw new MarketDataError(`CoinGecko returned ${response.status}.`);
  return (await response.json()) as T;
}

type SearchResult = { coins: Array<{ id: string; name: string; symbol: string; market_cap_rank: number | null }> };

/** Turns a query into a coin, looking cashtags up on CoinGecko. Null when nothing matches the ticker. */
export function resolveCoin(query: CoinQuery): Promise<Coin | null> {
  if ("coin" in query) return Promise.resolve(query.coin);
  const symbol = query.cashtag;
  return cached(`search:${symbol}`, async () => {
    const result = await getJson<SearchResult>(`/search?query=${encodeURIComponent(symbol)}`);
    const match = result.coins
      .filter((coin) => coin.symbol.toUpperCase() === symbol)
      .sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity))[0];
    return match ? { id: match.id, name: match.name, symbol: match.symbol.toUpperCase() } : null;
  });
}

/** Daily closes from the history file. A stock has no intraday data, so one day shows the last week. */
async function stockHistory(symbol: string, days: ChartRange): Promise<PricePoint[]> {
  const asset = (await loadHistory())?.assets[symbol];
  if (!asset) throw new MarketDataError("Stock prices aren't available right now.");
  const first = Date.parse(`${asset.start}T00:00:00Z`);
  const count = Math.max(Number(days), 7) + 1;
  const offset = Math.max(0, asset.closes.length - count);
  return asset.closes.slice(offset).map((price, index) => ({ time: first + (offset + index) * 86_400_000, price }));
}

/** Prices in US dollars: 5-minute points for one day, hourly for 7 and 30 days. */
export function fetchPriceHistory(coinId: string, days: ChartRange): Promise<PricePoint[]> {
  if (isStock(coinId)) return stockHistory(coinId.slice("stock:".length), days);
  return cached(`chart:${coinId}:${days}`, async () => {
    const result = await getJson<{ prices: Array<[number, number]> }>(
      `/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`,
    );
    const points = result.prices.map(([time, price]) => ({ time, price }));
    if (points.length < 2) throw new MarketDataError("CoinGecko has no recent prices for this coin.");
    return points;
  });
}

const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", ...(value >= 1 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 4 }) });
const change = (from: number, to: number) => `${to >= from ? "+" : ""}${(((to - from) / from) * 100).toFixed(1)}%`;

/** The price figures the chart shows, as a brief for the model. Uses the chart's cached 7-day history. */
async function priceLine(query: CoinQuery): Promise<string | null> {
  const coin = await resolveCoin(query);
  if (!coin) return null;
  const points = await fetchPriceHistory(coin.id, "7");
  const last = points[points.length - 1];
  const dayAgo = points.find((point) => point.time >= last.time - 24 * 3_600_000) ?? points[0];
  const prices = points.map((point) => point.price);
  return (
    `- ${coin.name} (${coin.symbol}): ${usd(last.price)} at ${new Date(last.time).toISOString().slice(0, 16)}Z; ` +
    `24 hours ${change(dayAgo.price, last.price)}, 7 days ${change(points[0].price, last.price)}; ` +
    `7-day low ${usd(Math.min(...prices))}, high ${usd(Math.max(...prices))}`
  );
}

/** CoinGecko price figures for the coins asked about, or null if none could be fetched within 4 seconds. */
export async function priceContext(queries: CoinQuery[]): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
  const lines = await Promise.race([Promise.all(queries.map((query) => priceLine(query).catch(() => null))), timeout]);
  const found = (lines ?? []).filter((line): line is string => Boolean(line));
  if (!found.length) return null;
  return ["Price data in US dollars, the same figures as the chart the user sees. Coins are from CoinGecko; stocks are end-of-day closes from Twelve Data:", ...found].join("\n");
}
