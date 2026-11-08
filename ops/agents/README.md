# GoalBrew agent team: how it's wired

| Agent | Definition | Model | When |
|---|---|---|---|
| Ops Watch | `.claude/agents/ops-watch.md` | Haiku | Daily 21:47 UK, and after every push |
| Strategy Auditor | `.claude/agents/strategy-auditor.md` | Opus | Sundays 19:43 UK, and 31 Dec |
| Skeptic | `.claude/agents/skeptic.md` | Sonnet | Straight after the Auditor |
| Engineer | `.claude/agents/engineer.md` | Opus | On an INCIDENT or the owner's request |

Every report goes as a comment on the **Agent log** issue in this repo. Each run reads the last 4 comments first.
The owner's decisions go there too, one line each.

## What the agents can and can't touch
- Read: `GET /api/agent/{today,winloss,strategies,live,dates}` with the `X-Agent-Key` header, and DigitalOcean deploys and run logs (read-only token).
- Never: PUT/POST/DELETE, `advice/apply`, Live/Sim, stakes, limits, redeploy, roll back, sign in. `/api/agent` exports GET only, so other methods get 405.

## One-time setup (owner)
1. Pick a random key of 24+ characters. In DigitalOcean, add `AGENT_READ_KEY` (Encrypted) to the **surge-bot-admin** component, then deploy.
2. Save the same key for the agents through Claude's secure credential form: host `seashell-app-z8xl5.ondigitalocean.app`, header `X-Agent-Key`.
3. Create a DigitalOcean API token with read access to Apps only. Save it through the same form for host `api.digitalocean.com` (Bearer).
4. To revoke: change or delete `AGENT_READ_KEY` in DigitalOcean, and delete the DigitalOcean token.

## The 31 Dec pass/fail
PASS if Live profit from 1 Nov to 31 Dec is above the running costs for those two months (DigitalOcean $24/month + £45/month),
and the Skeptic marks the report OK. The owner decides what follows.
