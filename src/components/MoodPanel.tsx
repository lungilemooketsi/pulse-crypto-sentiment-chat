import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isAged, loadSnapshot, moveLine, movesFor, type Snapshot } from "@/lib/sentiment";

// Diverging poles with a grey midpoint; every share is also written out, so colour never carries it alone.
const POLES = { negative: "hsl(var(--destructive))", neutral: "hsl(var(--muted-foreground) / 0.45)", positive: "hsl(var(--success))" };
const ORDER = ["negative", "neutral", "positive"] as const;

const hoursAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
const whenMoved = (iso: string) => {
  const hours = hoursAgo(iso);
  return hours < 1 ? "Under an hour ago" : hours === 1 ? "1 hour ago" : `${hours} hours ago`;
};

const MoodPanel = ({ symbol }: { symbol: string }) => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSnapshot().then((value) => !cancelled && setSnapshot(value));
    return () => {
      cancelled = true;
    };
  }, []);

  const coin = snapshot?.coins[symbol];
  if (!snapshot || !coin) return null;
  const age = hoursAgo(snapshot.generated_at);
  const moves = movesFor(snapshot, symbol);
  const summary = `24-hour mood for ${coin.name}: ${coin.mood}, score ${coin.score.toFixed(2)} from ${coin.posts} posts. ${ORDER.map((k) => `${Math.round(coin.share[k] * 100)}% ${k}`).join(", ")}.`;

  return (
    <div className="space-y-2 pt-1" aria-label={summary}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-foreground">
          <span className="font-medium">24-hour mood: {coin.mood}</span>{" "}
          <span className="text-muted-foreground">
            from {coin.posts} posts{isAged(snapshot) ? `, ${age} hours old` : ""}
          </span>
        </p>
        <span className="text-sm tabular-nums text-foreground">
          {coin.score > 0 ? "+" : ""}
          {coin.score.toFixed(2)} <span className="text-muted-foreground">on −1 to +1</span>
        </span>
      </div>

      <div className="flex h-2 w-full gap-[2px]" aria-hidden="true">
        {ORDER.map((kind) =>
          coin.share[kind] > 0 ? <span key={kind} style={{ width: `${coin.share[kind] * 100}%`, background: POLES[kind] }} /> : null,
        )}
      </div>
      <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground tabular-nums">
        {ORDER.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3" style={{ background: POLES[kind] }} aria-hidden="true" />
            {Math.round(coin.share[kind] * 100)}% {kind}
          </span>
        ))}
      </p>

      {coin.headlines.length > 0 && (
        <ul className="space-y-1 text-sm">
          {coin.headlines.map((headline) => (
            <li key={headline.url} className="leading-snug">
              <a href={headline.url} target="_blank" rel="noreferrer" className="text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground">
                {headline.title}
              </a>{" "}
              <span className="text-xs text-muted-foreground">
                {headline.feed ?? "news"} · read as {headline.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {moves.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Large moves, last 24 hours</p>
          <ul className="space-y-1 text-sm">
            {moves.map((move) => (
              <li key={move.url + move.exchange} className="leading-snug">
                <a href={move.url} target="_blank" rel="noreferrer" className="text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground">
                  {moveLine(move, coin.name)}
                </a>{" "}
                <span className="text-xs text-muted-foreground">{whenMoved(move.at)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            A move onto an exchange can mean selling, but often doesn't. Labels from{" "}
            <a href="https://intel.arkm.com" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              Arkham
            </a>
            , which can be wrong.
          </p>
        </div>
      )}

      {snapshot.fear_greed && coin.kind !== "stock" && (
        <p className="text-sm text-foreground">
          <span className="font-medium">Whole crypto market: {snapshot.fear_greed.label}</span>{" "}
          <span className="tabular-nums text-muted-foreground">{snapshot.fear_greed.value} of 100</span>{" "}
          <span className="text-xs text-muted-foreground">
            Fear &amp; Greed Index from{" "}
            <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              Alternative.me
            </a>
          </span>
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {coin.kind === "stock" ? "Company news from Finnhub" : "Bluesky posts and news headlines"}, each labelled by an AI model and not checked by a person.{" "}
        <Link to="/model-card" className="underline underline-offset-2 hover:text-foreground">
          How this works
        </Link>
      </p>
    </div>
  );
};

export default MoodPanel;
