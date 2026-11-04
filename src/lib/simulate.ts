// The Simulation Lab's engine: replays a made-up portfolio through real prices, and applies stated shocks.
// Kept free of imports so scripts/simulate.test.ts can run it directly. Nothing here predicts anything.

export type HistoryAsset = { name: string; kind: string; source: string; start: string; closes: number[] };
export type Series = { name: string; unit: string; source: string; start: string; values: number[] };
export type History = {
  generated_at: string;
  assets: Record<string, HistoryAsset>;
  context: Record<string, Series>;
  sa_inflation: Record<string, number>;
  notes: string[];
};

export type Currency = "USD" | "ZAR";
export type Holding = { symbol: string; amount: number };

export type AssetResult = {
  symbol: string;
  name: string;
  invested: number;
  ending: number;
  returnPct: number;
  /** Value on each day of the replay. */
  values: number[];
};

export type Replay = {
  from: string;
  to: string;
  currency: Currency;
  days: string[];
  values: number[];
  invested: number;
  ending: number;
  returnPct: number;
  maxDrawdownPct: number;
  lowest: { day: string; value: number };
  assets: AssetResult[];
  skipped: Array<{ symbol: string; reason: string }>;
};

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const toIso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export const lastDay = (asset: { start: string; closes?: number[]; values?: number[] }) =>
  toIso(toDay(asset.start) + (asset.closes ?? asset.values ?? []).length - 1);

/** The value on a day, or the latest before it. Null before the series starts. */
export function valueOn(series: { start: string; closes?: number[]; values?: number[] }, iso: string): number | null {
  const values = series.closes ?? series.values ?? [];
  const index = toDay(iso) - toDay(series.start);
  if (index < 0 || values.length === 0) return null;
  return values[Math.min(index, values.length - 1)];
}

// USDZAR stands for holding US dollars, so in dollars it is flat and in rand it moves with the exchange rate.
function priceOn(history: History, symbol: string, iso: string, currency: Currency): number | null {
  const rate = valueOn(history.assets.USDZAR, iso);
  if (symbol === "USDZAR") return currency === "USD" ? 1 : rate;
  const price = valueOn(history.assets[symbol], iso);
  if (price === null) return null;
  if (currency === "USD") return price;
  return rate === null ? null : price * rate;
}

export function replay(history: History, holdings: Holding[], from: string, to: string, currency: Currency): Replay {
  const skipped: Replay["skipped"] = [];
  const held: Array<{ symbol: string; amount: number; units: number }> = [];

  for (const { symbol, amount } of holdings) {
    const asset = history.assets[symbol];
    if (!asset || !(amount > 0)) continue;
    const entry = priceOn(history, symbol, from, currency);
    if (entry === null) skipped.push({ symbol, reason: `${asset.name} has no price data before ${asset.start}` });
    else if (entry <= 0) skipped.push({ symbol, reason: `${asset.name} had no positive price on ${from}` });
    else held.push({ symbol, amount, units: amount / entry });
  }

  const days: string[] = [];
  const values: number[] = [];
  const paths: number[][] = held.map(() => []);
  for (let day = toDay(from); day <= toDay(to); day++) {
    const iso = toIso(day);
    days.push(iso);
    const today = held.map((h) => h.units * (priceOn(history, h.symbol, iso, currency) ?? 0));
    today.forEach((value, index) => paths[index].push(value));
    values.push(today.reduce((sum, value) => sum + value, 0));
  }

  const invested = held.reduce((sum, h) => sum + h.amount, 0);
  const ending = values[values.length - 1] ?? invested;
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  let lowest = { day: from, value: invested };
  values.forEach((value, index) => {
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdownPct = Math.min(maxDrawdownPct, ((value - peak) / peak) * 100);
    if (value < lowest.value) lowest = { day: days[index], value };
  });

  return {
    from,
    to,
    currency,
    days,
    values,
    invested,
    ending,
    returnPct: invested > 0 ? ((ending - invested) / invested) * 100 : 0,
    maxDrawdownPct,
    lowest,
    assets: held.map((h, index) => {
      const end = h.units * (priceOn(history, h.symbol, to, currency) ?? 0);
      return {
        values: paths[index],
        symbol: h.symbol,
        name: h.symbol === "USDZAR" ? "US dollars" : history.assets[h.symbol].name,
        invested: h.amount,
        ending: end,
        returnPct: ((end - h.amount) / h.amount) * 100,
      };
    }),
    skipped,
  };
}

const changeSince = (values: number[], start: number) => values.map((value) => ((value - start) / start) * 100);

/**
 * Each holding's percentage change on every day of a replay, for charting. Past ``limit`` holdings, the smallest
 * are combined into one "Other holdings" line, so the lines still account for the whole portfolio.
 */
export function assetLines(result: Replay, limit = 5) {
  const kept = new Set([...result.assets].sort((a, b) => b.invested - a.invested).slice(0, limit).map((asset) => asset.symbol));
  const lines = result.assets.filter((asset) => kept.has(asset.symbol)).map((asset) => ({ key: asset.symbol, name: asset.name, changes: changeSince(asset.values, asset.invested) }));
  const rest = result.assets.filter((asset) => !kept.has(asset.symbol));
  if (rest.length === 0) return lines;
  const total = result.days.map((_, day) => rest.reduce((sum, asset) => sum + asset.values[day], 0));
  return [...lines, { key: "other", name: "Other holdings", changes: changeSince(total, rest.reduce((sum, asset) => sum + asset.invested, 0)) }];
}

