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
**Engine: done and committed (`0c9c322`, not pushed yet).** `apps/src/members/`:
- `permissions`, `config`, `store`, `email`, `catalogue`, `house`, `time`, `service`, `staking`, `stats`, `runner`;
- `live.ts`: every live check runs twice (when the bet is made and just before it's sent); refs `GM<id>`; house double-bet guard; member STOP and admin STOP ALL; `LIVE_CONFIRMATION`;
- `betfair-connection.ts` (house = admin only; vendor = not available), `secrets.ts` (AES-GCM, `MEMBERS_SECRET_KEY`);
- `stripe.ts`: checkout, portal, signed webhook at `/webhooks/stripe`, each event handled once;
- `community.ts`: filters over house picks, versions, tracked vs backtest records, a leaderboard adjusted for sample size, ownership checks;
- `views.ts`: what each page is sent, built per member;
- `routes.ts`: `/internal/members/*`, with the member id in the `X-Member-Id` header (see the file's header for the list).

Wiring:
- http.ts routes `/internal/members/*` (Bearer key) and `/webhooks/stripe`;
- main.ts starts `startMembers`;
- listener.ts and the webhook route call `wakeMembers()`.

Tests: `apps/tests/members.test.ts` (17 tests). All 228 engine tests pass.

## Status (5 Oct 2026)
**Built:**
- the engine (`0c9c322`);
- the website: `/members` pages, API proxy routes `app/api/members/[...path]` and `app/api/admin/members/[...path]`, the Members tab in the main navigation, and More > Admin > Setup > Members;
- the docs: `MEMBERS_PLATFORM.md`.

**Checks:** web typecheck, lint and `next build` pass; the engine has 228 tests passing. **Not yet tried in a browser against the live engine.**

**Still to do:**
1. Push, after the owner says so.
2. The owner sets up the engine settings (`MEMBERS_PLATFORM.md` section 11), the Stripe price and webhook, the price label on the admin page, and turns Public view off.
3. Click through `/members` live as a free, trial and paid account, and fix anything that turns up.
4. Later, if wanted:
   - email verification;
   - push notifications for members;
   - Betfair Software Vendor approval (members' own accounts);
   - opening up community sharing.

## Watch out
- The members code won't typecheck until `live.ts` exists. Don't commit `src/members` half-finished: the deploy runs tsc.
- The existing Live and Dashboard pages give full pick detail to anyone given the "live" page, or to everyone while **Public view** is on. Members must not be given those pages. Tell the owner to keep Public view off.
- `python - <<EOF` with an empty heredoc hangs the shell. Write scripts to files instead.
