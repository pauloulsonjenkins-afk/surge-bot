# Claude in GoalBrew — a design proposal

Status: design only, no code. Written after a losing weekend, to give the owner a second opinion on alert strength before a bet goes out, and a way to interrogate the history afterwards. Nothing here places or blocks a real bet by itself — see **Safety** below.

## 1. Where Claude sits

Three distinct jobs, which should not be built as one feature:

### A. Per-alert async check (recommended first)
On every InPlayGuru alert, after `parse-alert.ts` has produced a `ParsedAlert`, send Claude a short judgement request **off the hot path**: it runs in the background and writes its verdict to a new column/record keyed by the pick's id. `bet-feed.ts` (`buildFeed`) and `betfair/direct.ts` (`runDirect`) never wait on it and never read it as a gate — they keep working exactly as today. The admin's Live tab and the Telegram alert simply show Claude's verdict once it lands a few seconds later, as an annotation: "⚠️ Claude: weaker than usual — momentum 52 vs InPlayGuru's own 68+ pattern" or "✅ looks in line."

This is the only one of the three that touches live timing at all, and even then only by *reading* a pick that's already been parsed and (optionally) already sent — it's a side channel, not a gate. Recommended first because:
- It's the one the owner actually asked for ("live warnings on alerts weaker than InPlayGuru suggests").
- It's the lowest-risk to build: a new table, a fire-and-forget call, a UI badge. No existing pipeline code changes.
- It generates the labelled data that makes the daily/weekly review and the Golden/LAY groups smarter later.

### B. Daily / weekly review
A scheduled job (piggybacking the existing daily-summary/weekly-review cron) that hands Claude a compact digest — yesterday's (or the week's) settled picks, grouped by strategy, with win/loss rates from `winloss.ts`, the Golden slice statuses from `golden.ts`, and any LAY group changes — and asks for a written note: what's drifting, which strategies/slices look shaky, whether a Golden badge loss or a stop-loss trip is a blip or a pattern. This is text for the admin to read, not a setting it changes. Natural second step once (A) is proven, because its input is literally the accumulated per-alert verdicts plus the existing P&L tables.

### C. "Ask about this pick"
An on-demand chat button on a pick's detail page (`server/pick-detail.ts`) — the owner clicks it, Claude is given that one alert's full parsed detail plus its strategy's recent form and any Golden/LAY context, and answers free-form questions ("why did this fire so late?", "has this strategy done this before at 0-0?"). Lowest priority: it's a nice-to-have UI feature, not a safety or judgement improvement, and it benefits from (A) and (B) already existing as reusable "fetch context for this pick" code.

