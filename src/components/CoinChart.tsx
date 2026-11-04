import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import {
  fetchPriceHistory,
  MarketDataError,
  resolveCoin,
  type ChartRange,
  type Coin,
  type CoinQuery,
  type PricePoint,
} from "@/lib/market";
import { chartColours, signedPercent } from "@/lib/format";
import MoodPanel from "./MoodPanel";

const { line: BRAND, surface: SURFACE, grid: GRID, muted: MUTED } = chartColours;

const RANGES: Array<{ value: ChartRange; label: string; phrase: string }> = [
  { value: "1", label: "24h", phrase: "the last 24 hours" },
  { value: "7", label: "7d", phrase: "the last 7 days" },
  { value: "30", label: "30d", phrase: "the last 30 days" },
];

function formatUsd(value: number): string {
  if (value >= 1) {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    });
  }
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 4 });
}

function formatAxisUsd(value: number): string {
  if (value >= 10_000) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumSignificantDigits: 4 });
  }
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 4 });
}

function formatChange(from: number, to: number): string {
  const percent = ((to - from) / from) * 100;
  return signedPercent(Math.abs(percent) < 0.05 ? 0 : percent);
}

const timeOfDay = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayAndMonth = (time: number) => new Date(time).toLocaleDateString([], { day: "numeric", month: "short" });
const fullTime = (time: number) =>
  new Date(time).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Eight evenly spaced readings for the table view, always ending on the latest.
function sample(points: PricePoint[], count = 8): PricePoint[] {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => points[Math.round(index * step)]);
}

function PriceTooltip({ active, payload }: TooltipProps<number, string>) {
  const point = payload?.[0]?.payload as PricePoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="bg-popover border px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
      <p className="text-sm font-semibold tabular-nums text-foreground">{formatUsd(point.price)}</p>
      <p className="text-xs text-muted-foreground">{fullTime(point.time)}</p>
    </div>
  );
}

// What is on screen, with the range it covers, so labels always describe the line that is drawn.
type Shown = { points: PricePoint[]; range: ChartRange; at: number };
type Status = { state: "loading" } | { state: "idle" } | { state: "error"; message: string; range?: ChartRange };

