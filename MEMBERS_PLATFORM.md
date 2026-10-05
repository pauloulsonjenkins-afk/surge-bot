# GoalBrew Members Platform (beta)

The Members platform lives at **/members**. It has its own layout and navigation and is reached from the **Members** tab on the main site. It is built on the existing engine, alerts, pricing and Betfair code. It doesn't replace them.

- Engine code: `apps/src/members/`.
- Website code: `apps/web/app/members/`, `apps/web/src/components/members/` and `apps/web/src/lib/members/`.
- Admin page: More > Admin > Setup > **Members**.

## 1. How it fits together
- **Accounts:** members are the site's existing accounts (`app_users`, the same sign-in). A row in `members` is created the first time someone opens /members, and they start on **Free**.
- **Who is asking:** the website reads the signed, httpOnly sign-in cookie on its own server and passes the account id to the engine (`X-Member-Id`, with the internal Bearer key).
  - The engine re-reads the account and works out the member's permissions itself.
  - The browser can't choose whose data it gets, or what it is allowed.
- **No hidden premium data:** each response is built for that member (`members/views.ts`). Anything they aren't allowed is left out of the response altogether, not hidden in the page.
- **Integrating later:** the navigation is in `src/lib/members/nav.ts` and the frame is `MembersShell`. Merging into the main site means adding those links to the main navigation and dropping the shell; the pages don't depend on it.

## 2. Memberships and permissions
Tiers (`members/permissions.ts`):

| Tier | What it is |
|---|---|
| free | everyone at sign-up |
| trial | the 7-day Premium Trial |
| paid | an active Stripe subscription, or a date the admin grants |
| expired | a trial or paid period has ended; gets the same as Free |
| suspended | set by the admin; nothing works |
| admin | set by the admin; everything works |

Permissions are capabilities, checked through `can()` and `strategyAllowed()`, never "is the member paid?":

| Capability | Free | Trial | Paid |
|---|---|---|---|
| Strategy names, daily and weekly results, simulation, automatic simulation, community page | ✓ | ✓ | ✓ |
| Strategy details, selections, upcoming opportunities | ✗ | **3 chosen strategies** | all |
| Advanced analytics, full history, full personal tracking, advanced staking and risk | ✗ | ✓ | ✓ |
| Create strategies, share strategies, Betfair connection, live betting | ✗ | ✗ | ✓ * |

\* Only when the matching feature switch is on. Live betting also needs everything in section 7.

The admin can change the matrix and the feature switches on the Members admin page; they are stored in the setting `members_config`.

## 3. Free
- Every offered house strategy's **name** and type (in-play or pre-match).
- **Today**, **this week** (from Monday, UK time) and **30 days**: wins, losses and hit rate, from the real settled alerts.
- A **simulation bank** (£100 by default) that can follow any strategy automatically with a flat stake.
- Simulated bets appear only **once settled**, without the match, market or minute, so they can't be used to bet the alert.
- History and personal figures cover the last 30 days.
- Never: the description, rules or bet of a strategy, which games qualify, any odds before kick-off, or live betting.

## 4. 7-day Premium Trial
- Starts when the member presses **Start**, on the trial page. The 3 strategies are chosen in that same step.
- **Exactly 3** strategies, all offered and all different. They are **fixed for the trial**: no route changes them. Only the admin's "Reset trial" clears them, and that allows one more trial.
- Checked on the engine: one trial per normalised email, ever. Gmail dots, +tags and googlemail.com count as the same address. Throwaway inbox domains can't start one.
- Trial members get the premium view for their 3 strategies, follow them in simulation automatically, and use advanced staking, risk limits and analytics. They never get live betting.
- A countdown shows from day one. Notifications go out at 3 days left, 1 day left and when it ends.
- At the end the account becomes **expired**, which behaves as Free. Nothing is deleted.

## 5. Paid
- Stripe subscription (`members/stripe.ts`). Paid access runs until the end of the period Stripe has been paid for, plus a day's grace.
- Members can manage their payment or cancel through Stripe's billing page (Settings).
- The admin can also grant paid access up to a date.

## 6. Calculations (one definition everywhere)
- **Win / loss:** an alert settled Hit / Miss. An amended result wins over the alert's own. Excluded alerts and alerts from hidden leagues don't count (except picks with real money on them).
- **Hit rate:** won ÷ (won + lost). Unsettled bets are never counted. Voids are left out.
- **ROI:** profit ÷ staked × 100.
- **House money:** a level £10 on every settled alert whose price is known, at that price, less commission on winnings. The commission is set in the members config (5% by default). Prices with no known value are left out of money figures.
- **Member simulation:**
  - the stake follows the member's staking method;
  - matched in full at the alert's price, less the configured slippage (0% by default);
  - settled from the alert's result with commission off winnings;
  - an alert withdrawn or postponed voids the bet (stake back);
  - the bank = starting bank + settled profit of the current simulation;
  - resetting starts a new simulation; old bets stay in the history.
