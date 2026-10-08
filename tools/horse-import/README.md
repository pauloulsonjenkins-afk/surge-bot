# Daily horse picks importer

Fetches the day's four selections from your tipster account and puts them on GoalBrew's **Horses** page
(Admin → Horses → Today's bets) as a box that says *"Today's picks have been fetched"* with a **Fill the form with these**
button.

**It never bets and never sets a stake.** The picks are suggestions. Pressing the button copies the horse, course and the
tipster's odds into the normal form, where every field (odds, amount, win or each-way) is editable before you press Save.

## How the pieces fit

```
your PC / server                      GoalBrew website                      engine (database)
fetch_tips.py  --POST /api/horses/import-->  checks HORSE_IMPORT_KEY  -->  PUT /internal/horses/suggestions
(Playwright)       Bearer key                 (this route only)             stored in horse_suggestions
   on failure: {"error": "..."}  ------->  phone notification + a red "Daily fetch: failed" line on the Horses page
```

The website holds the only key to the database (`ADMIN_INTERNAL_KEY`); the script has its own separate key that opens
just the one route that receives picks.

## One-time setup

1. **A key.** Make a long random string (e.g. run `python -c "import secrets; print(secrets.token_urlsafe(32))"`).
   In DigitalOcean → the **web** component → Environment variables, add `HORSE_IMPORT_KEY` with that value (encrypted),
   and redeploy.
2. **Install** (Python 3.10+):
   ```
   cd tools/horse-import
   python -m venv .venv
   .venv\Scripts\activate          # Mac/Linux: source .venv/bin/activate
   pip install -r requirements.txt
   playwright install chromium
   ```
3. **Settings.** Copy `.env.example` to `.env` and fill in your tipster email and password, `GOALBREW_URL`, and the
   same `HORSE_IMPORT_KEY`. Passwords live only in `.env` (git-ignored) or real environment variables.
4. **First run, to teach it the page.** The site's layout can't be seen without logging in, so check what it reads:
   ```
   python fetch_tips.py --dry-run --debug
   ```
   A browser window opens, logs in and goes to the tips page, then prints what it found and saves
   `debug/tips_page.html` and `tips_page.png`. If it found the four horses, you're done. If not, set
   `TIPSTER_TIPS_URL` (the address of the daily tips page) and, if needed, the `TIPS_*_SELECTOR` lines in `.env`
   (right-click a horse in your browser → Inspect to see the element), then repeat. You can also send me the saved
   HTML (remove anything personal first) and I'll set the selectors.
5. **Real run:** `python fetch_tips.py --now`. Then open Horses on the site.

## Running it every day (random time between 10:00 and 14:00)

The script does the randomising itself: start it at **10:00** and it sleeps until a random moment before 14:00 UK time,
then fetches. If it is started later than 10:00 it picks a random moment in what's left of the window; after 14:00 it runs
straight away. It skips if today's picks were already fetched, so starting it twice is harmless.

**Windows (Task Scheduler)** on a PC that is on in the morning:
- Create Task → Trigger: Daily at 10:00 → Action: Start a program
  - Program: `C:\path\to\tools\horse-import\.venv\Scripts\python.exe`
  - Arguments: `fetch_tips.py`
  - Start in: `C:\path\to\tools\horse-import`
- Settings: tick *Run task as soon as possible after a scheduled start is missed* and *Stop the task if it runs longer than* 6 hours.

**Mac / Linux (cron)** (the machine's clock should be UK time, or set `CRON_TZ=Europe/London`):
```
0 10 * * * cd /path/to/tools/horse-import && ./.venv/bin/python fetch_tips.py >> cron.log 2>&1
```

## When something goes wrong

- The script logs to `fetch_tips.log` next to it, saves the page it saw in `debug/`, and exits with an error.
- GoalBrew sends you a **phone notification** ("Horse picks not fetched") and shows a red *Daily fetch: failed* line at the
  top of Horses with the reason. Set the `SMTP_*` lines in `.env` to get an email as well.
- Typical causes: wrong password (login still showing), the site's layout changed (fewer than four horses found), or the
  site was down.

## Please check

You are using your own paid account to read a page you can already see. Check the site's terms of use allow automated
reading, keep it to the single daily run, and never share the fetched picks with others.
