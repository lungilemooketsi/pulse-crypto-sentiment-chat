import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import NativeSelect from "@/components/NativeSelect";
import ShockStudy from "@/components/ShockStudy";
import SitePage from "@/components/SitePage";
import { loadAnomalies, type AnomalyData, type Episode } from "@/lib/datasets";
import { signedPercent } from "@/lib/format";

const PAGE = 30;

const percent = (fraction: number | null) => (fraction === null ? "–" : signedPercent(fraction * 100));
const niceDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const title = (category: string) => {
  if (category === "uncategorised") return "Unusual move";
  const words = category.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const assetName = (name: string, symbol: string) => (symbol === "USDZAR" ? "Dollar in rand" : name);

/** A plain account of the move, for episodes with no explanation from the headlines yet. */
function describeMove(episode: Episode) {
  const [lead, ...others] = episode.assets;
  const span = episode.start === episode.end ? `on ${niceDay(episode.start)}` : `between ${niceDay(episode.start)} and ${niceDay(episode.end)}`;
  const name = assetName(lead.name, lead.asset);
  const move = lead.move === null ? "moved sharply" : `${lead.move < 0 ? "fell" : "rose"} ${Math.abs(lead.move * 100).toFixed(1)}%`;
  const company = others.length === 1 ? ` alongside ${assetName(others[0].name, others[0].asset)}` : others.length > 1 ? ` alongside ${others.length} other assets` : "";
  return `${name} ${move} ${span}${company}. Pulse hasn't found a cause in the headlines yet.`;
}

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const EpisodeRow = ({ episode }: { episode: Episode }) => {
  const replay = `/lab?from=${addDays(episode.start, -14)}&to=${addDays(episode.end, 30)}&assets=${episode.assets
    .slice(0, 3)
    .map((asset) => asset.asset)
    .join(",")}`;
  const single = episode.start === episode.end;

  return (
    <li className="bg-card border p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-medium">
          {title(episode.category)}, {niceDay(episode.start)}
          {single ? "" : ` to ${niceDay(episode.end)}`}
        </h2>
        <Link to={replay} className="text-sm underline underline-offset-4 decoration-brand hover:decoration-2">
          Replay this episode
        </Link>
      </div>

      <p>{episode.summary ?? describeMove(episode)}</p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-left font-normal">Asset</th>
            <th className="py-1 text-right font-normal">During</th>
            <th className="py-1 text-right font-normal">Next 30 days</th>
          </tr>
        </thead>
        <tbody>
          {episode.assets.slice(0, 5).map((asset) => (
            <tr key={asset.asset} className="border-t">
              <td className="py-1.5">{assetName(asset.name, asset.asset)}</td>
              <td className="py-1.5 text-right tabular-nums">{percent(asset.move)}</td>
              <td className="py-1.5 text-right tabular-nums">{percent(asset.next_30_days)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {episode.assets.length > 5 && <p className="text-xs text-muted-foreground">And {episode.assets.length - 5} more assets.</p>}

      {episode.headlines.length > 0 && (
        <ul className="space-y-1 text-sm">
          {episode.headlines.map((headline) => (
            <li key={headline.url}>
              <a href={headline.url} target="_blank" rel="noreferrer" className="underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground">
                {headline.title}
              </a>{" "}
              <span className="text-xs text-muted-foreground">{headline.source}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

const Anomalies = () => {
  const [data, setData] = useState<AnomalyData | null | undefined>(undefined);
  const [category, setCategory] = useState("all");
  const [asset, setAsset] = useState("all");
  const [year, setYear] = useState("all");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    document.title = "Pulse · Anomaly library";
    loadAnomalies().then(setData);
  }, []);

  const options = useMemo(() => {
    const episodes = data?.episodes ?? [];
    const assets = new Map(episodes.flatMap((e) => e.assets.map((a) => [a.asset, assetName(a.name, a.asset)] as const)));
    return {
      categories: Array.from(new Set(episodes.map((e) => e.category))).sort(),
      assets: Array.from(assets).sort((a, b) => a[1].localeCompare(b[1])),
      years: Array.from(new Set(episodes.map((e) => e.start.slice(0, 4)))).sort().reverse(),
    };
  }, [data]);

  const matches = useMemo(
    () =>
      (data?.episodes ?? []).filter(
        (e) => (category === "all" || e.category === category) && (year === "all" || e.start.startsWith(year)) && (asset === "all" || e.assets.some((a) => a.asset === asset)),
      ),
    [data, category, asset, year],
  );

  useEffect(() => setShown(PAGE), [category, asset, year]);

  const categorised = data?.episodes.filter((e) => e.category !== "uncategorised").length ?? 0;

  return (
    <SitePage>
      <section className="pt-8 pb-8 space-y-2 max-w-3xl">
        <h1 className="font-display text-4xl font-bold tracking-tight">Anomaly library</h1>
        <p className="text-lg">Unusual market episodes since 2015, found from price history and sorted by type, so you can see how past shocks played out.</p>
      </section>

      {data === undefined && (
        <p className="text-muted-foreground" role="status">
          Loading episodes...
        </p>
      )}
      {data === null && <p className="text-muted-foreground">The library isn't available right now. Please try again later.</p>}

      {data && (
        <div className="space-y-6">
          <ShockStudy episodes={data.episodes} />

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter episodes">
            <NativeSelect aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {options.categories.map((item) => (
                <option key={item} value={item}>
                  {title(item)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Asset" value={asset} onChange={(event) => setAsset(event.target.value)}>
              <option value="all">All assets</option>
              {options.assets.map(([symbol, name]) => (
                <option key={symbol} value={symbol}>
                  {name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Year" value={year} onChange={(event) => setYear(event.target.value)}>
              <option value="all">All years</option>
              {options.years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
            <p className="self-center text-sm text-muted-foreground" role="status">
              {matches.length} of {data.episodes.length} episodes
            </p>
          </div>

          <ul className="space-y-3">
            {matches.slice(0, shown).map((episode) => (
              <EpisodeRow key={episode.id} episode={episode} />
            ))}
          </ul>

          {matches.length === 0 && <p className="text-muted-foreground">No episodes match these filters.</p>}
          {matches.length > shown && (
            <button type="button" onClick={() => setShown((count) => count + PAGE)} className="h-10 px-4 bg-secondary hover:bg-accent transition-colors text-sm">
              Show more
            </button>
          )}

          <p className="text-sm text-muted-foreground max-w-3xl">
            Categories and summaries come from Muse Spark reading that week's headlines, and no person has checked them: {categorised} of {data.episodes.length} episodes have one so far; the rest show as "Unusual move". "Next 30 days"
            describes that episode alone. Method and limits are on the{" "}
            <Link to="/model-card" className="underline underline-offset-4 hover:text-foreground">
              model card
            </Link>
            .
          </p>
        </div>
      )}
    </SitePage>
  );
};

export default Anomalies;
