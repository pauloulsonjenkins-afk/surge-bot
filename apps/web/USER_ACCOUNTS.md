# Website user accounts

People can create an account and sign in. New accounts see nothing until the admin
gives them pages. The admin (password) sign-in is separate and unchanged.

## What each person can be given (Admin > Users)
| Choice | Opens |
|---|---|
| Dashboard | Dashboard (hit rates) |
| Live | Live and Trade Log (the alerts) |
| Schedule | Schedule |

Admin pages are never available to users. They stay behind the admin password.

## Important: turn Public view OFF
Admin > Settings > Public view. While it is ON, everyone (signed in or not) can see
those pages, so the choices on the Users page don't restrict anything. The Users page
shows a warning while it is on.

## How it works
- Users, and their salted password hashes, live in the engine's SQLite file (table
  `app_users`), so they are backed up to your Space with everything else.
- The website keeps a signed, httpOnly cookie (`gb_user_session`, 14 days). It reuses
  `ADMIN_SESSION_SECRET`, so there is nothing new to configure.
- Every data request re-checks the user with the engine (remembered for about 4 seconds),
  so disabling someone, changing their pages, resetting their password or "Sign out
  everywhere" takes effect within seconds.
- Sign-in is limited to 10 tries per address per 5 minutes and 10 per email per 15 minutes.
  Sign-up is limited to 5 per address per hour.

## Forgotten passwords
There is no self-service reset. To help someone, open Admin > Users, press **Reset password** on their card,
type a new password (10+ characters) and tell them it yourself. They are signed out everywhere.

## Not included
Emailed verification when signing up, and any emailed links. Users can't change their own password while signed in yet;
you reset it for them on the Users page.
