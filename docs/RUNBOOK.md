# GoalBrew runbook

What to do when something needs doing or goes wrong. Written 12 Nov 2026 from the code and from what has actually
happened; where a step has not been tried it says so. Standing rules are in `CLAUDE.md` and come first.

Live site: https://seashell-app-z8xl5.ondigitalocean.app
Health page (public, read-only): https://seashell-app-z8xl5.ondigitalocean.app/engine/health

## 1. Is it working? (30 seconds)

Open the health page. All of these should hold:

| Field | Healthy |
|---|---|
| `ok` | `true` |
| `telegram.connected` | `true` |
| `telegram.sessionDead` | `false` |
| `telegram.connectError` | `null` |
| `telegram.lastAlertAt` | recent during matches (it is empty for a few minutes after a deploy) |
| `backup.lastError` | `null` |
| `backup.lastSuccessAt` | within the last few minutes while alerts are arriving |
| `loop.maxMs` | under about 500. Higher means alerts and bets waited that long in the last minute. |
| `reportWorker.on` | `true` only if `REPORT_WORKER=1` has been set (section 7) |

GitHub asks the same questions once an hour (Actions → Health watch) and goes red if any fail.

## 2. Pause all betting

On the site: **Betting → Limits and switches**, turn the master switch off. Nothing new is sent to Betfair; bets
already placed carry on. Each strategy also has its own Live / Sim switch on **Strategies**.

This is a real-money setting: an assistant only changes it when the owner says so.

Not yet followed end to end by the owner from this page. Do it once on a quiet day so it is familiar.

## 3. No alerts are arriving

1. Health page: is `telegram.connected` true?
2. If `sessionDead` is true, Telegram has cancelled the session (it happened on 19 Oct 2026 after seven deploys in two
   hours). Retrying cannot revive it. The owner logs in again on **Admin → Settings → Telegram**, chooses the alerts
   chat, and pastes the new `TELEGRAM_SESSION` shown there into DigitalOcean (engine component → environment
   variables). It is a credential: only the owner handles it.
3. If it is connected but `lastAlertAt` is old during matches, check InPlayGuru is sending (its own app or channel)
   before suspecting GoalBrew.
4. Never start a second copy of the engine, or anything else, on the same Telegram session.

## 4. Deploying

- A push to `main` that touches anything under `apps/` rebuilds the site and the engine, and the engine restarts,
  even when only the site changed. A push that only added a file under `.github/` did not rebuild anything
  (12 Nov 2026); treat any other push as a restart until it has been seen not to be.
- Batch changes into one push. Several engine restarts close together are what got the Telegram session cancelled.
- After a push, watch the site's build id change (`curl -sL <site>/members`, the `"b":"..."` value) and then the health
  page until `telegram.connected` is true again.
- From 12 Nov 2026 the new container connects as soon as the old one writes its "let go" note (`release.json` in the
  backup Space), and after 90 seconds if no note comes. The first deploy that carries this change still takes the
  full wait, because the container it replaces is the old code.
- DigitalOcean can miss a push (21 Oct 2026). If the build id has not changed after about 12 minutes, look at
  DigitalOcean → seashell-app → Activity; if the commit is not listed, Actions → Deploy starts it.
- Avoid match hours when you can.

## 5. A bad deploy

DigitalOcean → seashell-app → Activity → pick the last good deployment → Rollback. The owner does this (it needs the
DigitalOcean sign-in). The database is not rolled back with the code: it restores from the backup Space as usual.

## 6. Restoring the database

The engine restores `engine.db` from the Space at start-up, and keeps dated daily copies under `daily/` beside it.
Restoring an older day by hand has not been rehearsed. Before trying it for real: stop the engine first, so it cannot
upload over the copy being restored.

## 7. Switching the report worker on (optional, makes pages stop blocking alerts)

The heavy admin reports can be worked out on a second thread. It is off until `REPORT_WORKER=1` is set on the engine
component in DigitalOcean. Before switching it on, note `loop.maxMs` on the health page over a busy hour. After:

- `reportWorker.on` should be `true` and `reportWorker.done` should climb as pages are opened;
- `loop.maxMs` should fall;
- watch the component's memory in DigitalOcean → Insights for a day. The worker holds a second copy of the settled
  picks; if memory nears the limit, remove the variable again.

If the worker fails it restarts itself, and meanwhile reports are worked out the old way. Removing the variable and
redeploying turns it off completely.

## 8. Secrets and where they live

All are environment variables in DigitalOcean, set and changed only by the owner. None is in the repository.

| Variable | Component | What it is | To change it |
|---|---|---|---|
| `ADMIN_PASSWORD` | site | the admin sign-in | set a new value, redeploy |
| `ADMIN_SESSION_SECRET` | site | signs the admin session cookie | set a new value, redeploy; everyone is signed out |
| `ADMIN_INTERNAL_KEY` | site and engine (same value) | lets the site call the engine | set the same new value on both, redeploy |
| `AGENT_READ_KEY` | site | read-only key for the agent routes | set a new value, redeploy, update the agents |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | engine | the Telegram app the engine connects as | from my.telegram.org |
| `TELEGRAM_SESSION` | engine | the logged-in Telegram session | section 3 |
| `TELEGRAM_SOURCE_CHAT_ID` | engine | the chat alerts are read from | chosen on Admin → Settings → Telegram |
| `INPLAYGURU_WEBHOOK_PATH_TOKEN`, `INPLAYGURU_SIGNING_SECRET` | engine | the webhook address and its signature | from InPlayGuru |
| `SPACES_*` | engine | the backup Space and its keys | DigitalOcean → API → Spaces keys |
| `BETFAIR_*` | engine | Betfair access | see `apps/ENGINE_SERVICE.md` and the admin Betfair page |
| `API_FOOTBALL_KEY` | engine | fixtures and league history (free tier: 100 calls a day) | api-football dashboard |
| `ANTHROPIC_API_KEY` | engine | the optional per-alert second opinion | console.anthropic.com; removing it switches that feature off |
| VAPID keys | engine | phone notifications | changing them means re-subscribing each phone |

## 9. Where things are written down

- `CLAUDE.md`: the standing rules for any assistant session.
- `ops/reviews/`: the full site review of 11 Nov 2026 and its work packages (on the owner's machine; not committed).
- `ops/cost-review.md`: running costs and what could be cut.
- `ops/agents/README.md`: the agent team and the 31 Dec pass/fail test.
- `docs/history/`: older handover notes, kept for reference.
- `apps/ENGINE_SERVICE.md`: how the engine component is set up on DigitalOcean.
