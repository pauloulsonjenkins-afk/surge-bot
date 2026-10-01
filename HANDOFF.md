# Surge Bot: handoff notes (1 Oct 2026)

Read this first in a new chat. Everything below is pushed to `main` (latest commit `0fed724`).

## The project
- **Engine** (`apps/`): Node/TypeScript, SQLite (`apps/src/storage/engine-db.ts`). It listens to the InPlayGuru Telegram channel (`src/telegram/listener.ts`), parses alerts (`src/inplayguru/parse-alert.ts`) and serves the CSV bet feed that BF Bot Manager polls (`src/inplayguru/bet-feed.ts`). Internal API: `src/server/http.ts`.
- **Website** (`apps/web/`): Next.js 14 App Router, Tailwind, TanStack Query. It talks to the engine through `src/server/engine-client.ts`.
- **Deploy:** DigitalOcean App Platform builds both from `main` when you push. GitHub checks are in `.github/workflows/checks.yml` (engine typecheck + tests; web typecheck + lint).
- **Local checks** (Node and Git are installed; in PowerShell, refresh PATH first if a command isn't found):
  - engine: `cd apps; npm run typecheck; npm test`
  - web: `cd apps/web; npx tsc --noEmit -p tsconfig.json; npx next lint; npm run build`

## Done so far
1. **Redesign:** app shell with a sidebar on desktop and a tab bar on phones; shared UI parts (`web/src/components/ui/Card.tsx`); colour roles (accent, hit, loss, warn, destructive, chart) in `web/app/globals.css` and `tailwind.config.ts`; type scale with nothing below 12px; Inter font; compact Live rows; Dashboard hero row with breakdown tabs; a Schedule toolbar; admin menu grouped into Operate / Review / Setup; the old Results and Picks pages folded into "Amend results".
2. **Sim mode:** a pick is **Live** if it was actually sent to the bet feed, and **Sim** otherwise. Each strategy has a Live/Sim choice on the Sending page. Admins get an All / Live / Sim switch on Dashboard, Win/Loss and Strategies.
3. **Sim bets are recorded when the alert arrives** (`recordSimBets` in `bet-feed.ts`), using the same rules as the bet feed: stake at the time, minimum odds, stop loss, daily limit and age. All money figures go through one shared pricing module (`apps/src/server/pricing.ts`). Picks from before recording started use the strategy's current stake.
4. **Strategies page:** headline figure is return per £1 staked, sorted best first. After 50 priced picks it suggests trying a Sim strategy Live, or moving a losing Live one back to Sim.
5. **Trade Log:** admins see profit per pick and per day, and a Live/Sim tag on each row. **Sending:** Sim strategies get a "would have stopped" stop-loss preview. **Win/Loss:** the monthly cost comes off Live and All, not Sim.
6. **First Half Goal** (pre-match, Over 0.5 first-half goals) works end to end. The listener used to drop pre-match alerts because they have no timer; `isRealAlert` in `parse-alert.ts` now accepts a Kickoff line instead. The first catch-up sync after start-up reads back 500 messages to recover missed alerts.
7. ESLint is set up and a `.gitignore` added. Tests: 108 passing.
8. **Hit rate context** (Dashboard and Strategies): average odds, break-even hit rate after commission (`breakevenHitRate` in `pricing.ts`), a 95% range (`hitRateRange`), and return per £1 (admin only; `/api/stats` blanks `roi` for others).
9. **One confirm box:** every `window.confirm`/`alert` is replaced by `useDialog()` from `web/src/components/ui/ConfirmDialog.tsx` (native `<dialog>`, focus starts on Cancel). Money actions show stake, daily limit and stop loss, and the button names the action ("Put Live at £2.00"). Only the Users page's password `window.prompt` is left.
10. **Equity curve per strategy** (Strategies → "Equity curve and drawdown"): running profit, max drawdown, longest losing run, worst day and most losses in a row in one day (`ReturnTally` in `winloss.ts`, `GET /internal/strategies/equity`).
11. **Reconcile page** (Review → Reconcile): imports the bet history CSV from BF Bot Manager or Betfair (`apps/src/betfair/reconcile.ts`, table `betfair_bets`). Columns are found by name. Each bet is linked to the sent pick it was placed for (same match, within 4 hours), and the page shows the unmatched rate, slippage, and estimated vs actual profit per strategy. Automatic import: `tools/bf-import.ps1` posts new exports to `/imports/betfair/<BETFAIR_IMPORT_TOKEN>`.
12. **Live** groups alerts by match. **PWA:** `web/app/manifest.ts` and icons in `web/public/icons` (redraw with `web/scripts/make-icons.ps1`).

## Still open
- **Reconcile needs a real export.** The column names in `COLUMNS` (reconcile.ts) are a best guess at BF Bot Manager's export. Import one real file and check "Columns read" on the Reconcile page; add any missed header name to `COLUMNS`. Set `BETFAIR_IMPORT_TOKEN` on the engine before using the script.
- **First Half Corner Race can't be sent.** Its market has no Betfair mapping. Two things are needed first: (a) confirm the bet: the parser assumes Over 5.5 first-half corners, but it might be a race-to-X-corners market; (b) the exact Betfair market code and selection name. Then add it like First Half Goals: a branch in `buildFeed`, settings fields, Sending page inputs, and add it to `SENDABLE`.
- **Assumed odds:** First Half Goal and the corners strategy have no usable price in the alert. Set assumed odds for each on the Win/Loss page, or their Sim profit stays unpriced.
- **Next.js 14 → 16 upgrade** for 5 npm audit warnings (1 critical, 4 high), which only Next 16 fixes. The app doesn't use the affected features (image optimiser, server actions, rewrites, i18n) and runs on Linux, so this isn't urgent. Expect breaking changes: async `cookies()`, React 19, and `next lint` being removed.
- **Trade Log and Live are capped** at the latest 200 and 50 picks.

## Watch out
- **Always edit the latest files.** Pull from GitHub first; never paste in whole files from an old copy or another chat. Commit `691b792` did exactly that and undid recent work, breaking the deploy (repaired in `f588412`). If a deploy fails, run `git diff <previous> <new>` on the latest commit and look for removed lines that have nothing to do with its purpose.
- **Stats need a day or two of alerts** before the Sim figures on Strategies mean much.
