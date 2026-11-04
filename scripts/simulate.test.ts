// Tests the Lab's engine. Run: node --test scripts/simulate.test.ts
// The first three replay real periods and compare with the return worked out by hand from the same two closes,
// which is subtask 8.8's check that a replay matches what the asset actually did.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyShock, assetLines, MIN_RISK_DAYS, replay, riskStats, SHOCKS, valueOn, type History } from "../src/lib/simulate.ts";

// Real closes around three periods: Bitcoin 2020-03-11 to 13, USD/ZAR 2015-12-08 to 11, WTI 2020-04-17 to 21.
const history: History = {
  generated_at: "",
  context: {},
  sa_inflation: {},
  notes: [],
  assets: {
    BTC: { name: "Bitcoin", kind: "crypto", source: "Coinbase", start: "2020-03-11", closes: [7938.05, 4857.1, 5637.6] },
    USDZAR: {
      name: "US dollar in rand",
      kind: "forex",
      source: "FRED",
      start: "2015-12-08",
      closes: [...Array(1560).fill(14.6)].map((v, i) => (i === 3 ? 15.751 : i > 3 ? 15 : v)),
    },
    WTI: { name: "WTI crude oil", kind: "commodity", source: "FRED", start: "2020-04-17", closes: [18.31, 18.31, 18.31, -36.98, 8.91] },
  },
};