**Recommendation: build A first, B second, C last** (or skip C initially — it's the one that adds the least to "better judgement on alert strength").

## 2. Data and prompt shape

For (A), the per-alert check, the prompt needs to be cheap and tightly scoped — not a general chat, a structured judgement call. Suggested inputs, assembled synchronously from already-loaded data (no extra API calls on the hot path):

- **The parsed alert itself** (`ParsedAlert` from `parse-alert.ts`): strategy, market, selection, minute, score, the stat lines (`stats` record — momentum, xG, key passes, whatever that strategy's alerts carry), the odds block (pre-match and live 1X2, over/under), country/competition, and critically the alert's own `matched` (£ volume) and `strikeRate` fields, since those are InPlayGuru's own confidence signals.
- **The strategy's recent form**, pulled from `winloss.ts`'s `computeStrategyForm` (already computed for the Strategies page): last-20-picks ROI, last-7-days ROI, current streak. This is what lets Claude say "momentum 52 is below this strategy's typical pattern" instead of guessing blind.
- **Whether this alert falls inside or outside a Golden slice**, from `golden.ts`'s `pickSegments`/`goldenReport` — a slice's status (`golden` / `candidate` / `not holding up`) and its own ROI, since a "weak-looking" alert that's actually in a proven Golden slice should get a different tone than one in open water.
- **Whether a LAY group would fire on it**, from `lay-groups.ts` — if this exact alert shape is one GoalBrew already knows loses when backed (e.g. next-goal alerts from Japan/Brazil), Claude should say so plainly rather than rediscover it.
- **League context**, from `football-data.co.uk` via `history/football-data.ts`'s `leagueProfiles` — home/draw/away splits, average goals, over-2.5%, BTTS% for that competition over the last six seasons. This is the one new category of input (nothing today feeds league profiles into a per-alert decision) and is exactly what turns "is this a normal 0-0 at 60' in Argentina's second division" into a checkable fact instead of a guess.

**Prompt shape**: a short system prompt fixing the job ("You are a second opinion on in-play football betting alerts. You do not place bets. Given one alert's details and its strategy's own track record, say in 1–3 sentences whether this specific alert looks stronger, in line with, or weaker than that strategy's usual pattern, and why.") plus a structured-output schema (`output_config.format`, not free text) returning something like `{ verdict: "stronger"|"in_line"|"weaker", confidence: "low"|"medium"|"high", note: string }`. Structured output means the admin page can render a consistent badge instead of parsing prose, and it keeps responses short (and cheap).

## 3. Model and cost at ~100 alerts/day

(From the `claude-api` skill's current pricing table.) Per-alert input is small — parsed alert + form + Golden/LAY/league context realistically assembles to roughly 1.5–3K tokens; output constrained by the schema to well under 200 tokens.

| Model | Input $/MTok | Output $/MTok | Est. cost per alert | ~100/day → monthly (≈3,000 alerts) |
|---|---|---|---|---|
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 | $0.50 | ~$0.0003–0.0004 | **≈ $1–1.50/month** |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2.00 | $10.00 | ~$0.006–0.009 | **≈ $18–27/month** |

**Recommendation: Haiku 5.5** for the per-alert check (A). This is a bounded classification task against data that's already structured — exactly the "chat, classification, high-volume" workload the pricing guidance says doesn't need higher-tier reasoning, and the cost difference (≈$1.50/month vs ≈$20+/month) is large relative to how marginal the quality gain would be for a judgement this narrow. If the owner finds Haiku's verdicts too shallow once real alerts are running through it, upgrading just this one call to Sonnet 5.5 is a one-line model-string change, not a redesign.

For (B), the daily/weekly review, the input is much larger (digests across many strategies and slices, prose output expected) but the call volume is tiny (1–7 a week). Sonnet 5.5 here costs a few cents a day at most — worth the better writing quality for something the owner actually reads.

For (C), "ask about this pick", it's interactive and low-volume (owner-triggered only); Sonnet 5.5 is the right default for a good back-and-forth.

**Total at 100 alerts/day with this split: roughly $2–5/month**, dominated by rounding on (B) and (C), not (A).

## 4. Owner-added Telegram tags

The owner wants to add tags such as "Over 1.5/2.5 prices" from InPlayGuru's own Telegram message. Looking at `parse-alert.ts`, the parser already reads an `Over/Under {line} Odds:` line into `odds.overUnderLine`/`odds.over`/`odds.under` — so if InPlayGuru's alerts already carry an Over 1.5 and Over 2.5 price line (two separate `Over/Under X Odds:` blocks, or one with both lines), the fix is to make `odds` hold an array/map of every line found instead of just one, rather than invent a new parsing concept. A newly-added stat line of the form `Label: a - b` is already captured generically into `stats` with no code change needed — that path already exists for "every stat is optional."

For a genuinely new piece of text (something that isn't a `Label: a - b` pair and isn't an `Over/Under` price block — e.g. a free-text tag InPlayGuru doesn't currently send), the practical move is: once the owner can see a real example of the new line in a captured alert, add one targeted regex to `parse-alert.ts` the same way every other field there was added (the file's own comments show this has been the pattern throughout — new fields added from real alert samples, never guessed). This proposal doesn't invent new parser rules sight-unseen; it flags where the hook already is so the next real example slots in fast.

The main value of owner-added price tags for Claude's job specifically: multiple pre-set lines (Over 1.5 *and* Over 2.5, not just the one line the strategy's own market cares about) let the per-alert check compare the market's own implied probability against the league's historic over/under rate from `football-data.ts` — a much sharper "is this alert's price sane" signal than a single line gives today.

## 5. StatsBomb — honestly

StatsBomb's free open data (the "StatsBombData" GitHub competitions) is **event-level data for a fixed set of historic competitions and seasons** (mostly World Cups, Women's World Cups, Champions League, FA WSL, La Liga, a few others) — it is not a live feed, not in-play, and does not cover GoalBrew's actual spread of leagues. GoalBrew's alerts fire across second-and-third-tier domestic leagues worldwide (Liga MX Femenil, Chile Cup, Japan, Brazil, Argentina's lower divisions, and the ~35 divisions `football-data.ts` already tracks) — almost none of which StatsBomb's free tier includes at all, and none of it live.

**Verdict: not usable for this feature.** StatsBomb free data is excellent for a one-off research question about a specific competition it does cover, but it cannot feed a live per-alert check, and it cannot even extend the league-profile side for most of GoalBrew's leagues, because the leagues don't overlap. `football-data.co.uk` (already integrated as `history/football-data.ts`) remains the right free source here: it is pre-match-odds-and-results coverage across almost exactly GoalBrew's league list, already downloading, already cached, and already free. No action needed on StatsBomb beyond noting it was considered and doesn't fit.

## 6. Safety

Non-negotiable, and consistent with how every existing gate in this codebase defaults to closed (`bet-feed.ts`'s own comment: "every gate defaults to closed"):

- Claude's output is **advisory only**. It never writes to `SendingSettings`, never calls `buildFeed`, never calls `betPickNow` or anything in `direct.ts`, and never flips a strategy's Live switch, a Golden slice's own betting, or a LAY group's stake. It has no code path that can place, skip, or cancel a bet.
- The per-alert verdict is stored and displayed; it does not gate `sendable` in `parse-alert.ts` and is not consulted anywhere in `buildFeed`'s skip logic. A "weaker" verdict shows as a warning badge next to a pick that still gets sent (or not) by the existing rules, exactly as today.
- If Claude's API is slow, down, or errors, nothing in the betting pipeline notices or waits — the per-alert check is fire-and-forget with its own timeout, and a missing verdict just means no badge, not a blocked pick.
- No Claude call ever receives Betfair credentials, API keys, or anything from `readCredentials`/`exchange.ts`. Its inputs are the alert's own parsed text, derived statistics, and public league history — nothing that could let a bad response reach Betfair even indirectly.
- Any future step that lets Claude's output *influence* sending (e.g. an owner-opt-in "auto-skip picks Claude flags as weak") is explicitly out of scope for this proposal and would need its own separate design and sign-off — not an extension of (A), (B) or (C) as built.

## 7. Phased plan

| Phase | What | Effort |
|---|---|---|
| 1 | Per-alert check (A): new table/column for verdicts, a fire-and-forget call on alert ingest (Haiku 5.5, structured output), admin badge on Live/pick-detail. No changes to `bet-feed.ts`, `direct.ts`, or any sending logic. | Small–medium. The call and schema are simple; most of the work is plumbing the context (form, Golden/LAY/league lookups) that mostly already exists as functions to call. |
| 2 | Daily/weekly review (B): extend the existing daily-summary/weekly-review cron to also build a digest and call Claude (Sonnet 5.5), store/display the note on the admin page. | Small. Digest assembly reuses `winloss.ts`/`golden.ts` outputs already computed for those pages. |
| 3 | Owner Telegram tags: generalize `parse-alert.ts`'s `odds` block to hold multiple Over/Under lines (not just one), from a real example of InPlayGuru sending more than one; add the price comparison into the Phase 1 prompt. | Small, but blocked on seeing a real multi-line alert sample first. |
| 4 | "Ask about this pick" (C): a chat endpoint on pick-detail (Sonnet 5.5), reusing Phase 1's context-assembly code. | Small–medium, and lowest priority — build only once 1–3 are proven useful. |

Total estimated running cost across all phases at ~100 alerts/day: roughly **$2–5/month**, trivial next to the stakes already in play, and each phase is independently useful and independently reversible (delete the table/column, remove the cron call, remove the UI button — nothing downstream depends on any of it).
