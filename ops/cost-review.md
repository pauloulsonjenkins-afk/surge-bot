# Running costs: to-do (opened 11 Nov 2026, owner's request)

Goal: lower the monthly cost of GoalBrew without risking the engine (alerts in, bets out, backups).

## What the repo records today

| Item | Cost | Source |
|---|---|---|
| DigitalOcean engine component (`surge-bot-apps-web`) | $12/month | HANDOVER-2026-10-20.md |
| DigitalOcean site component (`surge-bot-admin`) | $12/month | HANDOVER-2026-10-20.md |
| DigitalOcean Space (database backups) | $5/month | HANDOVER-2026-10-20.md |
| VAT on the above | about 20% | HANDOVER-2026-10-20.md (about $35/month in all) |
| "Other spend" | £45/month | ops/agents/README.md; not itemised anywhere in the repo |

## Not yet known (needs the owner or a DigitalOcean sign-in)

- What the £45/month is made of (InPlayGuru plan? anything else?). This is the largest line and the first to look at.
- Memory and CPU actually used by each component (DigitalOcean → seashell-app → Insights). Needed before any downsize.
- How much the Space really holds, and how many dated daily copies are kept.

## Options to check, cheapest risk first

1. **Itemise the £45** and drop or downgrade anything not used by a Live or Sim strategy.
2. **Downsize the site component** to the smallest size if Insights shows it idles well under 512 MB. Saves about $7/month. The site holds no data, so this is easy to undo.
3. **Trim backup copies** in the Space if it is over its included storage (the $5 covers 250 GB; unlikely to save money, but worth a look).
4. **One component instead of two**: serve the site from the engine's container. Saves $12/month but couples deploys of the site to restarts of the engine (each restart is a gap of several minutes in alerts). Only worth it with the review's WP4 (safer deploys) done first.
5. **Leave the engine's size alone** until WP3 (reports off the main thread) is done: it keeps every settled pick in memory, and a too-small container would restart mid-match.

## Not options

- A second engine copy, or anything that connects a second Telegram session.
- Changing instance count from 1 (see apps/ENGINE_SERVICE.md).