const near = (actual: number, expected: number, tolerance = 0.1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

test("a Bitcoin replay matches its actual return", () => {
  const result = replay(history, [{ symbol: "BTC", amount: 1000 }], "2020-03-11", "2020-03-13", "USD");
  near(result.returnPct, ((5637.6 - 7938.05) / 7938.05) * 100);
  near(result.maxDrawdownPct, ((4857.1 - 7938.05) / 7938.05) * 100);
  assert.equal(result.lowest.day, "2020-03-12");
});

test("dollars held in a rand view move with the exchange rate, and stay flat in a dollar view", () => {
  const rand = replay(history, [{ symbol: "USDZAR", amount: 1000 }], "2015-12-08", "2015-12-11", "ZAR");
  near(rand.returnPct, ((15.751 - 14.6) / 14.6) * 100);
  const dollars = replay(history, [{ symbol: "USDZAR", amount: 1000 }], "2015-12-08", "2015-12-11", "USD");
  near(dollars.returnPct, 0);
});

test("a replay carries a negative oil price honestly", () => {
  const result = replay(history, [{ symbol: "WTI", amount: 1000 }], "2020-04-17", "2020-04-21", "USD");
  near(result.returnPct, ((8.91 - 18.31) / 18.31) * 100);
  assert.ok(result.lowest.value < 0);
});

test("an asset with no data yet is skipped and named, not counted as a loss", () => {
  const result = replay(history, [{ symbol: "BTC", amount: 500 }, { symbol: "WTI", amount: 500 }], "2020-03-11", "2020-03-13", "USD");
  assert.equal(result.invested, 500);
  assert.deepEqual(result.skipped.map((s) => s.symbol), ["WTI"]);
});

test("a value after the series ends is its last close", () => {
  assert.equal(valueOn(history.assets.BTC, "2021-01-01"), 5637.6);
  assert.equal(valueOn(history.assets.BTC, "2020-01-01"), null);
});

test("each asset's daily values add up to the portfolio", () => {
  const result = replay(history, [{ symbol: "BTC", amount: 1000 }, { symbol: "USDZAR", amount: 3000 }], "2020-03-11", "2020-03-13", "ZAR");
  result.days.forEach((_, day) => near(result.assets[0].values[day] + result.assets[1].values[day], result.values[day], 0.001));
});

test("asset lines show change since the start", () => {
  const result = replay(history, [{ symbol: "BTC", amount: 1000 }], "2020-03-11", "2020-03-13", "USD");
  const [line] = assetLines(result);
  assert.equal(line.name, "Bitcoin");
  near(line.changes[0], 0, 0.001);
  near(line.changes[2], result.returnPct, 0.001);
});

test("past the limit, the smallest holdings fold into one line that keeps the totals right", () => {
  const result = replay(history, [{ symbol: "USDZAR", amount: 100 }, { symbol: "BTC", amount: 3000 }, { symbol: "WTI", amount: 300 }], "2020-04-17", "2020-04-21", "USD");
  const lines = assetLines(result, 1);
  assert.deepEqual(lines.map((line) => line.key), ["BTC", "other"]);
  const usd = result.assets.find((asset) => asset.symbol === "USDZAR")!;
  const wti = result.assets.find((asset) => asset.symbol === "WTI")!;
  near(lines[1].changes[4], ((usd.ending + wti.ending - 400) / 400) * 100, 0.001);
});

// 40 days of known returns: 2% up on most days, with two bad days and a 5% rate.
const moves = Array.from({ length: 40 }, (_, i) => (i === 9 ? -0.1 : i === 29 ? -0.06 : 0.02));
const riskHistory: History = {
  ...history,
  context: { DFF: { name: "Rate", unit: "%", source: "test", start: "2021-01-01", values: Array(41).fill(5) } },
  assets: {
    ...history.assets,
    RISK: { name: "Risky", kind: "crypto", source: "test", start: "2021-01-01", closes: moves.reduce((closes, move) => [...closes, closes[closes.length - 1] * (1 + move)], [100]) },
    USDZAR: { name: "US dollar in rand", kind: "forex", source: "test", start: "2021-01-01", closes: Array(41).fill(15) },
  },
};
const riskFor = (symbol: string, to = "2021-02-10") => {
  const holdings = [{ symbol, amount: 1000 }];
  return riskStats(riskHistory, replay(riskHistory, holdings, "2021-01-01", to, "USD"), replay(riskHistory, holdings, "2021-01-01", to, "USD"));
};

test("risk measures match the same sums worked out directly", () => {
  const risk = riskFor("RISK")!;
  const average = moves.reduce((a, b) => a + b, 0) / 40;
  const spread = Math.sqrt(moves.reduce((sum, move) => sum + (move - average) ** 2, 0) / 39);
  const daily = 0.05 / 365;
  const downside = Math.sqrt(moves.reduce((sum, move) => sum + Math.min(move - daily, 0) ** 2, 0) / 40);
  assert.equal(risk.days, 40);
  near(risk.volatilityPct, spread * Math.sqrt(365) * 100, 0.001);
  near(risk.valueAtRiskPct, -6, 0.001); // 5% of 40 days is 2, and the second worst is -6%
  near(risk.shortfallPct, -8, 0.001);
  near(risk.worst.pct, -10, 0.001);
  assert.equal(risk.worst.day, "2021-01-11");
  near(risk.sharpe!, ((average - daily) / spread) * Math.sqrt(365), 0.001);
  near(risk.sortino!, ((average - daily) / downside) * Math.sqrt(365), 0.001);
});

test("a period too short to measure gives no risk figures", () => {
  assert.equal(riskFor("RISK", "2021-01-20"), null);
  assert.ok(MIN_RISK_DAYS > 19);
});

test("a holding that never moves has no ratios, rather than a huge one", () => {
  const risk = riskFor("USDZAR")!;
  near(risk.volatilityPct, 0);
  assert.equal(risk.sharpe, null);
  assert.equal(risk.sortino, null);
});

test("shocks change only what they state", () => {
  const holdings = [{ symbol: "BTC", amount: 1000 }, { symbol: "USDZAR", amount: 1000 }];
  const half = applyShock(history, holdings, SHOCKS.find((s) => s.id === "bitcoin-half")!, "USD");
  near(half.after, 1500);
  const randFall = SHOCKS.find((s) => s.id === "rand-20")!;
  near(applyShock(history, holdings, randFall, "ZAR").after, 2500);
  near(applyShock(history, holdings, randFall, "USD").after, 2000);
});
