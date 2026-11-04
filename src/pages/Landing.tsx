import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { PulseInline, PulseMark } from "@/components/PulseLogo";
import "./landing.css";

type Asset = {
  name: string;
  ticker: string;
  fact: string;
  shape: string;
  mood: string;
  case: { for: string; against: string; watch: string };
};

// Example replies for the showcase. Live replies come from the model once signed in.
const ASSETS: Asset[] = [
  {
    name: "Bitcoin",
    ticker: "BTC",
    fact: "Launched in 2009, with supply capped at 21 million coins.",
    shape: "#dd390d",
    mood: "Cautiously bullish",
    case: {
      for: "Long-term holders are mostly sitting tight.",
      against: "Macro headlines can flip risk appetite fast.",
      watch: "How price behaves near its previous highs.",
    },
  },
  {
    name: "Apple",
    ticker: "AAPL",
    fact: "Founded in 1976, and listed on the Nasdaq since 1980.",
    shape: "#2c2c2c",
    mood: "Steady",
    case: {
      for: "Services revenue keeps growing beside the iPhone.",
      against: "Slower upgrades, and regulators watching the App Store.",
      watch: "Earnings and iPhone demand.",
    },
  },
  {
    name: "Ethereum",
    ticker: "ETH",
    fact: "Moved from proof of work to proof of stake in September 2022.",
    shape: "#dd390d",
    mood: "Mixed, leaning positive",
    case: {
      for: "Layer-2 activity keeps the builder story strong.",
      against: "Fee debates and faster rival chains.",
      watch: "Staking flows and layer-2 usage.",
    },
  },
  {
    name: "Nvidia",
    ticker: "NVDA",
    fact: "Founded in 1993. Its chips power much of today's AI.",
    shape: "#2c2c2c",
    mood: "Upbeat",
    case: {
      for: "Demand for AI chips keeps the story strong.",
      against: "A high valuation leaves little room for a miss.",
      watch: "Data centre spending and export rules.",
    },
  },
  {
    name: "Solana",
    ticker: "SOL",
    fact: "Its mainnet beta opened in March 2020.",
    shape: "#dd390d",
    mood: "Excitable",
    case: {
      for: "New apps and memecoin traffic keep it busy.",
      against: "Past outages come up in every bear case.",
      watch: "Network uptime and developer activity.",
    },
  },
  {
    name: "S&P 500 ETF",
    ticker: "SPY",
    fact: "Launched in 1993 as the first US-listed ETF.",
    shape: "#2c2c2c",
    mood: "Cautiously positive",
    case: {
      for: "It spreads risk across about 500 large US companies.",
      against: "A few giant tech stocks carry much of the index.",
      watch: "Interest rate decisions and company earnings.",
    },
  },
];

const STAGES = [
  {
    name: "Ask",
    clause: "First, ask in your own words",
    detail: "Type a question or tap a starter. Plain English works, and so do tickers.",
  },
  {
    name: "Read",
    clause: "Then Pulse reads the thread",
    detail: "Your question and up to 30 earlier messages go to Muse Spark, Meta's model, through the Meta Model API.",
  },
  {
    name: "Reply",
    clause: "Next, the reply streams in",
    detail: "Words appear as the model writes them, set in Markdown: bold, lists and all.",
  },
  {
    name: "Keep",
    clause: "Finally, it's kept for you",
    detail: "Each message is saved to your account, so the conversation is there next time you sign in.",
  },
];

const FAQS = [
  {
    anchor: "live-prices",
    topic: "Live prices",
    question: "Does Pulse see live prices?",
    answer:
      "For coins, yes: Pulse shows a recent price chart from CoinGecko. For stocks, it shows end-of-day prices from Twelve Data. Muse Spark, Meta's model, gets the same figures and Pulse's 24-hour mood. It describes what happened and lays out the arguments. It never predicts where a price goes next.",
  },
  {
    anchor: "financial-advice",
    topic: "Advice",
    question: "Is this financial advice?",
    answer:
      "No. Pulse is an educational tool: it explains what moves an asset and what the terms mean, and never tells you to buy, sell or hold. It can be wrong. For advice on your own money, speak to an FSCA-licensed financial adviser.",
  },
  {
    anchor: "your-chats",
    topic: "Your chats",
    question: "Where are my conversations stored?",
    answer:
      "In Firestore, under your account. Its security rules let only your signed-in account read or write your conversations.",
  },
  {
    anchor: "usage-limit",
    topic: "Limits",
    question: "Is there a usage limit?",
    answer:
      "Yes: about 20 messages a minute per account and 60 requests a minute per network, so one person can't crowd out everyone else.",
  },
  {
    anchor: "signing-in",
    topic: "Signing in",
    question: "How do I sign in?",
    answer: "With your Google account, or with an email address and a password of at least 6 characters.",
  },
  {
    anchor: "ai-key",
    topic: "Keys",
    question: "Does my browser hold an AI key?",
    answer:
      "No. The browser sends your Firebase sign-in token to the Pulse Worker, which checks it and calls the model through its own binding. There is no model key anywhere in the app.",
  },
];

