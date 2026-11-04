# Labelling rules

Every post gets exactly one of four labels: the mood it expresses toward the coins it names. For stock news, treat the stock as the coin. These rules apply to hand labels (`label hand`, `label audit`) and are sent word for word to the LLM that drafts labels (`label draft`), so humans and the model judge by the same standard.

| Label | Use when the post… | Examples |
| --- | --- | --- |
| `positive` | expects, welcomes or reports good news for the coin: price rising, adoption, upgrades, inflows, approval | "ETH staking inflows hit a record", "SOL looks strong into the weekend" |
| `negative` | expects, fears or reports bad news: price falling, hacks, outages, outflows, lawsuits, delistings | "Binance hack drains $6.3B", "BTC breaks support, more pain ahead" |
| `neutral` | informs or asks without a mood, or balances good and bad equally | "What wallet do you use for BTC?", "XRP opens at $2.10", "Pros and cons of staking ADA" |
| `off_topic` | uses a coin's name for something else, or names a coin only in passing in a post about something unrelated | "Watching Tron: Legacy tonight", "low-polygon 3D model", a giveaway or spam post |

## Rules

1. Judge the post's own mood, not whether you agree with it, and not what happened to the price afterwards.
2. Sarcasm counts as what it means: "great, another 20% dip" is `negative`.
3. Several coins: label the mood toward the coin the post is mainly about. If it is about all of them equally, label the overall mood.
4. Mixed: if one side clearly dominates, use it. If good and bad weigh the same, `neutral`.
5. A bare price or fact with no judgement is `neutral`, even if the number went up. "BTC at $77k" is `neutral`; "BTC finally back at $77k!" is `positive`.
6. Questions are `neutral` unless they carry a clear mood ("Is ETH dead?" is `negative`).
7. Promotion, shilling, referral links, giveaways and bots are `off_topic`: they are not anyone's honest view.
8. Unsure between two labels: pick the less extreme one (`neutral` over `positive` or `negative`).

`off_topic` posts are kept out of sentiment training and scoring; their count is reported on the model card.
