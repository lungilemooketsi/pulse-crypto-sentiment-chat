import { useEffect, useState } from "react";
import { loadHistory, type Episode } from "@/lib/datasets";
import { signedPercent } from "@/lib/format";
import { HORIZONS, studyAfterShocks, type Horizon, type StudyRow } from "@/lib/study";

const percent = (fraction: number) => signedPercent(fraction * 100);

const READING: Record<StudyRow["verdict"], string> = {
  above: "Higher than normal",
  below: "Lower than normal",
  unclear: "No clear difference",
  too_few: "Too few to judge",
};

// Measured, not assumed: with episodes moved to random dates, 7.9% of rows still looked clear. See the model card.
const FALSE_ALARM_RATE = 0.079;

const isClear = (row: StudyRow) => row.verdict === "above" || row.verdict === "below";

/** The 95% interval on a scale shared by every row, with zero marked. */
const Interval = ({ row, limit }: { row: StudyRow; limit: number }) => {
  const place = (value: number) => `${((value + limit) / (2 * limit)) * 100}%`;
  const colour = isClear(row) ? "bg-brand" : "bg-muted-foreground";
  return (
    <div className="relative h-5" aria-hidden="true">
      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <span className={`absolute top-1/2 h-0.5 -translate-y-1/2 ${colour}`} style={{ left: place(row.low), right: `calc(100% - ${place(row.high)})` }} />
      <span className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card ${colour}`} style={{ left: place(row.difference) }} />
    </div>
  );
};

/** How assets moved after past episodes, compared with their normal periods. */
const ShockStudy = ({ episodes }: { episodes: Episode[] }) => {
  const [results, setResults] = useState<Record<Horizon, StudyRow[]> | null>(null);
  const [horizon, setHorizon] = useState<Horizon>(30);

  useEffect(() => {
    let current = true;
    loadHistory().then((history) => {
      if (!history) return;
      // Let the episode list paint first: the resampling takes a moment on a phone.
      setTimeout(() => {
        if (!current) return;
        setResults({
          1: studyAfterShocks(history, episodes, 1),
          5: studyAfterShocks(history, episodes, 5),
          30: studyAfterShocks(history, episodes, 30),
        });
      }, 0);
    });
    return () => {
      current = false;
    };
  }, [episodes]);

  if (!results) return null;

  const rows = results[horizon];
  const all = HORIZONS.flatMap((days) => results[days]).filter((row) => row.verdict !== "too_few");
  const clear = all.filter(isClear).length;
  const byChance = Math.max(1, Math.round(all.length * FALSE_ALARM_RATE));
  const limit = Math.max(...rows.flatMap((row) => [Math.abs(row.low), Math.abs(row.high)])) * 1.1;

  return (
    <section className="bg-card border p-4 space-y-4" aria-labelledby="study-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="study-title" className="font-medium">
          What happened after a shock
        </h2>
        <div className="flex gap-1" role="group" aria-label="Days after the episode">
          {HORIZONS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={horizon === days}
              onClick={() => setHorizon(days)}
              className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground transition-colors"
            >
              {days === 1 ? "1 day" : `${days} days`}
            </button>
          ))}
        </div>
      </div>

      <p className="max-w-3xl">
        {clear} of {all.length} comparisons stand clear of normal. About {byChance} would by chance alone{clear <= all.length / 3 ? ", so most shocks left little lasting trace" : ""}.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-normal">Group</th>
              <th className="py-1 pl-4 text-right font-normal">Episodes</th>
              <th className="py-1 pl-4 text-right font-normal">After</th>
              <th className="py-1 pl-4 text-right font-normal">Normal</th>
              <th className="py-1 pl-4 text-right font-normal">Difference</th>
              <th className="py-1 pl-6 text-left font-normal">95% interval of the difference</th>
              <th className="py-1 pl-4 text-left font-normal">Reading</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="py-1.5 whitespace-nowrap">{row.label}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{row.episodes}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{percent(row.after)}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{percent(row.normal)}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums font-medium">{percent(row.difference)}</td>
                <td className="py-1.5 pl-6 w-1/4 min-w-[170px]">
                  <Interval row={row} limit={limit} />
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {percent(row.low)} to {percent(row.high)}
                  </span>
                </td>
                <td className="py-1.5 pl-4 whitespace-nowrap">{READING[row.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground max-w-3xl">
        Average return over the {horizon === 1 ? "day" : `${horizon} days`} after each episode ended, against the same assets away from episodes. If the interval crosses the centre line, the difference could be
        noise. Episodes were found with hindsight, so this describes the past and couldn't have been traded.
      </p>
    </section>
  );
};

export default ShockStudy;
