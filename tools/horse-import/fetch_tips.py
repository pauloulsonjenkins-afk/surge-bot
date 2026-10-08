#!/usr/bin/env python3
"""
Fetches today's four selections from the tipster members' area and sends them to GoalBrew's Horses page.

What it does, once a day:
  1. Waits until a random moment between 10:00 and 14:00 UK time (so it doesn't hit the site at a rigid time).
  2. Logs in with the account in .env (a real browser via Playwright, so cookies and any scripts work as normal).
  3. Opens the daily tips page and reads the horses, race times, courses and odds.
  4. Posts them to GoalBrew (/api/horses/import). They arrive as SUGGESTIONS: the Horses page shows them with a
     "Fill the form with these" button. Nothing is staked or bet, and you can change any odds or amount before saving.
  5. If anything goes wrong (login fails, the page changed, fewer than four horses) it logs the reason, saves the page
     for inspection, and tells GoalBrew, which sends a notification to your phone and shows it on the Horses page.
     It can also send an email if SMTP_* are set.

Run it:
    python fetch_tips.py              # the normal daily run (random wait first)
    python fetch_tips.py --now        # skip the wait
    python fetch_tips.py --dry-run    # log in and read the page, print what it found, send nothing
    python fetch_tips.py --debug      # also save the page's HTML and a screenshot to ./debug/

See README.md for setup and scheduling.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import smtplib
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, time as dtime, timedelta
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
UK = ZoneInfo("Europe/London")
STATE_FILE = HERE / "last_run.json"
DEBUG_DIR = HERE / "debug"

log = logging.getLogger("tipster")


# --------------------------------------------------------------------------- config


def load_env() -> None:
    """Reads .env next to this script into the environment (real environment variables win)."""
    path = HERE / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def need(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing {name}: set it in {HERE / '.env'} (see .env.example).")
    return value


def setup_logging() -> None:
    fmt = "%(asctime)s %(levelname)s %(message)s"
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout), logging.FileHandler(HERE / "fetch_tips.log", encoding="utf-8")]
    logging.basicConfig(level=logging.INFO, format=fmt, handlers=handlers)


# --------------------------------------------------------------------------- timing


def pick_run_time(now: datetime, start_h: int = 10, end_h: int = 14) -> datetime:
    """A random moment today between start_h and end_h (UK). If it's already later than the window opened, the moment is
    chosen from what is left of the window; past the end of the window it runs straight away (a missed run is better late)."""
    open_ = datetime.combine(now.date(), dtime(start_h, 0), UK)
    close = datetime.combine(now.date(), dtime(end_h, 0), UK)
    if now >= close:
        return now
    earliest = max(now, open_)
    return earliest + timedelta(seconds=random.uniform(0, (close - earliest).total_seconds()))


def wait_until(target: datetime) -> None:
    while True:
        left = (target - datetime.now(UK)).total_seconds()
        if left <= 0:
            return
        time.sleep(min(left, 60))


# --------------------------------------------------------------------------- reading the page

ODDS_RE = re.compile(r"(?<![\d/])(\d{1,3}\s*/\s*\d{1,3}|evens|evs)(?![\d/])", re.I)
TIME_RE = re.compile(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\b")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def odds_ok(text: str) -> str:
    t = clean(text).lower().replace(" ", "")
    return "evens" if t in ("evs", "evens") else t


# One line per selection, e.g. "NAP- 5.13 Ayr- Horse Name- 1/1 (1.5 Points Win)" or "... (0.5 Points Each-Way) *4 Places*".
LABEL_RE = re.compile(
    r"^\s*(?P<label>NAP|NB|Next Best|Extra)\s*[-:]\s*(?P<time>\d{1,2}[.:]\d{2})\s+(?P<course>[^-]+?)\s*-\s*(?P<horse>.+?)\s*-\s*"
    r"(?P<odds>\d{1,3}\s*/\s*\d{1,3}|evens|evs)\b(?P<rest>.*)$",
    re.I,
)


def race_time(raw: str) -> str:
    """"5.13" -> "17:13". Racing times are written without am/pm; races run from about 12:00 to 21:00."""
    h, m = re.split(r"[.:]", raw)
    hour = int(h)
    if hour < 10:
        hour += 12
    return f"{hour:02d}:{m}"


def read_by_labels(page) -> list[dict]:
    """Reads the page's NAP / NB / Extra lines. The order they appear in is the order they are saved in (1 = NAP)."""
    picks: list[dict] = []
    for el in page.query_selector_all("p"):
        m = LABEL_RE.match(clean(el.inner_text()))
        if not m:
            continue
        rest = m.group("rest")
        ew = bool(re.search(r"each[- ]?way", rest, re.I))
        places = re.search(r"(\d+)\s*places", rest, re.I)
        points = re.search(r"([\d.]+)\s*points?", rest, re.I)
        picks.append(
            {
                "horse": clean(m.group("horse")),
                "course": clean(m.group("course")),
                "raceTime": race_time(m.group("time")),
                "odds": odds_ok(m.group("odds")),
                "betType": "ew" if ew else "win",
                "ewPlaces": places.group(1) if (ew and places) else "",
                "points": points.group(1) if points else "",
            }
        )
    return picks