// Real screens from the product. Rebuild them with live data if the pages change.
const FEATURES = [
  {
    title: "The mood, beside the price",
    text: "Ask about a coin or a stock and Pulse shows its price chart and a 24-hour mood read from real posts and headlines. The post count sits beside every mood, so you can judge how much weight it deserves.",
    src: "/shots/chat.webp",
    width: 1400,
    height: 1233,
    alt: "Pulse answering a question about Apple: a seven-day price chart, a mixed 24-hour mood from 69 posts, and the headlines behind it.",
    caption: "Apple's price and 24-hour mood, 4 November 2026.",
  },
  {
    title: "Large moves, in plain words",
    text: "See when big money moves onto or off an exchange, using labels from Arkham. Pulse says what moved and where, and reminds you that a move onto an exchange can mean selling, but often doesn't.",
    src: "/shots/moves.webp",
    width: 1400,
    height: 680,
    alt: "Bitcoin's 24-hour mood panel listing its largest moves on and off exchanges over the last day, with labels from Arkham.",
    caption: "Bitcoin's mood and large moves, 4 November 2026. Labels from Arkham.",
  },
  {
    title: "A lab for practice runs",
    text: "Make up a portfolio of coins and stocks, replay it through real events like the Covid crash, and see which asset drove each move. Risk measures show how rough the ride was. No real money is involved.",
    src: "/shots/lab.webp",
    width: 1400,
    height: 925,
    alt: "The Simulation lab replaying Bitcoin and Apple through the 2020 Covid crash, with one line per asset and the whole portfolio.",
    caption: "Bitcoin and Apple through the Covid crash of 2020.",
  },
  {
    title: "A library of past shocks",
    text: "Unusual market episodes since 2015, each with a short account of what moved and what happened next. A study compares those moves with normal periods, and says when a difference could just be noise.",
    src: "/shots/library.webp",
    width: 1400,
    height: 802,
    alt: "The post-shock study in the Anomaly library: returns after shocks against normal periods, by asset group, with 95% intervals.",
    caption: "What happened after a shock, by asset group.",
  },
];

const DETAILS = [
  { title: "Eight starter questions", text: "For when you don't know where to begin." },
  { title: "Streaming replies", text: "Text arrives as it is written." },
  { title: "History that stays", text: "Your last conversation loads when you sign back in." },
  { title: "Its own sentiment model", text: "FinBERT, fine-tuned on Muse Spark's labels." },
  { title: "Your chats, only yours", text: "No one else can read them." },
  { title: "No AI key in your browser", text: "Only your sign-in token leaves it." },
];

const CARD_COLOURS = ["#1c1c1c", "#2a2a2a", "#363636"];

// Public-domain pictures from Wikimedia Commons; credits are in the footer.
const ARCHIVE = [
  {
    src: "/archive/bulls-bears-1783.jpg",
    width: 1600,
    height: 985,
    position: "82% 50%",
    alt: "Engraving of a bull and a bear walking behind a procession of ducks with human heads.",
    title: "1783",
    caption: "The bulls and bears making long faces. Rambler's Magazine, London.",
  },
  {
    src: "/archive/gold-room-1870.jpg",
    width: 1600,
    height: 1092,
    position: "38% 60%",
    alt: "Engraving of traders in top hats shouting and waving in the crowded Gold Room exchange.",
    title: "1870",
    caption: "The Gold Room, New York. From Twenty Years Among the Bulls and Bears of Wall Street.",
  },
  {
    src: "/archive/bubbles-1901.jpg",
    width: 1600,
    height: 1080,
    position: "22% 50%",
    alt: "Cartoon of a bull in a checked suit blowing soap bubbles while a crowd of investors reaches for them.",
    title: "1901",
    caption: "Wall Street bubbles, always the same. Udo Keppler for Puck.",
  },
  {
    src: "/archive/panic-1907.jpg",
    width: 1245,
    height: 1548,
    position: "50% 60%",
    alt: "Photograph of a dense crowd filling Wall Street outside the Sub-Treasury building.",
    title: "1907",
    caption: "Crowds on Wall Street during the Bankers' Panic, October.",
  },
];