- **Member live:** stake = the matched amount. Profit is Betfair's own figure once the bet appears in the account's settled bets; until then it is worked out from the alert's result.
- **Drawdown:** the largest fall from a high point of the running profit.
- **House, member and community figures are always separate.**

Bet statuses: pending, placing, matched, partially_matched, rejected (a check refused it), failed (Betfair refused it), cancelled, won, lost, void. Only won, lost and void are settled.

## 7. Live betting (real money)
A live bet needs **all** of these. They are checked when the bet is created and **again just before it is sent**:
1. the admin's master switch (`flags.liveBetting`, off by default);
2. the engine setting **`MEMBERS_LIVE_BETTING=allow`**;
3. a membership that includes live betting;
4. the member switched it on themselves, by typing the confirmation words, and hasn't pressed STOP;
5. a working Betfair connection (see section 8);
6. a strategy the admin has approved for live;
7. the member's risk limits, with the Betfair balance as the bank;
8. no other bet on this alert on the same Betfair account: not the bet feed (BF Bot Manager), not Direct betting, not another member;
9. the Betfair price now is within the member's tolerance of the alert's price (5% by default), and within their odds limits.

How bets are placed and tracked:
- If any check fails, no bet is placed. The bet is recorded as rejected or failed with the reason, and the member is told.
- Orders carry `customerOrderRef` "GM<bet id>". Betfair is asked for that reference before placing and whenever an answer is lost, so a bet is never sent twice.
- Stake still unmatched after 2 minutes is cancelled.
- **STOP:** each member has a STOP ALL LIVE BETTING button. The admin has one that stops every member. Both cancel waiting bets and move live follows back to simulation.
- **Duplicates:** the database allows one bet per member + alert + mode.

## 8. Betfair: what is and isn't possible
- **The house account** (the GoalBrew Betfair account set up on the engine with `BF_APP_KEY` and the login settings) can be used live by **admin members only**. Betfair's personal app keys may only bet for their owner.
- **Members' own accounts are not possible yet.** Betfair only lets an approved **Software Vendor** bet for other people:
  - it needs an application to Betfair and a licence fee;
  - members connect through Betfair's own login page (OAuth), so GoalBrew holds an access token, never a password.
  
  The design is ready (connection kind "vendor"; tokens would be encrypted with `MEMBERS_SECRET_KEY`), but it stays off until Betfair approves GoalBrew.
- Placing bets for other people may also raise UK Gambling Commission questions. Take advice before switching live betting on for paying members.
- **The delayed app key** gives delayed prices. Bets ask for the lowest acceptable price, so they still match at the best price on offer.

## 9. Community
- Paid members can build **private** strategies: one or more house strategies, narrowed by minute, odds and league.
- Their results are worked out from the real alerts ("system verified · simulation"). Nobody can type in figures.
- Each change of rules makes a new **version**. The tracked record judges each alert by the version in force when it arrived. A backtest of the current rules is shown separately and never ranks.
- Only the owner can see the rules or change, pause, archive or delete a strategy. Anyone else gets "No such strategy".
- Sharing and the **leaderboard** stay off ("Coming soon") until the admin switches on Community and Sharing.
  - Ranking uses ROI adjusted for sample size: ROI × n ÷ (n + 100).
  - Fewer than 20 tracked bets aren't ranked.

## 10. Notifications, audit and analytics
- **In-app notifications:** trial started, ending and ended; strategy alerts (for members allowed the selections); bets not placed; live bets placed; Betfair connection failures; risk limits reached; kill switches; payments.
- **Audit log (`member_audit`):** registration, trial start, refusal and expiry, membership changes, upgrades, strategy creation and changes, bet attempts, placements and rejections, automation on and off, risk limit changes, kill switches. The latest 100 show on the admin page.
- **Funnel events (`member_events`):** registration, trial started, strategies chosen, strategy viewed, simulation used, premium feature clicked, upgrade prompt shown, upgrade clicked, trial expired, paid subscription started, Betfair connected, automation enabled.

## 11. Engine settings (DigitalOcean)

| Setting | What for |
|---|---|
| `MEMBERS_LIVE_BETTING=allow` | allows real-money member bets (the admin's master switch is also needed) |
| `MEMBERS_SECRET_KEY` | encrypts stored member secrets (needed only once vendor login exists) |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | subscriptions |
| `MEMBERS_SITE_URL` | the website address for Stripe's return links |

Stripe webhook endpoint: `https://<site>/engine/webhooks/stripe`. Events to send:
- `checkout.session.completed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `invoice.payment_failed`

## 12. Important
- **Turn Public view OFF** (Admin > Settings). While it is on, anyone can see every alert in full on the main site's Live and Trade Log, which is what Members pay for.
- Don't give members the old per-page access (Admin > Users) unless you mean to.
- **Upcoming:** most strategies fire in-play, so there is no long schedule in advance. Upcoming shows what can be bet right now (in-play alerts for a few minutes, pre-match ones until kick-off).
- **Tests:** `apps/tests/members.test.ts` covers tiers, what Free can see, the trial and its 3-strategy limit, expiry, simulation, voids, risk limits, duplicates, live safety, the kill switches, Stripe and community ownership.