const CoinChart = ({ query }: { query: CoinQuery }) => {
  const [coin, setCoin] = useState<Coin | null | undefined>("coin" in query ? query.coin : undefined);
  const [range, setRange] = useState<ChartRange>("7");
  const stock = "coin" in query && query.coin.id.startsWith("stock:");
  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showTable, setShowTable] = useState(false);
  const label = "coin" in query ? query.coin.name : `$${query.cashtag}`;

  useEffect(() => {
    if ("coin" in query) return;
    let cancelled = false;
    resolveCoin(query)
      .then((found) => !cancelled && setCoin(found))
      .catch((error) => {
        if (cancelled) return;
        setCoin(undefined);
        setStatus({ state: "error", message: messageFor(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [query, attempt]);

  useEffect(() => {
    if (!coin) return;
    let cancelled = false;
    // Refetching keeps the last chart on screen, dimmed, so the card does not jump.
    setStatus({ state: "loading" });
    fetchPriceHistory(coin.id, range)
      .then((points) => {
        if (cancelled) return;
        setShown({ points, range, at: Date.now() });
        setStatus({ state: "idle" });
      })
      .catch((error) => {
        if (!cancelled) setStatus({ state: "error", message: messageFor(error), range });
      });
    return () => {
      cancelled = true;
    };
  }, [coin, range, attempt]);

  const points = shown?.points;
  const first = points?.[0];
  const last = points?.[points.length - 1];
  const shownRange = shown?.range ?? range;
  // While a new range loads its button is selected; if it fails, the selection returns to what is drawn.
  const selected = status.state === "error" ? shownRange : range;
  const phrase = RANGES.find((item) => item.value === shownRange)?.phrase ?? "";
  const failedLabel = status.state === "error" && status.range ? RANGES.find((item) => item.value === status.range)?.label : null;
  const tableRows = useMemo(() => (points ? sample(points) : []), [points]);
  const formatTick = shownRange === "1" ? timeOfDay : dayAndMonth;
  const choose = (value: ChartRange) => {
    if (value === range) setAttempt((n) => n + 1);
    setRange(value);
  };

  if (coin === null) {
    return (
      <section className="bg-card border p-4 text-sm text-muted-foreground" aria-label={`${label} price chart`}>
        No coin on CoinGecko uses the ticker {label}, so there is no chart for it.
      </section>
    );
  }

  const title = coin ? `${coin.name} (${coin.symbol})` : label;
  const summary =
    first && last ? `${title} price over ${phrase}: ${formatUsd(first.price)} to ${formatUsd(last.price)}, ${formatChange(first.price, last.price)}.` : "";

  return (
    <section className="w-full bg-card border p-4 space-y-3" aria-label={`${title} price chart`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          {last && first ? (
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">{formatUsd(last.price)}</span>
              <span className="text-sm tabular-nums text-foreground">{formatChange(first.price, last.price)}</span>
              <span className="text-sm text-muted-foreground">over {phrase}</span>
            </p>
          ) : (
            <span className="mt-2 block h-6 w-40 bg-secondary" aria-hidden="true" />
          )}
        </div>
        <div className="flex gap-1" role="group" aria-label="Chart range">
          {RANGES.filter((item) => !(stock && item.value === "1")).map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected === item.value}
              onClick={() => choose(item.value)}
              className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <figure className="m-0">
        <figcaption className="sr-only">{summary}</figcaption>
        <div className={`h-40 transition-opacity ${status.state === "loading" && points ? "opacity-50" : ""}`}>
          {points ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={formatTick}
                  tick={{ fill: MUTED, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                />
                <YAxis
                  orientation="right"
                  domain={["auto", "auto"]}
                  tickFormatter={formatAxisUsd}
                  tick={{ fill: MUTED, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  tickCount={4}
                  width={64}
                />
                <Tooltip content={<PriceTooltip />} cursor={{ stroke: MUTED, strokeWidth: 1 }} isAnimationActive={false} />
                <Area
                  type="linear"
                  dataKey="price"
                  stroke={BRAND}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill={BRAND}
                  fillOpacity={0.1}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: BRAND, stroke: SURFACE, strokeWidth: 2 }}
                />
                {last && <ReferenceDot x={last.time} y={last.price} r={4} fill={BRAND} stroke={SURFACE} strokeWidth={2} />}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full bg-secondary" aria-hidden="true" />
          )}
        </div>
      </figure>

      {status.state === "error" && (
        <p className="text-sm text-muted-foreground" role="status">
          {failedLabel && points
            ? `Couldn't load the ${failedLabel} view, so this is still ${phrase}.`
            : `Couldn't load the ${coin?.name ?? label} chart.`}{" "}
          {status.message}{" "}
          <button type="button" className="text-foreground underline underline-offset-4" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}

      {coin && <MoodPanel symbol={coin.symbol} />}

      {showTable && tableRows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-normal">Time</th>
              <th className="py-1 text-right font-normal">Price (USD)</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.time} className="border-t">
                <td className="py-1 text-foreground">{fullTime(row.time)}</td>
                <td className="py-1 text-right tabular-nums text-foreground">{formatUsd(row.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Powered by{" "}
          <a href={stock ? "https://twelvedata.com" : "https://www.coingecko.com"} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {stock ? "Twelve Data" : "CoinGecko"}
          </a>
          {shown && ` · updated ${timeOfDay(shown.at)}`}
        </span>
        {points && (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setShowTable((open) => !open)}>
            {showTable ? "Hide table" : "Show as table"}
          </button>
        )}
      </div>
    </section>
  );
};

function messageFor(error: unknown): string {
  if (error instanceof MarketDataError) return error.rateLimited ? `${error.message} Try again in a minute.` : error.message;
  // CoinGecko's rate-limit responses carry no CORS header, so the browser reports them as a network failure.
  return "CoinGecko didn't answer. It may be limiting requests; try again in a minute.";
}

export default CoinChart;