function BotAvatar() {
  return (
    <span className="ui-avatar">
      <PulseMark />
    </span>
  );
}

function AssetFragment({ asset }: { asset: Asset }) {
  return (
    <div className="ui-chat lp-swap" data-ui key={asset.ticker}>
      <div className="ui-row ui-row--user">
        <span className="ui-avatar">You</span>
        <p className="ui-bubble">How does the market feel about {asset.name}?</p>
      </div>
      <div className="ui-row">
        <BotAvatar />
        <div className="ui-bubble ui-bubble--bot">
          <p>
            <strong>Mood: {asset.mood.toLowerCase()}.</strong>
          </p>
          <ul>
            <li>
              <strong>For:</strong> {asset.case.for}
            </li>
            <li>
              <strong>Against:</strong> {asset.case.against}
            </li>
            <li>
              <strong>Watch:</strong> {asset.case.watch}
            </li>
          </ul>
        </div>
      </div>
      <p className="ui-meta">Example reply</p>
      <div className="ui-composer">
        <span className="ui-meta">Ask about a coin or stock</span>
        <span className="ui-send" aria-hidden="true">
          <Send size={16} />
        </span>
      </div>
    </div>
  );
}

function StageFragment({ stage }: { stage: number }) {
  const question = "Is Solana sentiment turning?";
  if (stage === 0) {
    return (
      <div className="ui-chat lp-swap" data-ui key="ask">
        <div className="ui-chips">
          <span className="ui-chip">Analyse Bitcoin sentiment</span>
          <span className="ui-chip">How is Apple doing this week?</span>
        </div>
        <div className="ui-composer">
          <span>
            {question}
            <i className="ui-caret" />
          </span>
          <span className="ui-send" aria-hidden="true">
            <Send size={16} />
          </span>
        </div>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className="ui-chat lp-swap" data-ui key="read">
        <div className="ui-row ui-row--user">
          <span className="ui-avatar">You</span>
          <p className="ui-bubble">{question}</p>
        </div>
        <div className="ui-row">
          <BotAvatar />
          <p className="ui-bubble ui-bubble--bot" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="ui-loader" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            Analysing...
          </p>
        </div>
      </div>
    );
  }
  if (stage === 2) {
    return (
      <div className="ui-chat lp-swap" data-ui key="reply">
        <div className="ui-row ui-row--user">
          <span className="ui-avatar">You</span>
          <p className="ui-bubble">{question}</p>
        </div>
        <div className="ui-row">
          <BotAvatar />
          <p className="ui-bubble ui-bubble--bot">
            <strong>Mood: improving, from a low base.</strong> New app launches keep the talk positive, while
            traders still bring up past outages
            <i className="ui-caret" />
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="ui-chat lp-swap" data-ui key="keep">
      <div className="ui-bar">
        <b>you@example.com</b>
        <span>Sign out</span>
      </div>
      <div className="ui-row ui-row--user">
        <span className="ui-avatar">You</span>
        <p className="ui-bubble">Compare BTC vs ETH sentiment</p>
      </div>
      <p className="ui-meta" style={{ textAlign: "right" }}>
        Yesterday, 21:14
      </p>
      <div className="ui-row ui-row--user">
        <span className="ui-avatar">You</span>
        <p className="ui-bubble">{question}</p>
      </div>
      <p className="ui-meta" style={{ textAlign: "right" }}>
        Today, 08:02
      </p>
    </div>
  );
}

function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("lp-js");
    const targets = document.querySelectorAll("[data-reveal], .lp-shutter");
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-in"));
      return () => root.classList.remove("lp-js");
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px 10% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      root.classList.remove("lp-js");
    };
  }, []);
}

