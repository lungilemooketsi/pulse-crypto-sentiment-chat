// Tests the post-shock study. Run: node --test scripts/study.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Episode } from "../src/lib/datasets.ts";
import type { History } from "../src/lib/simulate.ts";
import { studyAfterShocks } from "../src/lib/study.ts";

const START = "2018-01-01";
const dayAfter = (offset: number) => new Date(Date.parse(`${START}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

const historyOf = (closes: number[], kind = "crypto"): History => ({
  generated_at: "",
  context: {},
  sa_inflation: {},
  notes: [],
  assets: { BTC: { name: "Bitcoin", kind, source: "test", start: START, closes } },
});

const episodeAt = (offset: number, move = -0.2): Episode => ({
  id: dayAfter(offset),
  start: dayAfter(offset),
  end: dayAfter(offset),
  assets: [{ asset: "BTC", name: "Bitcoin", kind: "crypto", peak_day: dayAfter(offset), z: -5, move, next_30_days: null }],
  category: "uncategorised",
  summary: null,
  headlines: [],
});

// Small repeatable wiggles, so normal periods aren't perfectly flat.
const wiggle = (index: number) => 1 + 0.001 * Math.sin(index * 12.9898);
const near = (actual: number, expected: number, tolerance = 0.002) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

function plantedHistory(gain: number, offsets: number[]) {
  const closes = [100];
  for (let index = 1; index < 1400; index++) {
    const planted = offsets.includes(index - 1) ? 1 + gain : 1;
    closes.push(closes[index - 1] * wiggle(index) * planted);
  }
  return closes;
}

const OFFSETS = Array.from({ length: 14 }, (_, i) => 60 + i * 95);

test("a planted rebound is measured and judged higher than normal", () => {
  const closes = plantedHistory(0.1, OFFSETS);
  const [row] = studyAfterShocks(historyOf(closes), OFFSETS.map((offset) => episodeAt(offset)), 1);
  assert.equal(row.label, "Crypto, after a fall");
  assert.equal(row.episodes, 14);
  near(row.after, 0.1);
  near(row.normal, 0);
  assert.equal(row.verdict, "above");
  assert.ok(row.low <= row.difference && row.difference <= row.high);
});

test("no planted effect is not judged different", () => {
  const closes = plantedHistory(0, OFFSETS);
  const [row] = studyAfterShocks(historyOf(closes), OFFSETS.map((offset) => episodeAt(offset)), 1);
  near(row.difference, 0);
  assert.notEqual(row.verdict, "above");
});

test("rises and falls are studied apart", () => {
  const closes = plantedHistory(0, OFFSETS);
  const episodes = OFFSETS.map((offset, index) => episodeAt(offset, index % 2 ? 0.2 : -0.2));
  const rows = studyAfterShocks(historyOf(closes), episodes, 1);
  assert.deepEqual(rows.map((row) => [row.label, row.episodes]), [["Crypto, after a fall", 7], ["Crypto, after a rise", 7]]);
});

test("too few episodes are shown but not judged", () => {
  const closes = plantedHistory(0.1, OFFSETS);
  const [row] = studyAfterShocks(historyOf(closes), OFFSETS.slice(0, 5).map((offset) => episodeAt(offset)), 1);
  assert.equal(row.verdict, "too_few");
});

test("an episode without a full follow-up window is left out", () => {
  const closes = plantedHistory(0, OFFSETS);
  const episodes = [...OFFSETS.map((offset) => episodeAt(offset)), episodeAt(closes.length - 3)];
  const [row] = studyAfterShocks(historyOf(closes), episodes, 5);
  assert.equal(row.episodes, OFFSETS.length);
});

test("a start below zero, like oil in April 2020, is left out", () => {
  const closes = plantedHistory(0, OFFSETS);
  closes[OFFSETS[0]] = -36.98;
  const [row] = studyAfterShocks(historyOf(closes), OFFSETS.map((offset) => episodeAt(offset)), 1);
  assert.equal(row.episodes, OFFSETS.length - 1);
});

test("an end below zero is left out too", () => {
  const closes = plantedHistory(0, OFFSETS);
  closes[OFFSETS[0] + 1] = -36.98;
  const [row] = studyAfterShocks(historyOf(closes), OFFSETS.map((offset) => episodeAt(offset)), 1);
  assert.equal(row.episodes, OFFSETS.length - 1);
});

test("the published numbers are the same on every visit", () => {
  const closes = plantedHistory(0.1, OFFSETS);
  const run = () => studyAfterShocks(historyOf(closes), OFFSETS.map((offset) => episodeAt(offset)), 5);
  assert.deepEqual(run(), run());
});
