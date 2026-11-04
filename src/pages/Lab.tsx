import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import { Plus, X } from "lucide-react";
import AssetLines from "@/components/AssetLines";
import NativeSelect from "@/components/NativeSelect";
import SitePage from "@/components/SitePage";
import { Input } from "@/components/ui/input";
import { loadHistory } from "@/lib/datasets";
import { chartColours, signedPercent as percent } from "@/lib/format";
import { applyShock, lastDay, MIN_RISK_DAYS, replay, riskStats, SHOCKS, valueOn, type Currency, type History, type Holding } from "@/lib/simulate";

const { line: BRAND, surface: SURFACE, grid: GRID, muted: MUTED } = chartColours;

const PERIODS = [
  { id: "covid", label: "Covid crash, 2020", from: "2020-02-12", to: "2020-04-30" },
  { id: "bull", label: "2021 bull run", from: "2021-01-01", to: "2021-11-10" },
  { id: "china", label: "China crackdown, 2021", from: "2021-05-01", to: "2021-07-31" },
  { id: "rates", label: "2022 rate rises", from: "2022-01-03", to: "2022-12-30" },
  { id: "terra", label: "Terra collapse, 2022", from: "2022-05-01", to: "2022-06-30" },
  { id: "ftx", label: "FTX failure, 2022", from: "2022-11-01", to: "2022-12-15" },
  { id: "nene", label: "Nene fired, 2015", from: "2015-12-01", to: "2016-01-31" },
];

const money = (value: number, currency: Currency) =>
  value.toLocaleString("en-ZA", { style: "currency", currency, maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 });
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const signedMoney = (value: number, currency: Currency) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-ZA", { style: "currency", currency, maximumFractionDigits: 0 })}`;
const ratio = (value: number | null) => (value === null ? "–" : value.toFixed(2).replace("-", "−"));
const assetLabel = (history: History, symbol: string) => (symbol === "USDZAR" ? "US dollars" : history.assets[symbol].name);

