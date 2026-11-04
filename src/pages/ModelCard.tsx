import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PulseInline } from "@/components/PulseLogo";
import { loadAnomalies, type AnomalyData } from "@/lib/datasets";
import { loadSnapshot, type Snapshot } from "@/lib/sentiment";

// Copied into the site by the Deploy workflow, because the repository is private.
const DOCS = "/docs";

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// From the Train run of 4 November 2026, on the 521 latest posts.
const RESULTS = [
  { name: "Pulse's model (FinBERT)", all: "0.67", mood: "0.69", same: "70%" },
  { name: "DistilRoBERTa", all: "0.62", mood: "0.64", same: "64%" },
  { name: "TF-IDF with logistic regression", all: "0.61", mood: "0.59", same: "65%" },
  { name: "VADER", all: "0.30", mood: "0.53", same: "34%" },
];

const ModelCard = () => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyData | null>(null);

  useEffect(() => {
    document.title = "Pulse · Model card";
    loadSnapshot().then(setSnapshot);
    loadAnomalies().then(setAnomalies);
  }, []);

  const coins = snapshot ? Object.entries(snapshot.coins) : [];

  return (
    <div className="min-h-svh">
      <header className="container mx-auto px-4 h-16 flex items-center">
        <Link to="/" aria-label="Pulse home">
          <PulseInline height={28} />
        </Link>
      </header>

      <main className="container mx-auto px-4 max-w-3xl pb-24 space-y-12">
        <section className="space-y-4 pt-8">
          <h1 className="font-display text-4xl font-bold tracking-tight">Model card</h1>
          <p className="text-lg">
            How Pulse turns posts and news into a 24-hour mood for each asset, and what it can't tell you. Pulse is an educational
            tool: the mood describes what people are posting, not where the price will go.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">What it measures</h2>
          <p>
            For each asset, the share of posts from the last 24 hours that read as positive, neutral or negative, and a
            score from −1 (every post negative) to +1 (every post positive). An asset needs at least 5 on-topic posts before
            its mood is shown.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Data</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Bluesky posts that name a tracked coin, read through Bluesky's public search.</li>
            <li>Headlines from CoinDesk, Cointelegraph, Decrypt, Bitcoin Magazine and The Block.</li>
            <li>Company news for each tracked stock and ETF, from Finnhub.</li>
            <li>Moves of $10 million or more onto and off exchanges on Bitcoin, Ethereum and Solana, from Arkham. Only organisations are named, and Arkham's labels can be wrong.</li>
            <li>The Crypto Fear &amp; Greed Index from Alternative.me, shown as it is published and separate from Pulse's mood.</li>
            <li>Collected every 3 hours. Authors are stored only as a hash, enough to spot repeat posters.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">How posts are labelled</h2>
          <p>
            Each post is labelled positive, neutral, negative or off-topic. Pulse's own model labels Bluesky posts and crypto
            headlines. It is FinBERT, by Prosus AI, fine-tuned on labels from Muse Spark, Meta's model, so it is a small copy of
            Muse Spark's judgement. Muse Spark labels stock news itself, because the model wasn't trained on any. Both follow
            written{" "}
            <a href={`${DOCS}/LABELLING.md`} className="underline underline-offset-4">
              labelling rules
            </a>
            . Off-topic covers posts that use a coin's name for something else, such as Tron the film, and spam. They are
            left out of the mood.
          </p>
          <p>FinBERT is licensed CC BY-NC-SA 4.0, for non-commercial use, and Pulse uses its model on the same terms.</p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Accuracy</h2>
          <p>
            <strong>Accuracy isn't measured. Agreement with Muse Spark is.</strong> No person has checked any labels, so these
            scores say how closely each model matches Muse Spark on 521 later posts, not how often it is right. Repeated posts
            were removed first, and the model was chosen on separate posts before this test.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-1 text-left font-normal">Model</th>
                  <th className="py-1 pl-3 text-right font-normal">All four labels</th>
                  <th className="py-1 pl-3 text-right font-normal">On-topic mood</th>
                  <th className="py-1 pl-3 text-right font-normal">Same label</th>
                </tr>
              </thead>
              <tbody>
                {RESULTS.map((row) => (
                  <tr key={row.name} className="border-t">
                    <td className="py-1.5">{row.name}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.all}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.mood}</td>
                    <td className="py-1.5 pl-3 text-right tabular-nums">{row.same}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            The first two columns are macro-F1, from 0 to 1. Pulse's model scored 0.63 to 0.72 on all four labels, as a 95% interval. Tested 4 November 2026.
          </p>
          {snapshot?.model?.agreement != null && (
            <p>
              In the latest run, Pulse's model and Muse Spark gave the same label to {Math.round(snapshot.model.agreement * 100)}% of {snapshot.model.checked} posts checked.
            </p>
          )}
          <p>
            Whether the mood says anything about the next day's price is also untested. The method for that test is
            written down in advance in{" "}
            <a href={`${DOCS}/PRICE_TEST.md`} className="underline underline-offset-4">
              PRICE_TEST.md
            </a>
            , so it can't be bent to fit the results.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Limits</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Bluesky and news headlines are not the whole market. Most trading talk happens on X, which Pulse can't read for free.</li>
            <li>Bots and shilling can inflate a mood; obvious promotion is labelled off-topic, but not all of it is caught.</li>
            <li>An asset with few posts swings easily. The post count is always shown beside the mood.</li>
            <li>Pulse's model learned from about 1,000 crypto posts, so it can miss new slang, and it disagrees with Muse Spark on roughly 3 posts in 10.</li>
            <li>A large move onto an exchange can be a sale, a transfer or an exchange's own housekeeping. Pulse doesn't say which.</li>
            <li>The chat's AI sees the mood and price figures, and is told never to turn them into predictions or advice.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Simulation lab</h2>
          <p>
            The{" "}
            <Link to="/lab" className="underline underline-offset-4">
              lab
            </Link>{" "}
            replays made-up portfolios through real daily closes from Coinbase and FRED, with rates and inflation from FRED and the World Bank. Replays ignore fees, tax and slippage. What-if shocks are
            stated assumptions, not estimates. Pulse never proposes a portfolio. There is deliberately no forward simulation of returns, because that would read as a forecast.
          </p>
          <p>
            Risk measures come from the replay's daily returns and need at least 30 days. Volatility is annualised over 365 days, because closes are carried over weekends. VaR and expected shortfall are
            historical, taken from the period's own worst 5% of days, so they describe it and don't estimate future losses. Sharpe and Sortino use the dollar replay and the US federal funds rate, because the
            data has no rand rate.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Anomaly library</h2>
          <p>
            The{" "}
            <Link to="/anomalies" className="underline underline-offset-4">
              library
            </Link>{" "}
            flags a day when its 1-day or 3-day move is at least 4 standard deviations from that asset's previous 90 trading days, or is among the largest 1.5% of the asset's moves since 2015. The second
            test looks at the whole record, so it can't spot anything live.
          </p>
          {anomalies && (
            <p>
              <strong>
                It finds {anomalies.known_events.found} of {anomalies.known_events.total} known events
              </strong>{" "}
              on a list written before it was first run. That figure flatters it: the first version found 13 of 30, and the rule was then revised against the same list, so it isn't an independent test.
              The list's dates are from memory.
            </p>
          )}
          <p>Each episode's category and summary come from Muse Spark reading that week's headlines from GDELT, which starts in 2017. No person has checked them yet, so their accuracy is not measured.</p>
          <p>
            The post-shock study compares each asset's return after an episode ends with its returns away from episodes and their follow-up windows, over 1, 5 and 30 days. Its 95% intervals come from 2,000
            bootstrap draws that resample whole calendar quarters, for the episodes and the normal periods together, because shocks cluster and 30-day windows overlap.
          </p>
          <p>
            <strong>The intervals run slightly narrow.</strong> In a check on 4 November 2026, all episodes were moved to random dates 150 times, keeping their clustering. 7.9% of rows still looked clear,
            against the 5% a true 95% interval would give, so the page counts on that higher rate. The comparisons aren't independent of each other. Episodes are chosen with hindsight, so the study can't
            show that anyone could have profited.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Current snapshot</h2>
          {snapshot ? (
            <>
              <p>
                Built {when(snapshot.generated_at)} from {snapshot.coverage.labelled} labelled posts out of{" "}
                {snapshot.coverage.posts_in_window} collected in the previous 24 hours.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-2 font-normal">Coin</th>
                    <th className="py-2 font-normal">Mood</th>
                    <th className="py-2 font-normal text-right">Score</th>
                    <th className="py-2 font-normal text-right">Posts</th>
                  </tr>
                </thead>
                <tbody>
                  {coins.map(([symbol, coin]) => (
                    <tr key={symbol} className="border-t">
                      <td className="py-2">
                        {coin.name} ({symbol})
                      </td>
                      <td className="py-2">{coin.mood}</td>
                      <td className="py-2 text-right tabular-nums">
                        {coin.score > 0 ? "+" : ""}
                        {coin.score.toFixed(2)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{coin.posts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-muted-foreground">No snapshot has been published yet.</p>
          )}
        </section>

        <p className="text-sm text-muted-foreground">Educational, not financial advice.</p>
      </main>
    </div>
  );
};

export default ModelCard;
