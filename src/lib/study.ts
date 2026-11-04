// The post-shock study: how assets moved after an episode, compared with that asset's normal periods.
// It describes the past. Episodes are found with hindsight, so none of this could have been traded on.
// Kept to type imports so scripts/study.test.ts can run it directly.
import type { Episode } from "./datasets";
import type { History } from "./simulate";

export const HORIZONS = [1, 5, 30] as const;
export type Horizon = (typeof HORIZONS)[number];

const RESAMPLES = 2000;
const SEED = 20150101;
/** Below this many episodes a row is shown but not judged. */
export const MIN_EPISODES = 10;

export type StudyRow = {
  id: string;
  label: string;
  episodes: number;
  /** Average return after these episodes, as a fraction. */
  after: number;
  /** Average return over the same assets' normal periods, as a fraction. */
  normal: number;
  /** after minus normal, with its 95% interval. */
  difference: number;
  low: number;
  high: number;
  verdict: "above" | "below" | "unclear" | "too_few";
};

type Sample = { asset: string; block: number; value: number; episode: string };
type Tally = Map<number, { sum: number; count: number }>;

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/** Calendar quarters are the resampling unit, because episodes cluster and 30-day windows overlap. */
function blockOf(day: number) {
  const date = new Date(day * DAY_MS);
  return date.getUTCFullYear() * 4 + Math.floor(date.getUTCMonth() / 3);
}

// Oil closed below zero in April 2020, where a percentage return has no meaning, so windows that start or end there are left out.
function forward(closes: number[], index: number, horizon: number) {
  const first = closes[index];
  const last = closes[index + horizon];
  return first > 0 && last > 0 ? (last - first) / first : null;
}

// A small seeded generator, so the published numbers are the same on every visit.
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], share: number) {
  const position = (sorted.length - 1) * share;
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

/** Each asset's returns on days outside its episodes and their follow-up windows, tallied by quarter. */
function normalPeriods(history: History, episodes: Episode[], horizon: number) {
  const tallies = new Map<string, Tally>();
  for (const [symbol, asset] of Object.entries(history.assets)) {
    const first = toDay(asset.start);
    const busy = new Set<number>();
    for (const episode of episodes) {
      if (!episode.assets.some((item) => item.asset === symbol)) continue;
      for (let day = toDay(episode.start); day <= toDay(episode.end) + horizon; day++) busy.add(day);
    }
    const tally: Tally = new Map();
    asset.closes.forEach((_, index) => {
      const day = first + index;
      const value = forward(asset.closes, index, horizon);
      if (value === null || busy.has(day)) return;
      const entry = tally.get(blockOf(day)) ?? { sum: 0, count: 0 };
      entry.sum += value;
      entry.count += 1;
      tally.set(blockOf(day), entry);
    });
    tallies.set(symbol, tally);
  }
  return tallies;
}

function rowsToStudy(history: History) {
  const kinds = Array.from(new Set(Object.values(history.assets).map((asset) => asset.kind)));
  const groups = kinds.map((kind) => ({ kind, name: kind === "crypto" ? "Crypto" : kind === "forex" ? "Dollar in rand" : kind === "commodity" ? "Oil" : "Stocks" }));
  return groups.flatMap(({ kind, name }) => [
    { id: `${kind}-fall`, kind, sign: -1, label: `${name}, after a fall` },
    { id: `${kind}-rise`, kind, sign: 1, label: `${name}, after a rise` },
  ]);
}

/** One row per asset group and direction, for one horizon in days. */
export function studyAfterShocks(history: History, episodes: Episode[], horizon: Horizon): StudyRow[] {
  const normals = normalPeriods(history, episodes, horizon);
  const blocks = Array.from(new Set(Array.from(normals.values()).flatMap((tally) => Array.from(tally.keys())))).sort((a, b) => a - b);

  const baseline = (symbol: string, weight: (block: number) => number) => {
    let sum = 0;
    let count = 0;
    normals.get(symbol)?.forEach((entry, block) => {
      sum += entry.sum * weight(block);
      count += entry.count * weight(block);
    });
    return count > 0 ? sum / count : null;
  };

  const rows = rowsToStudy(history).map((row) => {
    const samples: Sample[] = [];
    for (const episode of episodes) {
      for (const item of episode.assets) {
        const asset = history.assets[item.asset];
        if (!asset || asset.kind !== row.kind || !item.move || Math.sign(item.move) !== row.sign) continue;
        const value = forward(asset.closes, toDay(episode.end) - toDay(asset.start), horizon);
        if (value !== null) samples.push({ asset: item.asset, block: blockOf(toDay(episode.end)), value, episode: episode.id });
      }
    }
    return { ...row, samples, draws: [] as number[] };
  });

  // Each draw resamples whole quarters, for the episodes and the normal periods alike,
  // so the interval carries the uncertainty in both.
  const random = generator(SEED + horizon);
  for (let draw = 0; draw < RESAMPLES; draw++) {
    const counts = new Map<number, number>();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[Math.floor(random() * blocks.length)];
      counts.set(block, (counts.get(block) ?? 0) + 1);
    }
    const weight = (block: number) => counts.get(block) ?? 0;
    const normal = new Map(Object.keys(history.assets).map((symbol) => [symbol, baseline(symbol, weight)]));
    for (const row of rows) {
      let sum = 0;
      let total = 0;
      for (const sample of row.samples) {
        const usual = normal.get(sample.asset);
        const times = weight(sample.block);
        if (usual === null || usual === undefined || times === 0) continue;
        sum += (sample.value - usual) * times;
        total += times;
      }
      if (total > 0) row.draws.push(sum / total);
    }
  }

  return rows
    .filter((row) => row.samples.length > 0)
    .map(({ id, label, samples, draws }) => {
      const usual = samples.map((sample) => baseline(sample.asset, () => 1) ?? 0);
      const after = samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length;
      const normal = usual.reduce((sum, value) => sum + value, 0) / samples.length;
      const ordered = [...draws].sort((a, b) => a - b);
      const low = percentile(ordered, 0.025);
      const high = percentile(ordered, 0.975);
      const count = new Set(samples.map((sample) => sample.episode)).size;
      const verdict = count < MIN_EPISODES ? "too_few" : low > 0 ? "above" : high < 0 ? "below" : "unclear";
      return { id, label, episodes: count, after, normal, difference: after - normal, low, high, verdict };
    });
}