// The hero mark drifts up slightly as the page scrolls, locked to the scrollbar.
function useHeroDrift(ref: React.RefObject<SVGSVGElement>) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, window.innerHeight);
        if (ref.current) ref.current.style.transform = `translateY(${y * -0.08}px)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [ref]);
}

const reveal = (d: number) => ({ "data-reveal": "", style: { "--d": d } as CSSProperties });

const Landing = () => {
  const navigate = useNavigate();
  const heroShape = useRef<SVGSVGElement>(null);
  const [picked, setPicked] = useState(0);
  const [stage, setStage] = useState(0);
  const [openFaq, setOpenFaq] = useState(0);
  const [question, setQuestion] = useState("How do Apple and Bitcoin compare?");
  const [account, setAccount] = useState<"sign-up" | "sign-in">("sign-up");

  useReveal();
  useHeroDrift(heroShape);

  useEffect(() => {
    document.title = "Pulse · Read the market mood";
  }, []);

  // A link to one question opens its answer.
  useEffect(() => {
    const index = FAQS.findIndex((item) => `#${item.anchor}` === window.location.hash);
    if (index >= 0) setOpenFaq(index);
  }, []);

  const start = (event: FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams({ mode: account });
    const trimmed = question.trim();
    if (trimmed) params.set("q", trimmed);
    navigate(`/app?${params.toString()}`);
  };

  const selected = ASSETS[picked];

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" aria-label="Pulse home">
          <PulseInline height={34} />
        </Link>
        <nav aria-label="Main">
          <ul>
            <li>
              <a href="#how-it-works">How it works</a>
            </li>
            <li>
              <a href="#features">Features</a>
            </li>
            <li>
              <Link to="/lab">Lab</Link>
            </li>
            <li>
              <Link to="/anomalies">Anomalies</Link>
            </li>
            <li>
              <a href="#faq">FAQ</a>
            </li>
            <li className="lp-nav-signin">
              <Link to="/app">Sign in</Link>
            </li>
            <li>
              <Link to="/app?mode=sign-up" className="lp-button lp-button--small">
                Create account
              </Link>
            </li>
          </ul>
        </nav>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="hero-title">
          <PulseMark className="lp-hero-shape" ref={heroShape} />
          <div className="lp-hero-copy">
            <h1 id="hero-title">
              <span>Read the</span> <span>market mood</span>
            </h1>
            <p>
              Pulse is your AI guide to learning how investing works. Ask about a coin or a stock and get the mood, both
              sides and what to watch, in plain words.
            </p>
            <Link to="/app?mode=sign-up" className="lp-button">
              Create account
            </Link>
          </div>
          <figure className="lp-hero-shot">
            <img
              src="/shots/hero.webp"
              alt="An Anomaly library episode: the April 2025 tariff shock, with how five assets moved during it and over the next 30 days."
              width={1176}
              height={726}
              decoding="async"
            />
            <figcaption>A real episode from the Anomaly library.</figcaption>
          </figure>
        </section>

        <section className="lp-coins" id="coins" aria-labelledby="coins-title">
          <div className="lp-coin-list">
            <h2 id="coins-title" {...reveal(0)}>
              Pick an asset
            </h2>
            <ul>
              {ASSETS.map((item, index) => (
                <li key={item.ticker} {...reveal(index + 1)}>
                  <button type="button" aria-pressed={picked === index} onClick={() => setPicked(index)}>
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-stage lp-shutter">
            <div className="lp-stage-shape" style={{ background: selected.shape }} />
            <div className="lp-stage-fragment" aria-live="polite">
              <AssetFragment asset={selected} />
            </div>
          </div>
          <p className="lp-fact" {...reveal(2)}>
            {selected.name} ({selected.ticker}). {selected.fact}
            <span>The reply shown is an example. Signed in, Pulse writes a fresh one for the asset you ask about.</span>
          </p>
        </section>

        <section className="lp-archive" id="history" aria-labelledby="history-title">
          <div className="lp-archive-head">
            <h2 id="history-title" {...reveal(0)}>
              Mood has always moved markets
            </h2>
            <p {...reveal(1)}>
              Bulls and bears in 1783, a frenzy in the Gold Room in 1870, bubbles in 1901, a crowd on Wall Street in
              1907. The feeling comes first. Pulse reads it for the assets you follow.
            </p>
          </div>
          <ul className="lp-archive-bars">
            {ARCHIVE.map((item, index) => (
              <li key={item.src} {...reveal(index + 1)}>
                <figure>
                  <div className="lp-archive-frame">
                    <img
                      src={item.src}
                      alt={item.alt}
                      width={item.width}
                      height={item.height}
                      loading="lazy"
                      decoding="async"
                      style={{ objectPosition: item.position }}
                    />
                  </div>
                  <figcaption>
                    <b>{item.title}</b>
                    {item.caption}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-how" id="how-it-works" aria-labelledby="how-title">
          <div className="lp-how-fields">
            <div className="lp-how-clause">
              <h2 id="how-title" className="lp-swap" key={`h${stage}`}>
                {STAGES[stage].clause}
              </h2>
              <p className="lp-swap" key={`p${stage}`}>
                {STAGES[stage].detail}
              </p>
            </div>
            <div className="lp-how-fragment">
              <StageFragment stage={stage} />
            </div>
            <div className="lp-how-control">
              <div className="lp-range">
                <div className="lp-range-track" />
                <div className="lp-range-fill" style={{ width: `${(stage / 3) * 100}%` }} />
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={stage}
                  onChange={(event) => setStage(Number(event.target.value))}
                  aria-label="How Pulse works, stage"
                  aria-valuetext={STAGES[stage].name}
                />
              </div>
              <ol className="lp-stages">
                {STAGES.map((item, index) => (
                  <li key={item.name}>
                    <button
                      type="button"
                      aria-current={stage === index ? "step" : undefined}
                      onClick={() => setStage(index)}
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="lp-features" id="features" aria-labelledby="features-title">
          <h2 id="features-title" {...reveal(0)}>
            What's inside
          </h2>
          {FEATURES.map((item) => (
            <article className="lp-feature" key={item.src}>
              <figure {...reveal(1)}>
                <img src={item.src} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" />
                <figcaption>{item.caption}</figcaption>
              </figure>
              <div className="lp-feature-copy" {...reveal(2)}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </article>
          ))}
          <ul className="lp-details" {...reveal(1)}>
            {DETAILS.map((item) => (
              <li key={item.title}>
                <b>{item.title}</b> {item.text}
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-faq" id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title" {...reveal(0)}>
            Before you ask
          </h2>
          <ul className="lp-cards">
            {FAQS.map((item, index) => {
              const open = openFaq === index;
              const style = { "--i": index, "--card": CARD_COLOURS[index % CARD_COLOURS.length], zIndex: index } as CSSProperties;
              return (
                <li className="lp-card" id={item.anchor} key={item.topic} style={style}>
                  <span className="lp-card-tab" aria-hidden="true">
                    {item.topic}
                  </span>
                  <div className="lp-card-body">
                    <h3>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={`faq-${index}`}
                        onClick={() => setOpenFaq(open ? -1 : index)}
                      >
                        {item.question}
                      </button>
                    </h3>
                    <p id={`faq-${index}`} className="lp-card-answer lp-swap" hidden={!open}>
                      {item.answer}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="lp-start" id="start" aria-labelledby="start-title">
          <div className="lp-start-copy">
            <h2 id="start-title" {...reveal(0)}>
              <span>Your turn</span> <span>to ask</span>
            </h2>
            <p {...reveal(1)}>Create an account and Pulse answers your question the moment you're in.</p>
          </div>
          <form className="ui-dialog" data-ui onSubmit={start} {...reveal(2)}>
            <h3>Ask Pulse</h3>
            <label>
              Your first question
              <input type="text" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} />
            </label>
            <fieldset className="ui-segment">
              <legend>Account</legend>
              <label>
                <input
                  type="radio"
                  name="account"
                  value="sign-up"
                  checked={account === "sign-up"}
                  onChange={() => setAccount("sign-up")}
                />
                <span>New to Pulse</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="account"
                  value="sign-in"
                  checked={account === "sign-in"}
                  onChange={() => setAccount("sign-in")}
                />
                <span>I have an account</span>
              </label>
            </fieldset>
            <button type="submit" className="lp-button">
              {account === "sign-up" ? "Create account" : "Sign in"}
            </button>
            <p className="ui-meta">Google or email. Your question is sent as soon as you're signed in.</p>
          </form>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-top">
          <PulseMark className="lp-footer-mark" />
          <div className="lp-footer-links">
            <div>
              <h2>Pulse</h2>
              <ul>
                <li>
                  <a href="#how-it-works">How it works</a>
                </li>
                <li>
                  <a href="#features">Features</a>
                </li>
                <li>
                  <a href="#faq">FAQ</a>
                </li>
              </ul>
            </div>
            <div>
              <h2>Account</h2>
              <ul>
                <li>
                  <Link to="/app?mode=sign-up">Create account</Link>
                </li>
                <li>
                  <Link to="/app">Sign in</Link>
                </li>
                <li>
                  <Link to="/lab">Simulation lab</Link>
                </li>
                <li>
                  <Link to="/anomalies">Anomaly library</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2>Built on</h2>
              <ul>
                <li>
                  <a href="https://dev.meta.ai/docs">Meta Model API</a>
                </li>
                <li>
                  <a href="https://firebase.google.com/">Firebase</a>
                </li>
              </ul>
            </div>
            <div>
              <h2>Model</h2>
              <ul>
                <li>Muse Spark</li>
                <li>Charts from CoinGecko and Twelve Data</li>
                <li>Large moves from Arkham</li>
                <li>
                  <Link to="/model-card">Model card</Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="lp-footer-base">
          <span>
            © 2026 Pulse. Educational, not financial advice. Archive pictures via Wikimedia Commons: Rambler's Magazine (1783),
            Udo Keppler (1901) and the New York Public Library (1907), public domain; Matthew Hale Smith (1870), no
            known copyright restrictions.
          </span>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
