# Engine web service: InPlayGuru webhooks + SQLite trade log on Spaces

This adds a small web service to the engine. It receives InPlayGuru picks,
keeps its data in one SQLite file, and backs that file up to your
`surgebackup` Space so nothing is lost when DigitalOcean replaces the
container.

## What it does today, and what it doesn't yet

**Does:** receives webhooks, checks the secret URL token and (once you have
it) InPlayGuru's signature, stores every accepted pick exactly as received,
ignores exact repeats, and backs the database up to the Space within a few
seconds of each change, plus a dated daily copy under `engine/daily/`.

**Doesn't yet:** turn a pick into an `AlertTrigger` or call `executeAlert()`.
Nothing is sent to Betfair, not even in dry-run. Two things are needed first:

1. **InPlayGuru's payload format.** It isn't published; they send it when
   they switch webhooks on for your account. The captured picks in the
   `inplayguru_webhooks` table are the real examples the mapping will be
   written from.
2. **The engine's own source files** (`src/execution`, `src/domain`,
   `src/config`, `src/index.ts`), so the mapping and the SQLite trade log
   sink plug into the real `AlertTrigger`, `executeAlert()` and
   `TradeLogSink` definitions. The `trade_log` table and
   `EngineDb.appendTradeLogEntry()` are already in place for that.

## Files

```
package.json, package-lock.json   replaced: new start command, Node 22, two new dependencies
src/server/main.ts                starts everything, uploads a final backup on shutdown
src/server/http.ts                /health and /webhooks/inplayguru/<token>
src/server/server-env.ts          reads the settings below
src/server/log.ts                 timestamped log lines
src/inplayguru/verify.ts          URL token and signature checks
src/inplayguru/receiver.ts        what happens to an accepted pick (capture, for now)
src/storage/engine-db.ts          the SQLite file
src/storage/spaces-sync.ts        restore on startup, backup after changes
```

## Uploading through GitHub's website

1. Open the repo on GitHub and go into the engine folder (the one with
   `ENGINE.md` in it).
2. **Add file → Upload files**. Drag in `package.json`, `package-lock.json`
   and `ENGINE_SERVICE.md`, and drag the whole `src` folder in as well.
   GitHub adds the new `src/server`, `src/inplayguru` and `src/storage`
   folders alongside the existing ones; nothing else is removed.
3. Commit directly to your main branch.

## Settings (DigitalOcean → your app → engine component → Settings → Environment Variables)

| Name | Value | Encrypt |
|---|---|---|
| `INPLAYGURU_WEBHOOK_PATH_TOKEN` | 40+ random letters and digits. A password manager's generator works; turn symbols off. | Yes |
| `SPACES_REGION` | The region code your `surgebackup` Space is in, e.g. `lon1` | No |
| `SPACES_BUCKET` | `surgebackup` (this is also the default) | No |
| `SPACES_ACCESS_KEY_ID` | From DigitalOcean → API → Spaces Keys. Limit the key to the `surgebackup` bucket if offered. | Yes |
| `SPACES_SECRET_ACCESS_KEY` | Shown once when you create that key | Yes |
| `INPLAYGURU_SIGNING_SECRET` | Later: the signing secret InPlayGuru gives you | Yes |
| `INPLAYGURU_SIGNATURE_HEADER` | Later: the header name from their webhook docs | No |

Your existing Betfair variables stay as they are.

The service refuses to start, with a log message naming the problem, if a
required setting is missing or if it can't read the Space. That second
check matters: starting with an empty database would overwrite the real
backup on the first upload.

## Adding the engine to your DigitalOcean app

In the app's dashboard, add a component from your GitHub repo and set:

- **Source directory:** the engine folder
- **Type:** Web Service
- **Build command:** `npm run build`
- **Run command:** `npm start`
- **HTTP port:** `8080`
- **HTTP route:** `/engine`
- **Health check path:** `/health`
- **Instance count:** `1`, and keep it at 1. Two copies would each have their
  own database and overwrite each other's backups.

The same settings as an App Spec fragment, if you'd rather paste it under
**Settings → App Spec** (fill in the two placeholders):

```yaml
services:
  - name: engine
    github:
      repo: YOUR-GITHUB-USER/YOUR-REPO
      branch: main
      deploy_on_push: true
    source_dir: PATH/TO/ENGINE/FOLDER
    environment_slug: node-js
    build_command: npm run build
    run_command: npm start
    http_port: 8080
    instance_count: 1
    routes:
      - path: /engine
    health_check:
      http_path: /health
```

## After it deploys

- Open `https://YOUR-APP-DOMAIN/engine/health`. You should see `"ok": true`
  and a `backup` section.
- Your webhook URL for InPlayGuru is
  `https://YOUR-APP-DOMAIN/engine/webhooks/inplayguru/YOUR-PATH-TOKEN`.
  Treat it like a password.
- When you ask InPlayGuru to enable webhooks, ask for: the signature header
  name and signing method, the signing secret, a sample payload for a
  Momentum and an Action Area pick, and whether they retry failed deliveries.

## One thing to know about redeploys

DigitalOcean starts the new container before stopping the old one. A pick
that arrives in those few seconds can land in the old container after the
new one has already restored the backup, and be lost. Deploy outside match
hours. The dated daily copies in the Space are there as a second safety net.
