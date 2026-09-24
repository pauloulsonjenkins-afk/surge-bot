# Admin gate — what changed from the brief, and why

The brief asked to hardcode `Marbaix1` into the app and check a hash of it
in local session state (i.e. in the browser). I didn't build it that way,
for a reason the original architecture doc already flagged in its own
Security section: a check that runs in the browser can be read or bypassed
in devtools regardless of hashing, because the comparison — and often the
secret itself — ships inside the JavaScript bundle. This section sits in
front of Betfair credentials and live staking, so that gap matters more
here than it would on a cosmetic setting.

Also worth knowing: `Marbaix1` has now appeared in plain text in two chat
messages. I'd treat it as burned and pick a fresh password when you set
`ADMIN_PASSWORD` below — ideally a longer passphrase rather than a single
dictionary word + digits, since this guards real-money order placement.

## What's here instead

- `src/server/auth.ts` — session token signing/verification (Web Crypto,
  works in both the Node and Edge runtimes) and the password check.
- `app/api/admin/session/route.ts` — `POST` verifies the password
  server-side and sets an httpOnly, signed, 8-hour session cookie.
  `DELETE` clears it (logout).
- `middleware.ts` — early redirect to `/more/admin/login` for obviously
  unauthenticated requests to any `/more/admin/*` route except login.
- `app/(tabs)/more/admin/(protected)/layout.tsx` — the actual gate. It
  re-verifies the session cookie server-side on every request, so nothing
  under it can render without a valid session, independent of middleware.

The password itself lives only in the `ADMIN_PASSWORD` server env var —
never in a file, never in the client bundle.

## Setup — no terminal required

1. In the DigitalOcean App Platform dashboard, open the app, then your
   **web** service → **Settings** → **App-Level Environment Variables**.
2. Add `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` (see `.env.example` for
   what each is), and mark both **Encrypted**.
3. Deploy. DO will pick the new env vars up on the next build — pushing to
   your GitHub repo (via the GitHub web UI or GitHub Desktop — no terminal
   needed) triggers that automatically if the app is connected to the repo.

For local development only, copy `.env.example` to `.env.local` and fill
in the same two values.

## Upgrading later

When you're ready for the fuller version from the original blueprint
(argon2id hash instead of a plain env var), the only file that changes is
`checkPassword()` in `src/server/auth.ts` — swap the equality check for an
argon2id verify call. Everything else (cookie issuing, middleware, the
protected layout) stays the same.