def read_by_selectors(page) -> list[dict]:
    """Reads the page with CSS selectors from .env, when they are set. Each ROW is one selection; inside it NAME, ODDS and
    (optionally) COURSE and TIME are looked up. This is the reliable way once the site's markup is known."""
    row_sel = os.environ.get("TIPS_ROW_SELECTOR", "").strip()
    if not row_sel:
        return []
    picks: list[dict] = []
    for row in page.query_selector_all(row_sel):
        def inner(var: str) -> str:
            sel = os.environ.get(var, "").strip()
            if not sel:
                return ""
            el = row.query_selector(sel)
            return clean(el.inner_text()) if el else ""

        horse = inner("TIPS_NAME_SELECTOR")
        if not horse:
            continue
        picks.append(
            {
                "horse": horse,
                "course": inner("TIPS_COURSE_SELECTOR"),
                "raceTime": inner("TIPS_TIME_SELECTOR"),
                "odds": odds_ok(inner("TIPS_ODDS_SELECTOR")),
            }
        )
    return picks


def read_by_text(page) -> list[dict]:
    """A best-effort fallback that needs no selectors: looks at the page's text for lines with a race time (14:35), a
    price (5/2, evens) and a name nearby. It is a guess, so the first run should use --dry-run and be checked by eye;
    once the markup is known, set the TIPS_* selectors instead."""
    lines = [clean(x) for x in page.inner_text("main, #content, .content, body").splitlines()]
    lines = [x for x in lines if x]
    picks: list[dict] = []
    for i, line in enumerate(lines):
        odds = ODDS_RE.search(line)
        if not odds:
            continue
        window = " | ".join(lines[max(0, i - 3) : i + 2])
        t = TIME_RE.search(window)
        # The horse is the text before the price on this line, or the line above when the price stands alone.
        before = clean(line[: odds.start()]).strip("-–:|@ ")
        before = TIME_RE.sub("", before).strip("-–:|@ ")
        horse = before if re.search(r"[A-Za-z]{3,}", before) else (lines[i - 1] if i > 0 else "")
        horse = clean(TIME_RE.sub("", horse)).strip("-–:|@ ")
        if not re.search(r"[A-Za-z]{3,}", horse) or len(horse) > 60:
            continue
        course = ""
        if t:
            after_time = clean(window[t.end() :]).split("|")[0]
            course = clean(re.sub(r"[^A-Za-z' \-]", " ", after_time))[:30] if after_time and after_time != horse else ""
        picks.append({"horse": horse, "course": course, "raceTime": f"{t.group(1)}:{t.group(2)}" if t else "", "odds": odds_ok(odds.group(1))})
    # Keep the first appearance of each horse.
    seen: set[str] = set()
    out = []
    for p in picks:
        k = p["horse"].lower()
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