export type Risk = {
  days: number;
  volatilityPct: number;
  /** The daily return beaten on 95% of days: historical value at risk. */
  valueAtRiskPct: number;
  /** The average of the worst 5% of days: expected shortfall. */
  shortfallPct: number;
  worst: { day: string; pct: number };
  sharpe: number | null;
  sortino: number | null;
};

/** Below this, a 5% tail is a single day and a yearly rate means little. */
export const MIN_RISK_DAYS = 30;
const DAYS_PER_YEAR = 365; // Closes are carried over weekends, so the series has a value for every calendar day.

function dailyReturns({ days, values }: Replay) {
  const returns: Array<{ day: string; value: number }> = [];
  for (let i = 1; i < values.length; i++) {
    // A portfolio at or below zero, as oil alone was in April 2020, has no percentage return from there.
    if (values[i - 1] > 0) returns.push({ day: days[i], value: (values[i] - values[i - 1]) / values[i - 1] });
  }
  return returns;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const deviation = (values: number[]) => {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
};

/**
 * Risk measures for one replay, describing that period only. The ratios use the dollar replay, because the data
 * has a US risk-free rate (the federal funds rate) and no rand one. Null when the period is too short to measure.
 */
export function riskStats(history: History, result: Replay, dollars: Replay): Risk | null {
  const returns = dailyReturns(result);
  if (returns.length < MIN_RISK_DAYS) return null;

  const ordered = [...returns].sort((a, b) => a.value - b.value);
  const tail = ordered.slice(0, Math.max(1, Math.floor(ordered.length * 0.05)));

  const rate = history.context.DFF;
  const dollarReturns = dailyReturns(dollars);
  const excess = dollarReturns.map(({ day, value }) => value - (rate ? (valueOn(rate, day) ?? 0) / 100 / DAYS_PER_YEAR : 0));
  const spread = deviation(dollarReturns.map((item) => item.value));
  const downside = Math.sqrt(mean(excess.map((value) => Math.min(value, 0) ** 2)));
  const moves = rate !== undefined && spread > 1e-9;

  return {
    days: returns.length,
    volatilityPct: deviation(returns.map((item) => item.value)) * Math.sqrt(DAYS_PER_YEAR) * 100,
    valueAtRiskPct: tail[tail.length - 1].value * 100,
    shortfallPct: mean(tail.map((item) => item.value)) * 100,
    worst: { day: ordered[0].day, pct: ordered[0].value * 100 },
    sharpe: moves ? (mean(excess) / spread) * Math.sqrt(DAYS_PER_YEAR) : null,
    sortino: moves && downside > 0 ? (mean(excess) / downside) * Math.sqrt(DAYS_PER_YEAR) : null,
  };
}

export type Shock = {
  id: string;
  label: string;
  assumption: string;
  // The change applied to a holding, as a fraction, given the asset's kind and the display currency.
  effect: (symbol: string, kind: string, currency: Currency) => number;
};

export const SHOCKS: Shock[] = [
  {
    id: "rand-20",
    label: "Rand falls 20%",
    assumption: "The rand loses 20% against the dollar, so a dollar costs 25% more rand. Dollar prices stay the same.",
    effect: (_symbol, _kind, currency) => (currency === "ZAR" ? 0.25 : 0),
  },
  {
    id: "bitcoin-half",
    label: "Bitcoin halves",
    assumption: "Bitcoin falls 50% and nothing else moves. In practice other coins usually fall with it.",
    effect: (symbol) => (symbol === "BTC" ? -0.5 : 0),
  },
  {
    id: "crypto-40",
    label: "All crypto falls 40%",
    assumption: "Every crypto asset falls 40%. Everything else stays the same.",
    effect: (_symbol, kind) => (kind === "crypto" ? -0.4 : 0),
  },
  {
    id: "oil-50",
    label: "Oil rises 50%",
    assumption: "Oil rises 50% and nothing else moves.",
    effect: (_symbol, kind) => (kind === "commodity" ? 0.5 : 0),
  },
  {
    id: "stocks-30",
    label: "Stocks fall 30%",
    assumption: "Every stock and ETF falls 30%. Everything else stays the same.",
    effect: (_symbol, kind) => (kind === "stock" ? -0.3 : 0),
  },
];

export function applyShock(history: History, holdings: Holding[], shock: Shock, currency: Currency) {
  const rows = holdings
    .filter((h) => history.assets[h.symbol] && h.amount > 0)
    .map((h) => {
      // Dollars held in a dollar view can't move; the exchange-rate shock only reaches a rand view.
      const change = h.symbol === "USDZAR" && currency === "USD" ? 0 : shock.effect(h.symbol, history.assets[h.symbol].kind, currency);
      return { symbol: h.symbol, before: h.amount, after: h.amount * (1 + change), changePct: change * 100 };
    });
  const before = rows.reduce((sum, row) => sum + row.before, 0);
  const after = rows.reduce((sum, row) => sum + row.after, 0);
  return { rows, before, after, changePct: before > 0 ? ((after - before) / before) * 100 : 0 };
}
