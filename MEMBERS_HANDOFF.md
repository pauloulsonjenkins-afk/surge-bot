# Members Platform: build handoff

Read this first in a new chat, with HANDOFF.md. It says where the Members Platform build has got to.

## Decisions (agreed with the owner, 5 Oct 2026)
- **Paid:** Stripe subscriptions (Checkout and a webhook). The price lives in Stripe; the engine needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID`.
- **InPlayGuru:** the owner says they have permission to share alerts with paying members, so sign-up is open to the public.
- **Betfair live for members:** everyone runs in simulation. Real member bets sit behind a master switch, off by default, and also need the engine setting `MEMBERS_LIVE_BETTING=allow`.
  - Other members' own Betfair accounts need Betfair Software Vendor approval and Betfair's login (OAuth). Their passwords are never stored.
  - The admin may bet live through the members pipeline on the house Betfair account (connection kind "house"). It must never bet a pick the bet feed or Direct betting already bet on that account.
- **Trial abuse:** basic protection, no email verification yet.
  - One trial per normalised email, ever.
  - Throwaway email domains can't start a trial.
  - The admin can reset or extend a trial.
- **Trial:** starts when the member presses Start. The 3 strategies are chosen in that same step and locked for the 7 days. Simulation only, never live.
- **Free:** strategy names, today/this week/30-day wins, losses and hit rate, and a simulation bank. Bets show only once settled, with no teams, market or minute. Nothing premium is sent to the browser: the engine builds only the views each member is allowed.
- **House money figures:** a level £10 on every settled alert with a known price, after commission (`commissionPct` in the members config, 5% by default). ROI = profit / staked × 100.

## Where the code is
Engine, `apps/src/members/`. These files exist but are **not committed** yet:
- `permissions.ts`: tiers, capabilities, the default matrix, feature flags, `accessFor`, `strategyAllowed`.
- `config.ts`: the `members_config` setting (flags, tier overrides, trialDays, trialStrategyLimit, published and live-approved strategies, sim slippage, commission).
- `store.ts`: all the tables and queries (`membersStore(db)`).
  - Bets are unique per member + pick + mode.
  - Uses `db.sqlite` and `db.changed()`, added to EngineDb.
- `email.ts`: `emailKey` (normalises Gmail dots and +tags) and the disposable-domain list.
- `catalogue.ts`: published strategies, `memberStrategyKey` (follows strategy merges), the card/detail/full-pick views, `pickPrice`, `pickState`.
- `house.ts`: house stats (`houseStats`, memoised) and `MoneyTally`.
- `time.ts`: `addDaysUk`, `ukWeekStart`.
- `service.ts`:
  - `memberContext` (also switches live off when it's no longer allowed);
  - `trialStatus`, `startTrial` (all rules on the server);
  - `runMembershipNotices` (3 days left, 1 day left, ended, paid ended);
  - `adminUpdateMember`, `CLIENT_EVENTS`.
- `staking.ts`: `computeStake` (five methods), `checkRisk`, `cleanRisk`.
- `stats.ts`: member performance (`summarise`, `byStrategy`, `equityCurve`, `todayTotals`, `openExposure`).
- `runner.ts`:
  - turns each alert into bets for followers (sim now; live via `live.ts`);
  - settles simulated bets;
  - `simulateManually`, `startMembers`, `wakeMembers`.

Other changes already pushed: `alertOddsOfPick` is exported from bet-feed.ts, and EngineDb has `sqlite` and `changed()`.

## Still to build (in order)
1. `live.ts`: `LiveDeps`, `createLiveBet`, `executeLiveBets`, `settleLiveBet`, live readiness, enable/disable, the member kill switch and the global kill switch.
2. `betfair-connection.ts` (status, test; house = admin only; vendor = "needs Betfair approval") and `secrets.ts` (AES-GCM with `MEMBERS_SECRET_KEY`).
3. `stripe.ts`: checkout, the billing portal and the webhook (`/webhooks/stripe` on the engine, signature checked, each event handled once).
4. `community.ts`: private strategies as filters over house picks, versions, backtest, a leaderboard ranked with sample size taken into account, behind the `community` flag.
5. `routes.ts`: `/internal/members/*`, wired into http.ts. Also `startMembers` in main.ts, and `wakeMembers` in listener.ts and the webhook route.
6. Tests in `apps/tests/members-*.test.ts`:
   - free can't see selections; trial can't reach a 4th strategy;
   - trial expiry returns the account to Free; duplicates are blocked;
   - risk limits work; simulation never touches Betfair; live is blocked unless every check passes.
7. Web:
   - `/members/*` with its own layout (beta badge), a Members tab in the main navigation, the API routes and queries;
   - pages: dashboard, strategies, strategy detail, trial picker, upcoming, performance, history, automation, community (coming soon), settings, upgrade;
   - an admin Members page.
8. Docs: write up MEMBERS_PLATFORM.md (permissions, trial rules, calculations, Betfair limits, the env settings).

## Watch out
- The members code won't typecheck until `live.ts` exists. Don't commit `src/members` half-finished: the deploy runs tsc.
- The existing Live and Dashboard pages give full pick detail to anyone given the "live" page, or to everyone while **Public view** is on. Members must not be given those pages. Tell the owner to keep Public view off.
- `python - <<EOF` with an empty heredoc hangs the shell. Write scripts to files instead.