# --------------------------------------------------------------------------- the browser run


def scrape(headless: bool, debug: bool) -> list[dict]:
    from playwright.sync_api import TimeoutError as PWTimeout
    from playwright.sync_api import sync_playwright

    email, password = need("TIPSTER_EMAIL"), need("TIPSTER_PASSWORD")
    login_url = need("TIPSTER_LOGIN_URL")
    tips_url = os.environ.get("TIPSTER_TIPS_URL", "").strip()
    expected = int(os.environ.get("EXPECTED_PICKS", "4"))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        # Off by default. Only for a site whose security certificate has expired and that you have decided to trust anyway:
        # with it on, the password is sent without checking who is on the other end.
        ignore_cert = os.environ.get("TIPSTER_IGNORE_CERT_ERRORS", "").strip().lower() in ("1", "yes", "true")
        if ignore_cert:
            log.warning("Certificate errors are being ignored (TIPSTER_IGNORE_CERT_ERRORS)")
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="en-GB", timezone_id="Europe/London", ignore_https_errors=ignore_cert)
        page = ctx.new_page()
        page.set_default_timeout(30_000)
        try:
            log.info("Opening the login page")
            page.goto(login_url, wait_until="domcontentloaded")
            # Cookie banner, if any: only the least-intrusive choice is clicked.
            for label in ("Reject all", "Decline", "Only necessary", "Necessary only"):
                btn = page.get_by_role("button", name=re.compile(label, re.I))
                if btn.count():
                    btn.first.click()
                    break

            user_sel = os.environ.get("TIPSTER_USER_SELECTOR") or 'input[type="email"], input[name*="email" i], input[name*="user" i], input[name="log"], #user_login'
            pass_sel = os.environ.get("TIPSTER_PASS_SELECTOR") or 'input[type="password"]'
            submit_sel = os.environ.get("TIPSTER_SUBMIT_SELECTOR") or 'button[type="submit"], input[type="submit"]'
            page.fill(user_sel, email)
            page.fill(pass_sel, password)
            page.click(submit_sel)
            page.wait_for_load_state("networkidle")

            # Still showing a password box = the login was refused.
            if page.query_selector(pass_sel) and page.query_selector(pass_sel).is_visible():
                raise RuntimeError("Login failed: the login form is still showing after signing in. Check TIPSTER_EMAIL / TIPSTER_PASSWORD.")
            log.info("Logged in")

            if tips_url:
                page.goto(tips_url, wait_until="networkidle")
            else:
                # No page set: look for a link to today's tips from wherever the login landed.
                link = page.get_by_role("link", name=re.compile(r"daily tips|today'?s tips|todays tips", re.I))
                if not link.count():
                    raise RuntimeError("Could not find a link to today's tips. Set TIPSTER_TIPS_URL in .env to the daily tips page.")
                link.first.click()
                page.wait_for_load_state("networkidle")

            if debug:
                DEBUG_DIR.mkdir(exist_ok=True)
                (DEBUG_DIR / "tips_page.html").write_text(page.content(), encoding="utf-8")
                page.screenshot(path=str(DEBUG_DIR / "tips_page.png"), full_page=True)
                log.info("Saved the page to %s", DEBUG_DIR)

            picks = read_by_selectors(page) or read_by_labels(page) or read_by_text(page)
            log.info("Found %d candidate picks", len(picks))
            if len(picks) < expected:
                if not debug:  # keep the page so the cause can be seen
                    DEBUG_DIR.mkdir(exist_ok=True)
                    (DEBUG_DIR / "tips_page.html").write_text(page.content(), encoding="utf-8")
                    page.screenshot(path=str(DEBUG_DIR / "tips_page.png"), full_page=True)
                raise RuntimeError(f"Expected {expected} selections but found {len(picks)}. The page layout may have changed (page saved to {DEBUG_DIR}).")
            return picks[:expected]
        except PWTimeout as exc:
            raise RuntimeError(f"The site was too slow or the page layout changed (timeout: {exc})") from exc
        finally:
            ctx.close()
            browser.close()


