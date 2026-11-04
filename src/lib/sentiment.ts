// The 24-hour sentiment snapshot, built by pipeline/pulse_pipeline/snapshot.py and shipped with each deploy.
export type CoinMood = {
  name: string;
  kind?: "crypto" | "stock";
  posts: number;
  off_topic: number;
  share: { positive: number; neutral: number; negative: number };
  score: number;
  mood: "positive" | "mixed" | "negative";
  sources: Record<string, number>;
  headlines: Array<{ title: string; url: string; feed: string | null; label: string; created_at: string }>;
};

export type LargeMove = { asset: string; usd: number; amount: number; exchange: string; direction: "in" | "out"; counterparty: string | null; at: string; url: string };

export type Snapshot = {
  generated_at: string;
  window: { from: string; to: string };
  method: { labeller: string; labels: string; sources: string; min_posts: number };
  coverage: { posts_in_window: number; labelled: number; labelled_this_run: number };
  coins: Record<string, CoinMood>;
  fear_greed?: { value: number; label: string; at: string } | null;
  large_moves?: LargeMove[];
  model?: { name: string; checked: number; agreement: number | null };
};

// A snapshot older than this is kept out of the model's context. It matches the 24-hour window the mood covers.
export const STALE_MS = 24 * 60 * 60 * 1000;
// From this age, the panel says how old the mood is.
const AGED_MS = 6 * 60 * 60 * 1000;

let request: Promise<Snapshot | null> | null = null;

/** The deployed snapshot, fetched once per page load; null when there isn't one. */
export function loadSnapshot(): Promise<Snapshot | null> {
  request ??= fetch("/data/sentiment.json", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? (response.json() as Promise<Snapshot>) : null))
    .catch(() => null);
  return request;
}

export function isStale(snapshot: Snapshot): boolean {
  return Date.now() - Date.parse(snapshot.generated_at) > STALE_MS;
}

export function isAged(snapshot: Snapshot): boolean {
  return Date.now() - Date.parse(snapshot.generated_at) > AGED_MS;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export const dollars = (usd: number) => `$${Math.round(usd / 1_000_000).toLocaleString("en-US")} million`;

/** The biggest recent exchange moves for one asset. */
export const movesFor = (snapshot: Snapshot, symbol: string, count = 3) => (snapshot.large_moves ?? []).filter((move) => move.asset === symbol).slice(0, count);

/** One move in plain words, without saying what it means. */
export const moveLine = (move: LargeMove, name: string) => {
  const party = move.counterparty ? `${move.direction === "in" ? "from" : "to"} ${move.counterparty}` : "";
  return `${dollars(move.usd)} of ${name} moved ${move.direction === "in" ? "onto" : "off"} ${move.exchange}${party ? ` ${party}` : ""}`;
};

/** A short brief for the model, covering only the coins asked about. Null when there is nothing current. */
export function contextFor(snapshot: Snapshot | null, symbols: string[]): string | null {
  if (!snapshot || isStale(snapshot)) return null;
  const lines = symbols
    .map((symbol) => [symbol, snapshot.coins[symbol]] as const)
    .filter(([, coin]) => coin)
    .map(
      ([symbol, coin]) =>
        `- ${coin.name} (${symbol}): ${coin.mood}, score ${coin.score > 0 ? "+" : ""}${coin.score.toFixed(2)} on a -1 to +1 scale, from ${coin.posts} posts (${percent(coin.share.positive)} positive, ${percent(coin.share.neutral)} neutral, ${percent(coin.share.negative)} negative)` +
        (coin.headlines.length ? `. Recent headlines: ${coin.headlines.map((h) => `"${h.title}"`).join("; ")}` : ""),
    );
  if (!lines.length) return null;
  const crypto = symbols.some((symbol) => snapshot.coins[symbol] && snapshot.coins[symbol].kind !== "stock");
  const index = snapshot.fear_greed;
  const moves = symbols.flatMap((symbol) => {
    const coin = snapshot.coins[symbol];
    return coin ? movesFor(snapshot, symbol).map((move) => `- ${moveLine(move, coin.name)}`) : [];
  });
  return [
    `Pulse's sentiment snapshot for the 24 hours to ${snapshot.window.to}. Each post was labelled positive, neutral or negative by ${snapshot.method.labeller}; no human has checked these labels.`,
    ...lines,
    ...(crypto && index ? [`Alternative.me's Crypto Fear & Greed Index, for the whole crypto market: ${index.value} of 100, ${index.label}.`] : []),
    ...(moves.length ? ["Large exchange moves in the last 24 hours, from Arkham's labels:", ...moves] : []),
  ].join("\n");
}
