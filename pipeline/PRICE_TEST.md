# Price tests: method, fixed in advance

Written 3 November 2026, before the sentiment model or the whale detector exists and before any test-window data has been looked at. Changing anything here after results are seen must be recorded below under "Changes", with the reason, and every result reported both ways.

The question for both tests: **does Pulse's signal tell us anything about the next move in price that simple guesses don't?** A "no" is a valid result and gets reported the same way as a "yes".

## Shared rules

- **Frozen models.** The sentiment model and the whale detector are trained and their thresholds chosen on data from before the test window. Nothing is tuned on the test window.
- **Test window.** The 60 consecutive UTC days starting the day after the model file is published (subtask 4.4).
- **Prices.** CoinGecko USD prices: the daily price at 00:00 UTC for the sentiment test, hourly prices for the whale test.
- **Coins.** Every tracked coin with at least 20 on-topic scored posts on at least 60% of the window's days. All of them are reported, including those with no effect. The pooled result is the primary one; per-coin results are exploratory.
- **Uncertainty.** 95% intervals by moving-block bootstrap (blocks of 7 days, 2,000 resamples), so runs of similar days aren't treated as independent.

## Test 1: sentiment and the next day's return (subtask 4.7)

- **Daily sentiment** for coin c on day d: the mean of P(positive) − P(negative) over that coin's on-topic posts created on day d.
- **Next-day return:** log(price on d+1 ÷ price on d).
- **Prediction:** "up" when the day's sentiment is above that coin's median sentiment over the window, otherwise "down".
- **Measures:**
  - Spearman correlation between day-d sentiment and the next-day return, pooled across coins and per coin.
  - Directional accuracy: the share of days where the prediction matches the sign of the next-day return.
- **Compared with:**
  - Always up.
  - Same as yesterday: predict the sign of day d's own return.
- **Verdict:** a signal only if the 95% interval of (Pulse accuracy − the better comparator's accuracy) is entirely above 0, pooled. Otherwise the result is "no reliable signal at this sample size", reported with its interval.

## Test 2: whale alerts and the next 24 hours (subtask 5.5)

- **Alerts:** transfers the detector flags in the test window.
- **Move after:** the absolute log return of the asset's coin over the 24 hours after the transfer's block time. USDT and USDC moves count against BTC and ETH, reported separately.
- **Compared with:** the same measure after ordinary, unflagged transfers of the same coin by watched wallets, in the same window.
- **Measure:** the difference in median absolute 24-hour return, alerts minus ordinary, with its bootstrap interval.
- **Secondary:** for alerts moving coins onto an exchange, the share followed by a negative 24-hour return, against the same share for ordinary inflows.
- **Verdict:** alerts precede bigger moves only if the interval for the difference is entirely above 0.

## Reporting

Both tests are published on the model card with:

- the window's dates
- the coins included and excluded, and why
- sample sizes
- every measure with its interval
- the verdict in one plain sentence

## Changes

None yet.