function ValueTooltip({ active, payload, currency }: TooltipProps<number, string> & { currency: Currency }) {
  const point = payload?.[0]?.payload as { day: string; value: number } | undefined;
  if (!active || !point) return null;
  return (
    <div className="bg-popover border px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
      <p className="text-sm font-semibold tabular-nums text-foreground">{money(point.value, currency)}</p>
      <p className="text-xs text-muted-foreground">{shortDay(point.day)}</p>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="text-2xl font-semibold tabular-nums">{value}</p>
  </div>
);

const Lab = () => {
  const [params] = useSearchParams();
  const [history, setHistory] = useState<History | null | undefined>(undefined);
  const [currency, setCurrency] = useState<Currency>("ZAR");
  const [holdings, setHoldings] = useState<Holding[]>(() => {
    const assets = params.get("assets")?.split(",").filter(Boolean) ?? [];
    if (assets.length) return assets.map((symbol) => ({ symbol, amount: Math.round(20000 / assets.length) }));
    return [
      { symbol: "BTC", amount: 10000 },
      { symbol: "USDZAR", amount: 10000 },
    ];
  });
  const [from, setFrom] = useState(params.get("from") ?? PERIODS[0].from);
  const [to, setTo] = useState(params.get("to") ?? PERIODS[0].to);
  const [shockId, setShockId] = useState(SHOCKS[0].id);

  useEffect(() => {
    document.title = "Pulse · Simulation lab";
    loadHistory().then(setHistory);
  }, []);

  const latest = useMemo(() => (history ? lastDay(history.assets.BTC) : ""), [history]);
  const valid = Boolean(history) && from < to;
  const result = useMemo(() => (history && valid ? replay(history, holdings, from, to, currency) : null), [history, valid, holdings, from, to, currency]);
  const risk = useMemo(() => {
    if (!history || !result || result.invested === 0) return null;
    return riskStats(history, result, currency === "USD" ? result : replay(history, holdings, from, to, "USD"));
  }, [history, result, holdings, from, to, currency]);
  const shock = SHOCKS.find((item) => item.id === shockId) ?? SHOCKS[0];
  const shocked = useMemo(() => (history ? applyShock(history, holdings, shock, currency) : null), [history, holdings, shock, currency]);
  const points = useMemo(() => result?.days.map((day, index) => ({ day, value: result.values[index] })) ?? [], [result]);

  if (history === undefined) {
    return (
      <SitePage>
        <p className="pt-12 text-muted-foreground" role="status">
          Loading price history...
        </p>
      </SitePage>
    );
  }
  if (history === null) {
    return (
      <SitePage>
        <h1 className="pt-12 font-display text-3xl font-bold tracking-tight">Simulation lab</h1>
        <p className="mt-3 text-muted-foreground">The price history isn't available right now. Please try again later.</p>
      </SitePage>
    );
  }

  const symbols = Object.keys(history.assets);
  const unused = symbols.find((symbol) => !holdings.some((h) => h.symbol === symbol));
  const update = (index: number, change: Partial<Holding>) => setHoldings((list) => list.map((h, i) => (i === index ? { ...h, ...change } : h)));
  const years = Array.from(new Set([from.slice(0, 4), to.slice(0, 4)])).filter((year) => history.sa_inflation[year] !== undefined);
  const context = [
    ...Object.values(history.context).map((series) => ({ label: series.name, first: valueOn(series, from), last: valueOn(series, to), unit: series.unit })),
    { label: "US dollar in rand", first: valueOn(history.assets.USDZAR, from), last: valueOn(history.assets.USDZAR, to), unit: "" },
  ];
  const question = result
    ? `In the Pulse lab, a hypothetical portfolio of ${result.assets.map((a) => a.name).join(", ")} went ${percent(result.returnPct)} in ${currency === "ZAR" ? "rand" : "dollars"} from ${from} to ${to}. Explain what was happening in markets then and what drove those moves.`
    : "";

  return (
    <SitePage>
      <section className="pt-8 pb-8 space-y-2 max-w-3xl">
        <h1 className="font-display text-4xl font-bold tracking-tight">Simulation lab</h1>
        <p className="text-lg">Make up a portfolio and see how it would have done through real market events. It teaches how markets behave. It doesn't suggest what to hold.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <section className="bg-card border p-4 space-y-3" aria-labelledby="portfolio-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="portfolio-title" className="font-medium">
                Your made-up portfolio
              </h2>
              <div className="flex gap-1" role="group" aria-label="Currency">
                {(["ZAR", "USD"] as Currency[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={currency === item}
                    onClick={() => setCurrency(item)}
                    className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground transition-colors"
                  >
                    {item === "ZAR" ? "Rand" : "Dollars"}
                  </button>
                ))}
              </div>
            </div>
            {holdings.map((holding, index) => (
              <div key={index} className="grid grid-cols-[1fr_110px_32px] gap-2 items-center">
                <NativeSelect className="w-full" aria-label={`Asset ${index + 1}`} value={holding.symbol} onChange={(event) => update(index, { symbol: event.target.value })}>
                  {symbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {assetLabel(history, symbol)}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  className="h-10 tabular-nums"
                  aria-label={`Amount for ${assetLabel(history, holding.symbol)}`}
                  value={holding.amount}
                  onChange={(event) => update(index, { amount: Number(event.target.value) })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${assetLabel(history, holding.symbol)}`}
                  onClick={() => setHoldings((list) => list.filter((_, i) => i !== index))}
                  className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            {unused && (
              <button
                type="button"
                onClick={() => setHoldings((list) => [...list, { symbol: unused, amount: 5000 }])}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus size={16} /> Add an asset
              </button>
            )}
          </section>

          <section className="bg-card border p-4 space-y-3" aria-labelledby="period-title">
            <h2 id="period-title" className="font-medium">
              Period
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {PERIODS.map((period) => (
                <button
                  key={period.id}
                  type="button"
                  aria-pressed={from === period.from && to === period.to}
                  onClick={() => {
                    setFrom(period.from);
                    setTo(period.to);
                  }}
                  className="px-2.5 py-1.5 text-sm bg-secondary text-muted-foreground hover:text-foreground aria-pressed:bg-foreground aria-pressed:text-background transition-colors"
                >
                  {period.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm text-muted-foreground space-y-1">
                <span>From</span>
                <Input type="date" min="2015-01-02" max={latest} value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 text-foreground" />
              </label>
              <label className="text-sm text-muted-foreground space-y-1">
                <span>To</span>
                <Input type="date" min="2015-01-02" max={latest} value={to} onChange={(event) => setTo(event.target.value)} className="h-10 text-foreground" />
              </label>
            </div>
          </section>
        </div>

        <div className="space-y-6 min-w-0">
          <section className="bg-card border p-4 space-y-4" aria-labelledby="result-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="result-title" className="font-medium">
                Replay, {shortDay(from)} to {shortDay(to)}
              </h2>
              <span className="text-sm text-muted-foreground">Hypothetical, using real past prices</span>
            </div>
            {!valid && <p className="text-sm text-muted-foreground">Choose a start date before the end date.</p>}
            {result && result.invested === 0 && <p className="text-sm text-muted-foreground">Add an asset with data for this period to see a replay.</p>}
            {result && result.invested > 0 && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Stat label="Put in" value={money(result.invested, currency)} />
                  <Stat label="Ended with" value={money(result.ending, currency)} />
                  <Stat label="Change" value={percent(result.returnPct)} />
                  <Stat label="Worst fall from a high" value={percent(result.maxDrawdownPct)} />
                </div>
                <figure className="m-0">
                  <figcaption className="sr-only">
                    Portfolio value from {result.from} to {result.to}: {money(result.invested, currency)} to {money(result.ending, currency)}, {percent(result.returnPct)}.
                  </figcaption>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
                        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
                        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: MUTED, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={56} />
                        <YAxis
                          orientation="right"
                          domain={["auto", "auto"]}
                          tickFormatter={(value: number) => value.toLocaleString("en-ZA", { notation: "compact", maximumSignificantDigits: 3 })}
                          tick={{ fill: MUTED, fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                          tickCount={4}
                          width={52}
                        />
                        <ReferenceLine y={result.invested} stroke={MUTED} strokeWidth={1} />
                        <Tooltip content={<ValueTooltip currency={currency} />} cursor={{ stroke: MUTED, strokeWidth: 1 }} isAnimationActive={false} />
                        <Area
                          type="linear"
                          dataKey="value"
                          stroke={BRAND}
                          strokeWidth={2}
                          fill={BRAND}
                          fillOpacity={0.1}
                          isAnimationActive={false}
                          activeDot={{ r: 4, fill: BRAND, stroke: SURFACE, strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </figure>
                {result.assets.length > 1 && <AssetLines result={result} />}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="py-1 text-left font-normal">Asset</th>
                        <th className="py-1 pl-3 text-right font-normal">Put in</th>
                        <th className="py-1 pl-3 text-right font-normal">Ended with</th>
                        <th className="py-1 pl-3 text-right font-normal">Gain or loss</th>
                        <th className="py-1 pl-3 text-right font-normal">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.assets.map((asset) => (
                        <tr key={asset.symbol} className="border-t">
                          <td className="py-1.5">{asset.name}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums">{money(asset.invested, currency)}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums">{money(asset.ending, currency)}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums font-medium">{signedMoney(asset.ending - asset.invested, currency)}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums">{percent(asset.returnPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Link to={`/app?q=${encodeURIComponent(question)}`} className="inline-block text-sm underline underline-offset-4 decoration-brand hover:decoration-2">
                  Ask Pulse what drove this
                </Link>
              </>
            )}
            {result?.skipped.map((item) => (
              <p key={item.symbol} className="text-sm text-muted-foreground">
                Left out: {item.reason}.
              </p>
            ))}
          </section>

          {result && result.invested > 0 && (
            <section className="bg-card border p-4 space-y-4" aria-labelledby="risk-title">
              <h2 id="risk-title" className="font-medium">
                Risk in this period
              </h2>
              {risk ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Stat label="Volatility, per year" value={percent(risk.volatilityPct).replace("+", "")} />
                    <Stat label="Sharpe ratio" value={ratio(risk.sharpe)} />
                    <Stat label="Sortino ratio" value={ratio(risk.sortino)} />
                    <Stat label="95% daily VaR" value={percent(risk.valueAtRiskPct)} />
                    <Stat label="Expected shortfall" value={percent(risk.shortfallPct)} />
                    <Stat label={`Worst day, ${shortDay(risk.worst.day)}`} value={percent(risk.worst.pct)} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    From {risk.days} daily returns, so these describe this period. VaR is the return beaten on 95% of days, and expected shortfall is the average of the worst 5%. Sharpe and Sortino are yearly, in
                    dollars, above the US federal funds rate, because the data has no rand rate.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Choose a period of at least {MIN_RISK_DAYS} days to see risk measures.</p>
              )}
            </section>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <section className="bg-card border p-4 space-y-3" aria-labelledby="context-title">
              <h2 id="context-title" className="font-medium">
                What the economy was doing
              </h2>
              <dl className="text-sm space-y-2">
                {context.map((item) => (
                  <div key={item.label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="tabular-nums text-right whitespace-nowrap">
                      {item.first ?? "–"}
                      {item.unit} to {item.last ?? "–"}
                      {item.unit}
                    </dd>
                  </div>
                ))}
                {years.map((year) => (
                  <div key={year} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">South African inflation, {year}</dt>
                    <dd className="tabular-nums">{history.sa_inflation[year]}%</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">FRED and the World Bank. Rates are from the first to the last day of the period.</p>
            </section>

            <section className="bg-card border p-4 space-y-3" aria-labelledby="shock-title">
              <h2 id="shock-title" className="font-medium">
                What if
              </h2>
              <NativeSelect className="w-full" aria-label="Scenario" value={shockId} onChange={(event) => setShockId(event.target.value)}>
                {SHOCKS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
              {shocked && (
                <p className="text-sm">
                  {money(shocked.before, currency)} becomes <span className="font-semibold tabular-nums">{money(shocked.after, currency)}</span> ({percent(shocked.changePct)}).
                </p>
              )}
              <p className="text-xs text-muted-foreground">{shock.assumption} A made-up shock, not a forecast.</p>
            </section>
          </div>

          <p className="text-sm text-muted-foreground">
            Daily closes from {Array.from(new Set(Object.values(history.assets).map((a) => a.source))).join(", ")}. Replays ignore fees, tax and slippage. See how past shocks played out in the{" "}
            <Link to="/anomalies" className="underline underline-offset-4 hover:text-foreground">
              anomaly library
            </Link>
            .
          </p>
        </div>
      </div>
    </SitePage>
  );
};

export default Lab;