# --------------------------------------------------------------------------- sending and alerting


def post_json(url: str, key: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}", "User-Agent": "goalbrew-horse-import/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"GoalBrew refused the picks ({exc.code}): {detail}") from exc


def send_email(subject: str, body: str) -> None:
    host = os.environ.get("SMTP_HOST", "").strip()
    to = os.environ.get("ALERT_EMAIL_TO", "").strip()
    if not host or not to:
        return
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, os.environ.get("SMTP_FROM", to), to
    msg.set_content(body)
    try:
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=30) as smtp:
            smtp.starttls()
            user = os.environ.get("SMTP_USER", "").strip()
            if user:
                smtp.login(user, os.environ.get("SMTP_PASSWORD", ""))
            smtp.send_message(msg)
    except Exception:  # noqa: BLE001 - an email problem must never hide the original one
        log.exception("Could not send the alert email")


def alert(site: str, key: str, message: str) -> None:
    """Tells GoalBrew (phone notification + a note on the Horses page) and optionally emails."""
    log.error("ALERT: %s", message)
    try:
        post_json(f"{site}/api/horses/import", key, {"error": message[:300]})
    except Exception:  # noqa: BLE001
        log.exception("Could not reach GoalBrew to report the failure")
    send_email("GoalBrew: horse picks not fetched", message)


# --------------------------------------------------------------------------- main


def already_done(today: str) -> bool:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8")).get("day") == today
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--now", action="store_true", help="skip the random wait")
    ap.add_argument("--dry-run", action="store_true", help="read the page and print the picks; send nothing")
    ap.add_argument("--debug", action="store_true", help="save the page HTML and a screenshot, and show the browser")
    ap.add_argument("--force", action="store_true", help="run even if today's picks were already fetched")
    args = ap.parse_args()

    load_env()
    setup_logging()
    # A dry run only reads the tips page, so it needs neither the GoalBrew address nor the key.
    site = (os.environ.get("GOALBREW_URL", "") if args.dry_run else need("GOALBREW_URL")).rstrip("/")
    key = os.environ.get("HORSE_IMPORT_KEY", "") if args.dry_run else need("HORSE_IMPORT_KEY")
    today = datetime.now(UK).strftime("%Y-%m-%d")

    if not args.force and not args.dry_run and already_done(today):
        log.info("Today's picks were already fetched; nothing to do (use --force to run again).")
        return 0

    try:
        if not (args.now or args.dry_run):
            target = pick_run_time(datetime.now(UK))
            log.info("Waiting until %s UK time", target.strftime("%H:%M:%S"))
            wait_until(target)
            today = datetime.now(UK).strftime("%Y-%m-%d")

        picks = scrape(headless=not args.debug, debug=args.debug)
        for i, p in enumerate(picks, 1):
            log.info("%d. %s | %s %s | %s | %s %s pts", i, p["horse"], p.get("course", ""), p.get("raceTime", ""), p.get("odds", ""), p.get("betType", ""), p.get("points", ""))
        if args.dry_run:
            log.info("Dry run: nothing sent.")
            return 0

        result = post_json(f"{site}/api/horses/import", key, {"day": today, "picks": picks, "source": "tips"})
        log.info("Sent to GoalBrew: %s", result)
        STATE_FILE.write_text(json.dumps({"day": today, "at": datetime.now(UK).isoformat()}), encoding="utf-8")
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001 - every failure is reported, never swallowed
        log.error("Failed: %s", exc)
        log.debug("".join(traceback.format_exception(exc)))
        if not args.dry_run:
            alert(site, key, f"Horse fetch failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
