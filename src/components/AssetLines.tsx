import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import { chartColours, signedPercent as percent } from "@/lib/format";
import { assetLines, type Replay } from "@/lib/simulate";

const { grid: GRID, muted: MUTED, surface: SURFACE } = chartColours;

// Checked for colour-blind separation and contrast on the card colour. Orange and red are left out so an asset
// can't be mistaken for the brand colour or a loss.
const HUES = ["#3987e5", "#199e70", "#c98500", "#d55181", "#9085e9"];
const WHOLE = "hsl(var(--foreground))";
const MOST_POINTS = 400;
const MAX_LABELLED = 4;
const HEIGHT = 288;
const TOP = 8;
const AXIS = 30;
const LABEL_GAP = 18;

type Series = { key: string; name: string; colour: string; changes: number[]; dashed?: boolean; width: number };
type Point = { day: string } & Record<string, number | string>;

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

/** Round axis steps that cover the data, so the labels beside the chart can be placed by arithmetic. */
function scaleFor(values: number[]) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const rough = (high - low || 1) / 4;
  const size = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((unit) => unit * size).find((option) => option >= rough) ?? rough;
  const first = Math.floor(low / step) * step;
  const last = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = first; tick <= last + step / 2; tick += step) ticks.push(Number(tick.toFixed(6)));
  return { first, last, ticks };
}

/** Where each end label sits, in pixels, moved apart just enough not to overlap. */
function labelPlaces(series: Series[], first: number, last: number) {
  const plot = HEIGHT - TOP - AXIS;
  const places = series
    .map((item) => ({ item, y: TOP + ((last - item.changes[item.changes.length - 1]) / (last - first || 1)) * plot }))
    .sort((a, b) => a.y - b.y);
  places.forEach((place, index) => {
    if (index > 0) place.y = Math.max(place.y, places[index - 1].y + LABEL_GAP);
  });
  const overflow = places[places.length - 1].y - (HEIGHT - AXIS);
  return overflow > 0 ? places.map((place) => ({ ...place, y: place.y - overflow })) : places;
}

function LinesTooltip({ active, payload, series }: TooltipProps<number, string> & { series: Series[] }) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || !point) return null;
  const rows = [...series].sort((a, b) => Number(point[b.key]) - Number(point[a.key]));
  return (
    <div className="bg-popover border px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.4)] space-y-1">
      <p className="text-xs text-muted-foreground">{shortDay(String(point.day))}</p>
      {rows.map((item) => (
        <p key={item.key} className="flex items-center justify-between gap-4 text-sm text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3" style={{ background: item.colour }} aria-hidden="true" />
            {item.name}
          </span>
          <span className="tabular-nums">{percent(Number(point[item.key]))}</span>
        </p>
      ))}
    </div>
  );
}

/** Each asset's change since the start of the replay, beside the whole portfolio's. */
const AssetLines = ({ result }: { result: Replay }) => {
  const series = useMemo<Series[]>(() => {
    const assets = assetLines(result).map((line, index) => ({
      ...line,
      colour: line.key === "other" ? MUTED : HUES[index % HUES.length],
      dashed: line.key === "other",
      width: 2,
    }));
    const whole = result.values.map((value) => ((value - result.invested) / result.invested) * 100);
    return [{ key: "portfolio", name: "Whole portfolio", colour: WHOLE, changes: whole, width: 3 }, ...assets];
  }, [result]);

  const points = useMemo(() => {
    const step = Math.ceil(result.days.length / MOST_POINTS);
    const picked: Point[] = [];
    result.days.forEach((day, index) => {
      if (index % step && index !== result.days.length - 1) return;
      picked.push({ day, ...Object.fromEntries(series.map((item) => [item.key, item.changes[index]])) });
    });
    return picked;
  }, [result, series]);

  const { first, last, ticks } = useMemo(() => scaleFor(series.flatMap((item) => item.changes)), [series]);
  const end = (item: Series) => percent(item.changes[item.changes.length - 1]);
  const labelled = series.length - 1 <= MAX_LABELLED;

  return (
    <figure className="m-0 space-y-3">
      <figcaption className="space-y-1">
        <h3 className="font-medium">Each asset's move</h3>
        <p className="text-sm text-muted-foreground">Change since the start of the period. The table below shows how much each one added to the total.</p>
      </figcaption>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Change over the period">
        {series.map((item) => (
          <li key={item.key} className="inline-flex items-center gap-1.5">
            <svg width="14" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="14" y2="2" stroke={item.colour} strokeWidth={item.width} strokeDasharray={item.dashed ? "3 2" : undefined} />
            </svg>
            {item.name} <span className="tabular-nums text-muted-foreground">{end(item)}</span>
          </li>
        ))}
      </ul>

      <div className="flex" style={{ height: HEIGHT }}>
        <div className="min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: TOP, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
              <XAxis dataKey="day" height={AXIS} tickFormatter={shortDay} tick={{ fill: MUTED, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={56} />
              <YAxis
                orientation="right"
                domain={[first, last]}
                ticks={ticks}
                tickFormatter={(value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-ZA")}%`}
                tick={{ fill: MUTED, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={60}
              />
              <ReferenceLine y={0} stroke={MUTED} strokeWidth={1} />
              <Tooltip content={<LinesTooltip series={series} />} cursor={{ stroke: MUTED, strokeWidth: 1 }} isAnimationActive={false} />
              {[...series].reverse().map((item) => (
                <Line
                  key={item.key}
                  type="linear"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.colour}
                  strokeWidth={item.width}
                  strokeDasharray={item.dashed ? "4 3" : undefined}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, fill: item.colour, stroke: SURFACE, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {labelled && (
          <div className="relative hidden w-28 shrink-0 sm:block" aria-hidden="true">
            {labelPlaces(series, first, last).map(({ item, y }) => (
              <span key={item.key} className="absolute left-2 right-0 -translate-y-1/2 truncate text-xs text-muted-foreground" style={{ top: y }}>
                {item.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
};

export default AssetLines;
