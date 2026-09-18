"""
surge_live.py — the data layer. API-Football in, Betfair prices in, alerts out.

This is the half `surge_alerts.py` was missing: it referenced `ExchangePrices`
without defining it, declared `API_BASE` without calling it, and had no poll loop
and no settlement loop. Everything here feeds the model that already exists;
nothing here changes the model.

    pip install requests
    python surge_live.py --check      # credentials and connectivity, no polling
    python surge_live.py --markets    # show what Betfair market it would price off
    python surge_live.py              # run

**It places no bets.** It reads prices and messages you. The delayed application
key physically cannot place orders, which is the point of using it.

Environment:

    API_FOOTBALL_KEY    required — your api-sports.io key
    SURGE_LEAGUE_IDS    optional, comma-separated API-Football league ids
    BF_APP_KEY          required — the key marked 1.0-DELAY
    BF_USERNAME         required
    BF_PASSWORD         required
    TG_BOT_TOKEN        required
    TG_CHAT_ID          required

    BF_PRICE_DELAY      seconds, default 60 — must match your key's real delay
    SURGE_MIN_MATCHED   minimum £ matched on the market, default 200
    SURGE_MAX_SPREAD    maximum back/lay spread as a fraction, default 0.08
    SURGE_DRY_RUN       1 to log alerts without sending them

Note on API-Football's shape: one call does not return statistics for every
live fixture. `/fixtures?live=all` gives you the fixture list; each fixture's
shot/corner/possession numbers need a *separate* call to `/fixtures/statistics`.
On a quiet weekday evening that is a handful of extra calls per poll. On a
Saturday afternoon with thirty-plus fixtures live across your chosen leagues,
it is thirty-plus extra calls, every poll, on top of the one fixture-list call.
See ApiFootballFeed below for the quota arithmetic and which plan tier it
actually needs.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any

import requests

# load_dotenv runs at surge_alerts import time, before CFG reads os.environ.
from surge_alerts import (
    CFG,
    EvalLog,
    Match,
    load_dotenv,
    Snapshot,
    Telegram,
    bet_alert,
    evaluate,
    headsup_alert,
)

log = logging.getLogger("surge.live")

AF_BASE = "https://v3.football.api-sports.io"
BF_CERTLOGIN = "https://identitysso-cert.betfair.com/api/certlogin"
BF_KEEPALIVE = "https://identitysso.betfair.com/api/keepAlive"
BF_BETTING = "https://api.betfair.com/exchange/betting/rest/v1.0"


def _env(k: str, d: str = "") -> str:
    return os.environ.get(k, d)


def _f(k: str, d: float) -> float:
    try:
        return float(_env(k, str(d)))
    except ValueError:
        return d


MIN_MATCHED = _f("SURGE_MIN_MATCHED", 200)
MAX_SPREAD = _f("SURGE_MAX_SPREAD", 0.08)
DRY_RUN = _env("SURGE_DRY_RUN", "0").strip().lower() in ("1", "true", "yes", "on")


def _validate_pem_pair(cert_path: str, key_path: str) -> None:
    """Fail loudly and specifically, before the SSL layer fails vaguely.

    A malformed certificate surfaces as `[SSL] PEM lib` deep inside a
    connection attempt — technically accurate, useless for figuring out
    what to fix. Loading it directly here, at startup, turns that into an
    error that names the actual problem: which file, and what's wrong
    with it.
    """
    import ssl
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    try:
        ctx.load_cert_chain(cert_path, key_path)
    except ssl.SSLError as e:
        log.error(
            "The Betfair certificate/key don't parse as valid PEM (%s). "
            "If you pasted these into BF_CERT_PEM/BF_KEY_PEM, check you "
            "copied the WHOLE file, including the "
            "-----BEGIN...----- and -----END...----- lines, with nothing "
            "added or missing.", e)
    except FileNotFoundError:
        pass  # caller already checked existence where that matters


def _resolve_bf_cert() -> tuple[str, str]:
    """Find the Betfair certificate, however this host makes it available.

    On a host with a normal filesystem (PythonAnywhere), BF_CERT_PATH and
    BF_KEY_PATH point straight at the uploaded files — used as-is.

    On a platform-as-a-service host (DigitalOcean App Platform and similar),
    there's nowhere persistent to upload the certificate to, only
    environment variables. Two ways to hand it over that way:

      BF_CERT_B64 / BF_KEY_B64   base64 of the file — ONE line, can't be
                                  mangled by a form that doesn't preserve
                                  line breaks. Preferred: generate with
                                  `base64 -w0 client-2048.crt` etc.
      BF_CERT_PEM / BF_KEY_PEM   the raw file contents, multi-line. Works
                                  fine as long as the dashboard's text box
                                  actually keeps the line breaks — some
                                  don't, which is exactly what base64 sidesteps.
    """
    path, key = _env("BF_CERT_PATH"), _env("BF_KEY_PATH")
    if path and key and os.path.exists(path) and os.path.exists(key):
        return path, key

    b64_cert, b64_key = _env("BF_CERT_B64"), _env("BF_KEY_B64")
    if b64_cert and b64_key:
        import base64
        import tempfile
        tmp = tempfile.gettempdir()
        cert_out, key_out = f"{tmp}/bf_cert.crt", f"{tmp}/bf_key.key"
        try:
            # Strip ALL whitespace first, not just leading/trailing — base64
            # itself tolerates line breaks fine, but validate=True doesn't,
            # and a console that soft-wraps a long line can hand back a copy
            # with a stray newline in the middle. Stripping before decoding
            # (rather than passing validate=True) treats that as harmless,
            # which is what it actually is.
            cert_clean = "".join(b64_cert.split())
            key_clean = "".join(b64_key.split())
            cert_bytes = base64.b64decode(cert_clean, validate=True)
            key_bytes = base64.b64decode(key_clean, validate=True)
        except Exception as e:
            log.error("BF_CERT_B64 / BF_KEY_B64 don't decode as base64 (%s) "
                      "— check the whole output of `base64 -w0 ...` was "
                      "copied, with nothing added or missing.", e)
            return "", ""
        with open(cert_out, "wb") as fh:
            fh.write(cert_bytes)
        with open(key_out, "wb") as fh:
            fh.write(key_bytes)
        _validate_pem_pair(cert_out, key_out)
        return cert_out, key_out

    pem, pem_key = _env("BF_CERT_PEM"), _env("BF_KEY_PEM")
    if pem and pem_key:
        # Some dashboards store a multi-line variable as one line, turning
        # real newlines into the two characters '\' and 'n'. A PEM file is
        # meaningless without its line breaks, so undo that if it happened —
        # harmless if the value already had real newlines, since correctly
        # pasted PEM text never contains a literal backslash-n sequence.
        pem = pem.strip().replace("\\n", "\n")
        pem_key = pem_key.strip().replace("\\n", "\n")
        import tempfile
        tmp = tempfile.gettempdir()
        cert_out, key_out = f"{tmp}/bf_cert.crt", f"{tmp}/bf_key.key"
        with open(cert_out, "w", encoding="utf-8") as fh:
            fh.write(pem + "\n")
        with open(key_out, "w", encoding="utf-8") as fh:
            fh.write(pem_key + "\n")
        _validate_pem_pair(cert_out, key_out)
        return cert_out, key_out
    return "", ""


# ═════════════════════════════ API-Football ══════════════════════════════

# API-Football's statistics endpoint keys stats on a free-text `type` string,
# not a numeric id, so matching is done on the label, not on array position —
# a provider reordering the list can't silently swap two numbers.
WANTED_STATS = {
    "Shots on Goal": "sot",
    "Shots off Goal": "soff",
    "Shots insidebox": "inside",
    "Shots outsidebox": "outside",
    "Corner Kicks": "corners",
    "Ball Possession": "poss",
    "Red Cards": "red",
}
# API-Football has no "dangerous attacks" field. `Match.has_datk` is always
# False here, which is not a missing feature: `evaluate()` already
# renormalises signal weights when a stat is absent (see HANDOVER.md), so
# the model runs on one fewer signal rather than a corrupted one.

LIVE_STATUS = {"1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT"}
DONE_STATUS = {"FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"}


class ApiFootballFeed:
    """Live fixtures with the statistics the model needs.

    This is two kinds of call, not one:

      /fixtures?live=all          every fixture in play — no stats included
      /fixtures/statistics        one call PER fixture, for its stats

    That second call is the thing to budget for. A poll with 15 fixtures live
    is 16 requests, not 1. On API-Football's Pro tier (7,500/day) a quiet
    weekday evening is fine; a Saturday afternoon with 30+ fixtures across
    the leagues you've picked can burn through a day's quota by early evening
    — the bot goes quiet not because nothing is happening but because the
    plan ran out, and that looks exactly like a slow day. If you're watching
    more than a handful of leagues, budget for the Ultra tier (75,000/day),
    not Pro.
    """

    def __init__(self, token: str, league_ids: str = "") -> None:
        self.token = token
        self.league_ids = {int(x) for x in league_ids.split(",") if x.strip()}
        self.s = requests.Session()

    def _get(self, path: str, **params: Any) -> list[dict]:
        try:
            r = self.s.get(f"{AF_BASE}{path}", params=params,
                            headers={"x-apisports-key": self.token}, timeout=15)
        except requests.RequestException:
            log.exception("API-Football request failed")
            return []
        if r.status_code == 429:
            log.warning("API-Football rate limit hit — backing off")
            time.sleep(20)
            return []
        if r.status_code in (401, 403):
            log.error("API-Football rejected the token (%s). Check the key, "
                      "or whether today's request quota is used up.", r.status_code)
            return []
        if r.status_code != 200:
            log.warning("API-Football %s returned %s", path, r.status_code)
            return []
        body = r.json()
        errs = body.get("errors")
        if errs:
            # api-sports.io often returns HTTP 200 with the problem described
            # here instead of a 4xx — rate limit, bad plan, unknown parameter.
            # Treated as a hard miss rather than parsed further, since the
            # shape of `errors` varies (dict in some cases, list in others).
            log.warning("API-Football error: %s", errs)
            return []
        data = body.get("response", [])
        return data if isinstance(data, list) else [data]

    def inplay(self) -> list[dict]:
        """Every live fixture — teams, score and clock, but no statistics yet."""
        fixtures = self._get("/fixtures", live="all")
        if self.league_ids:
            fixtures = [f for f in fixtures
                        if ((f.get("league") or {}).get("id")) in self.league_ids]
        return fixtures

    # ─────────────────────────── parsing ───────────────────────────

    @staticmethod
    def _minute(fx: dict) -> float:
        st = ((fx.get("fixture") or {}).get("status")) or {}
        elapsed = float(st.get("elapsed") or 0)
        extra = st.get("extra")
        return elapsed + float(extra or 0)

    @staticmethod
    def _teams(fx: dict) -> tuple[str, str]:
        t = fx.get("teams") or {}
        home = (t.get("home") or {}).get("name") or ""
        away = (t.get("away") or {}).get("name") or ""
        return home, away

    @staticmethod
    def _score(fx: dict) -> tuple[int, int]:
        g = fx.get("goals") or {}
        return int(g.get("home") or 0), int(g.get("away") or 0)

    def _stats(self, fixture_id: str, home_id: int) -> dict[str, Any]:
        """One extra request. Match totals for shots, home possession, reds.

        The model prices *any* next goal, so shot counts are summed across
        both teams. Possession and red cards are per-side — a total of
        "1 red card" says nothing; knowing which side is down a man is the
        entire signal.
        """
        out = {"sot": 0.0, "soff": 0.0, "inside": 0.0,
               "outside": 0.0, "corners": 0.0, "datk": 0.0,
               "poss_home": None, "red_home": 0, "red_away": 0,
               "has_datk": False}
        rows = self._get("/fixtures/statistics", fixture=fixture_id)
        for block in rows:
            team_id = (block.get("team") or {}).get("id")
            is_home = team_id == home_id
            for st in block.get("statistics") or []:
                key = WANTED_STATS.get(st.get("type") or "")
                if key is None:
                    continue
                val = st.get("value")
                if val is None:
                    continue
                if key == "poss":
                    if is_home:
                        try:
                            out["poss_home"] = float(str(val).rstrip("%"))
                        except ValueError:
                            pass
                elif key == "red":
                    if is_home:
                        out["red_home"] = int(val)
                    else:
                        out["red_away"] = int(val)
                else:
                    try:
                        out[key] += float(val)
                    except (TypeError, ValueError):
                        pass
        return out

    def matches(self) -> list[Match]:
        found = []
        for fx in self.inplay():
            status = ((fx.get("fixture") or {}).get("status") or {}).get("short", "").upper()
            if status in DONE_STATUS:
                continue
            home, away = self._teams(fx)
            if not home or not away:
                continue
            fixture_id = (fx.get("fixture") or {}).get("id")
            home_id = ((fx.get("teams") or {}).get("home") or {}).get("id")
            hg, ag = self._score(fx)
            s = self._stats(fixture_id, home_id)
            found.append(Match(
                fid=str(fixture_id),
                home=home, away=away,
                league=((fx.get("league") or {}).get("name") or ""),
                minute=self._minute(fx), hg=hg, ag=ag,
                inside=int(s["inside"]), outside=int(s["outside"]),
                sot=int(s["sot"]), soff=int(s["soff"]),
                corners=int(s["corners"]), datk=int(s["datk"]),
                has_datk=s["has_datk"],
                red_home=s["red_home"], red_away=s["red_away"],
                poss_home=s["poss_home"],
            ))
        return found

    def finished_today(self) -> dict[str, tuple[int, int]]:
        """Final scores for fixtures that have ended, for settlement."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out = {}
        for fx in self._get("/fixtures", date=today):
            status = ((fx.get("fixture") or {}).get("status") or {}).get("short", "").upper()
            if status in DONE_STATUS:
                fid = (fx.get("fixture") or {}).get("id")
                out[str(fid)] = self._score(fx)
        return out


# ═════════════════════════════ name matching ════════════════════════════

_NOISE = {"fc", "afc", "cf", "sc", "ac", "if", "ff", "bk", "sk", "ik", "fk",
          "kf", "club", "cd", "ud", "sv", "vf", "vfb", "vfl", "tsv", "fsv",
          "united", "city", "the"}


def _norm(name: str) -> set[str]:
    n = unicodedata.normalize("NFKD", name.lower())
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return {w for w in n.split() if w and w not in _NOISE and len(w) > 2}


def name_score(a: str, b: str) -> float:
    """Token overlap, 0 to 1. Crude on purpose — the alternative is a manual map.

    Two providers will not agree on 'Sporting Charleroi' vs 'R. Charleroi SC'.
    Distinctive tokens survive normalisation; 'FC', 'United' and accents do not.
    """
    ta, tb = _norm(a), _norm(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    if not inter:
        # Last resort: a long prefix match catches 'Djurgarden' / 'Djurgardens'.
        for x in ta:
            for y in tb:
                if len(x) >= 5 and (x.startswith(y[:5]) or y.startswith(x[:5])):
                    return 0.55
        return 0.0
    return len(inter) / min(len(ta), len(tb))


# ════════════════════════════ Betfair prices ════════════════════════════

@dataclass
class Quote:
    ts: float
    back: float
    lay: float
    matched: float

    @property
    def spread(self) -> float:
        if self.back <= 1 or self.lay <= 1:
            return 1.0
        return (self.lay - self.back) / self.back


class ExchangePrices:
    """Read-only Betfair exchange prices for 'at least one more goal'.

    Market choice matters more than it looks. The model produces the probability
    of *any* further goal before full time, and the market that pays out on
    exactly that event is Over/Under at the current total plus a half — at 1-1,
    backing Over 2.5. That is one bet, settling on precisely the modelled event,
    in Betfair's deepest in-play football market after Match Odds.

    Next Goal looks like the natural fit and is not: it splits the event across
    Home / Away / No Goal, so backing 'a goal' means laying No Goal and
    converting the price, and it carries a fraction of the liquidity.
    """

    LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]

    def __init__(self, app_key: str, username: str, password: str,
                 delay_s: int = 60, cert_path: str = "", key_path: str = "") -> None:
        self.app_key = app_key
        self.username = username
        self.password = password
        self.delay_s = delay_s
        self.cert_path = cert_path
        self.key_path = key_path
        self.token = ""
        self._token_at = 0.0
        self.s = requests.Session()
        self.history: dict[str, list[Quote]] = {}
        self._market_cache: dict[tuple[str, int], str] = {}
        self._event_cache: dict[str, str] = {}

    # ───────────────────────────── auth ─────────────────────────────

    def login(self) -> bool:
        """Betfair supports two logins, and only one of them is for scripts.

        Interactive login (plain username/password, no certificate) is meant
        for an app with a person sitting in front of it. Betfair blocks it
        from unattended servers — a 403 with an HTML page back, not a normal
        rejected-credentials response — which is what an empty BF_CERT_PATH
        will eventually hit. Non-interactive (certificate) login is the one
        Betfair documents for bots, and it's what runs here whenever a
        certificate is configured.
        """
        if not (self.cert_path and self.key_path):
            log.error("No BF_CERT_PATH / BF_KEY_PATH set. Betfair requires "
                      "certificate login for unattended scripts — plain "
                      "username/password from a server gets blocked with a "
                      "403. See NEXT-STEPS.md for how to generate and "
                      "upload one.")
            return False
        try:
            cert_size = os.path.getsize(self.cert_path)
            key_size = os.path.getsize(self.key_path)
        except OSError as e:
            log.error("Betfair cert/key path set but unreadable: %s", e)
            return False
        log.info("Betfair cert %s (%d bytes), key %s (%d bytes)",
                 self.cert_path, cert_size, self.key_path, key_size)
        if cert_size < 100 or key_size < 100:
            # A real cert/key is at minimum several hundred bytes. Anything
            # smaller almost certainly got truncated somewhere between the
            # file and the environment variable box it was pasted into.
            log.error("That looks too small to be a real certificate/key — "
                      "likely truncated in the paste. Re-check BF_CERT_PEM "
                      "/ BF_KEY_PEM for missing content.")
            return False
        url = BF_CERTLOGIN
        try:
            r = self.s.post(
                url,
                data={"username": self.username, "password": self.password},
                headers={"X-Application": self.app_key,
                         "Accept": "application/json",
                         "Content-Type": "application/x-www-form-urlencoded"},
                cert=(self.cert_path, self.key_path),
                timeout=15)
        except requests.exceptions.SSLError as e:
            log.error("Could not load the certificate/key for the connection "
                      "itself (%s) — this happens locally, before anything "
                      "reaches Betfair. If BF_CERT_PEM/BF_KEY_PEM were "
                      "pasted into a form field, that field may have a "
                      "character limit that silently cut the content short. "
                      "Try BF_CERT_PATH/BF_KEY_PATH (uploaded files) instead "
                      "if this platform allows it, or split the paste to "
                      "confirm nothing was truncated.", e)
            return False
        except requests.RequestException:
            log.exception("Betfair login failed — could not reach the server")
            return False
        try:
            body = r.json()
        except ValueError:
            # Betfair sent back something that isn't JSON — an empty body, an
            # HTML page, or a block response. That's a different problem from
            # a rejected login (wrong password etc.), which always comes back
            # as JSON, so show exactly what arrived instead of guessing.
            snippet = (r.text or "(empty body)")[:300]
            log.error("Betfair returned a non-JSON response — HTTP %s, "
                      "content-type %s. First bytes: %r",
                      r.status_code, r.headers.get("Content-Type", "unknown"), snippet)
            return False
        # Certificate login reports success/failure as loginStatus, not status.
        ok = body.get("loginStatus") == "SUCCESS" or body.get("status") == "SUCCESS"
        if not ok:
            log.error("Betfair login rejected: %s",
                      body.get("loginStatus") or body.get("error") or body.get("status"))
            return False
        self.token = body["sessionToken"] if "sessionToken" in body else body["token"]
        self._token_at = time.time()
        log.info("Betfair session opened")
        return True

    def _ensure_session(self) -> bool:
        """Sessions last about four hours. Refresh well before, not after.

        A token that expires mid-match takes every price with it, and the model
        then has nothing to blend toward.
        """
        if not self.token:
            return self.login()
        age = time.time() - self._token_at
        if age < 2 * 3600:
            return True
        try:
            r = self.s.post(BF_KEEPALIVE,
                            headers={"X-Application": self.app_key,
                                     "X-Authentication": self.token,
                                     "Accept": "application/json"}, timeout=10)
            if r.json().get("status") == "SUCCESS":
                self._token_at = time.time()
                return True
        except Exception:
            log.warning("Betfair keepAlive failed — re-logging in")
        return self.login()

    def _rpc(self, method: str, payload: dict) -> Any:
        if not self._ensure_session():
            return None
        try:
            r = self.s.post(
                f"{BF_BETTING}/{method}/",
                json=payload,
                headers={"X-Application": self.app_key,
                         "X-Authentication": self.token,
                         "Content-Type": "application/json",
                         "Accept": "application/json"},
                timeout=15)
        except requests.RequestException:
            log.exception("Betfair %s failed", method)
            return None
        if r.status_code == 401 or r.status_code == 403:
            log.warning("Betfair session rejected — re-logging in")
            self.token = ""
            return None
        if r.status_code != 200:
            log.warning("Betfair %s returned %s: %s", method, r.status_code, r.text[:200])
            return None
        return r.json()

    # ─────────────────────── market discovery ───────────────────────

    def find_market(self, home: str, away: str, goals: int) -> tuple[str, int] | None:
        """The Over/Under market one goal above the current score.

        Returns (marketId, selectionId) for the Over runner, or None.
        """
        line = goals + 0.5
        if line not in self.LINES:
            return None
        cached = self._market_cache.get((f"{home}|{away}", goals))
        if cached:
            mid, _, sel = cached.partition(":")
            return mid, int(sel)

        event_id = self._find_event(home, away)
        if not event_id:
            return None

        code = f"OVER_UNDER_{int(line * 10):02d}"
        res = self._rpc("listMarketCatalogue", {
            "filter": {"eventIds": [event_id], "marketTypeCodes": [code]},
            "marketProjection": ["RUNNER_DESCRIPTION"],
            "maxResults": 5,
        })
        if not res:
            return None
        for mk in res:
            for rn in mk.get("runners") or []:
                if (rn.get("runnerName") or "").lower().startswith("over"):
                    mid, sel = mk["marketId"], int(rn["selectionId"])
                    self._market_cache[(f"{home}|{away}", goals)] = f"{mid}:{sel}"
                    return mid, sel
        return None

    def _find_event(self, home: str, away: str) -> str | None:
        """Match a live-feed fixture to a Betfair event by team names.

        The two providers share no ids, so this is the seam where things break.
        A miss is logged rather than swallowed — an unmatched fixture is a
        fixture the model will never price, and silence would hide that.
        """
        key = f"{home}|{away}"
        if key in self._event_cache:
            return self._event_cache[key] or None

        res = self._rpc("listEvents", {
            "filter": {"eventTypeIds": ["1"], "inPlayOnly": True},
        })
        if not res:
            return None
        best, best_score = None, 0.0
        for row in res:
            ev = row.get("event") or {}
            nm = ev.get("name") or ""
            if " v " not in nm.lower().replace(" vs ", " v "):
                continue
            parts = re.split(r"\s+v\.?s?\.?\s+", nm, flags=re.I)
            if len(parts) != 2:
                continue
            sc = min(name_score(home, parts[0]), name_score(away, parts[1]))
            if sc > best_score:
                best, best_score = ev.get("id"), sc
        if best and best_score >= 0.5:
            self._event_cache[key] = best
            return best
        self._event_cache[key] = ""
        log.info("No Betfair event matched for %s v %s (best %.2f)", home, away, best_score)
        return None

    # ───────────────────────────── prices ─────────────────────────────

    def refresh(self, wanted: list[tuple[str, int]]) -> dict[str, Quote]:
        """One listMarketBook call for every market we are watching."""
        if not wanted:
            return {}
        out: dict[str, Quote] = {}
        ids = [m for m, _ in wanted]
        sel_for = dict(wanted)
        for i in range(0, len(ids), 40):          # Betfair caps the batch
            chunk = ids[i:i + 40]
            res = self._rpc("listMarketBook", {
                "marketIds": chunk,
                "priceProjection": {"priceData": ["EX_BEST_OFFERS"],
                                    "virtualise": True},
            })
            if not res:
                continue
            for mk in res:
                mid = mk.get("marketId")
                if mk.get("status") != "OPEN":
                    continue
                want_sel = sel_for.get(mid)
                for rn in mk.get("runners") or []:
                    if rn.get("selectionId") != want_sel:
                        continue
                    if rn.get("status") != "ACTIVE":
                        continue
                    ex = rn.get("ex") or {}
                    backs = ex.get("availableToBack") or []
                    lays = ex.get("availableToLay") or []
                    if not backs:
                        continue
                    q = Quote(ts=time.time(),
                              back=float(backs[0]["price"]),
                              lay=float(lays[0]["price"]) if lays else 0.0,
                              matched=float(mk.get("totalMatched") or 0))
                    out[mid] = q
                    h = self.history.setdefault(mid, [])
                    h.append(q)
                    if len(h) > 40:
                        del h[:-40]
        return out

    def project(self, market_id: str, odds: float) -> float:
        """Push a stale quote forward along its own recent trajectory.

        A delayed price is not merely noisy — it is most likely to be stale in
        the direction that flatters us, because the quote lags hardest exactly
        when the market is moving. A shortening market is quoted better than you
        will actually get, so EV must price off where the price is going.
        """
        h = self.history.get(market_id) or []
        if len(h) < 3 or self.delay_s < 5:
            return odds
        window = [q for q in h if h[-1].ts - q.ts <= 180]
        if len(window) < 3:
            return odds
        span = window[-1].ts - window[0].ts
        if span < 20:
            return odds
        drift = (window[-1].back - window[0].back) / span     # per second
        projected = odds + drift * self.delay_s
        # A projection bigger than the move it extrapolates from is fantasy.
        cap = abs(window[-1].back - window[0].back)
        projected = max(odds - cap, min(odds + cap, projected))
        return max(1.01, projected)

    def liquidity_block(self, market_id: str) -> str:
        """Why this market is untradeable, or empty string if it is fine.

        The model prices off best back as though you can have it. On a Finnish
        second tier at 11pm there may be £40 at that price and three ticks of
        air behind it. That gap is a real cost the EV line never sees.
        """
        h = self.history.get(market_id) or []
        if not h:
            return "no price"
        q = h[-1]
        if q.matched < MIN_MATCHED:
            return f"only £{q.matched:.0f} matched (need £{MIN_MATCHED:.0f})"
        if q.spread > MAX_SPREAD:
            return f"spread {q.spread * 100:.1f}% is too wide"
        return ""


# ═══════════════════════════════ runner ═════════════════════════════════

@dataclass
class Tracked:
    """Everything we hold between polls for one fixture."""
    states: list[tuple[float, Match]] = field(default_factory=list)
    history: list[Snapshot] = field(default_factory=list)
    market_id: str = ""
    selection_id: int = 0
    alerted: bool = False
    alert_score: tuple[int, int] = (0, 0)

    def prev10(self, minute: float) -> Match | None:
        """The fixture as it stood ten minutes of match time ago."""
        found = None
        for mn, st in self.states:
            if mn <= minute - 10:
                found = st
            else:
                break
        return found

    def push(self, m: Match) -> None:
        self.states.append((m.minute, replace(m, history=[])))
        if len(self.states) > 60:
            del self.states[:-60]


class Runner:
    def __init__(self) -> None:
        self.feed = ApiFootballFeed(_env("API_FOOTBALL_KEY"), _env("SURGE_LEAGUE_IDS"))
        cert, key = _resolve_bf_cert()
        self.prices = ExchangePrices(_env("BF_APP_KEY"), _env("BF_USERNAME"),
                                     _env("BF_PASSWORD"), CFG.price_delay_s,
                                     cert, key)
        self.tg = Telegram()
        self.evlog = EvalLog(_env("SURGE_DB", "surge.db"))
        self.tracked: dict[str, Tracked] = {}
        self._last_settle = 0.0

    # ──────────────────────────── one pass ────────────────────────────

    def tick(self) -> None:
        matches = self.feed.matches()
        if not matches:
            log.debug("No live fixtures")
            return

        # Resolve markets first, then price every one of them in a single call.
        wanted: list[tuple[str, int]] = []
        for m in matches:
            t = self.tracked.setdefault(m.fid, Tracked())
            found = self.prices.find_market(m.home, m.away, m.hg + m.ag)
            if found:
                t.market_id, t.selection_id = found
                wanted.append(found)
            else:
                t.market_id = ""
        quotes = self.prices.refresh(wanted)

        for m in matches:
            t = self.tracked[m.fid]
            if not t.market_id:
                continue
            q = quotes.get(t.market_id)
            if not q:
                continue
            m.odds = q.back
            m.history = t.history

            r = evaluate(m, t.prev10(m.minute), self.prices, t.market_id)
            t.push(m)
            t.history.append(Snapshot(m.minute, r["pressure"], r["p"],
                                      1 / m.odds if m.odds > 1 else 0.0))
            if len(t.history) > 60:
                del t.history[:-60]

            # Liquidity is a hard constraint the model cannot see, so it is
            # applied after EV rather than folded into it.
            block = self.prices.liquidity_block(t.market_id)
            if block and r["tier"] == "FIRE":
                r = dict(r, tier="WATCH", reason=block)

            fire = r["tier"] == "FIRE" and not t.alerted
            self.evlog.record(m, r, fire)

            if fire:
                t.alerted = True
                t.alert_score = (m.hg, m.ag)
                msg = bet_alert(m, r, CFG.bot_name, CFG.style)
                log.info("ALERT %s v %s %d' EV %+.1f%%", m.home, m.away,
                         int(m.minute), r["ev"] * 100)
                if DRY_RUN:
                    print("\n--- would send ---\n" + msg)
                else:
                    self.tg.send(msg)
            elif CFG.send_headsup and r["tier"] == "WATCH" and not t.alerted:
                if not DRY_RUN:
                    self.tg.send(headsup_alert(m, r, CFG.bot_name, CFG.style))

    # ─────────────────────────── settlement ───────────────────────────

    def settle(self) -> None:
        """Close out alerts on finished fixtures.

        Without this the outcome column stays NULL, the strike rate cannot be
        computed and `EvalLog.calibration()` returns nothing — which makes the
        one screen that answers whether the model works permanently blank.
        """
        open_rows = self.evlog.open_alerts()
        if not open_rows:
            return
        finals = self.feed.finished_today()
        if not finals:
            return
        for fid, _minute, score in open_rows:
            final = finals.get(fid)
            if not final:
                continue
            try:
                h0, a0 = (int(x) for x in score.split("-"))
            except ValueError:
                continue
            scored = (final[0] + final[1]) > (h0 + a0)
            n = self.evlog.settle(fid, scored)
            if n:
                log.info("Settled %s: %s → %d-%d (%s)", fid, score,
                         final[0], final[1], "WON" if scored else "LOST")
            self.tracked.pop(fid, None)

    # ──────────────────────────── the loop ────────────────────────────

    def run(self) -> None:
        log.info("Polling every %ds · price delay %ds · EV floor %.1f%%",
                 CFG.live_poll_s, CFG.price_delay_s,
                 (CFG.min_ev + CFG.price_delay_s / 60 * 0.01) * 100)
        if DRY_RUN:
            log.warning("DRY RUN — alerts print to stdout, nothing is sent")
        if not self.prices.login():
            log.error("Cannot reach Betfair — nothing can be priced. Stopping.")
            sys.exit(1)
        while True:
            start = time.time()
            try:
                self.tick()
                if start - self._last_settle > 300:
                    self.settle()
                    self.tg.flush_held()
                    self._last_settle = start
            except Exception:
                log.exception("Poll failed — continuing")
            time.sleep(max(10.0, CFG.live_poll_s - (time.time() - start)))


# ════════════════════════════════ cli ═══════════════════════════════════

def _check() -> None:
    n = load_dotenv()
    if n:
        print(f"Loaded {n} setting(s) from .env\n")

    need = {"API_FOOTBALL_KEY": _env("API_FOOTBALL_KEY"),
            "BF_APP_KEY": _env("BF_APP_KEY"),
            "BF_USERNAME": _env("BF_USERNAME"),
            "BF_PASSWORD": _env("BF_PASSWORD"),
            "BF_CERT_PATH": _env("BF_CERT_PATH"),
            "BF_KEY_PATH": _env("BF_KEY_PATH"),
            "TG_BOT_TOKEN": _env("TG_BOT_TOKEN"),
            "TG_CHAT_ID": _env("TG_CHAT_ID")}
    for k, v in need.items():
        # Never print a secret, even partially — a check command's output is the
        # thing people paste into a chat when asking why it isn't working.
        print(f"{k:<18} {'set' if v else 'MISSING'}")

    if not need["API_FOOTBALL_KEY"]:
        print("\nNo API-Football key. Copy .env.example to .env and fill it in.")
        return

    print(f"\nPrice delay       {CFG.price_delay_s}s")
    print(f"EV floor          {(CFG.min_ev + CFG.price_delay_s / 60 * 0.01) * 100:.1f}%")
    print(f"Odds range        {CFG.odds_floor:.2f}–{CFG.odds_ceil:.2f}")
    print(f"Commission        {CFG.commission * 100:.1f}%")
    print(f"Liquidity gate    £{MIN_MATCHED:.0f} matched, spread ≤ {MAX_SPREAD * 100:.0f}%")
    print(f"Stake             "
          + (f"flat £{CFG.flat_stake:.2f}" if CFG.flat_stake > 0
             else f"1/{CFG.kelly_div:.0f} Kelly, capped "
                  f"£{CFG.bank * CFG.max_stake_pct / 100:.2f}"))

    feed = ApiFootballFeed(need["API_FOOTBALL_KEY"], _env("SURGE_LEAGUE_IDS"))
    ms = feed.matches()
    print(f"\nAPI-Football      {len(ms)} fixture(s) in play "
          f"({1 + len(ms)} request(s) that poll)")
    for m in ms[:10]:
        reds = f" · {m.red_home}-{m.red_away} red" if (m.red_home or m.red_away) else ""
        print(f"  {int(m.minute):>3}' {m.home} {m.hg}-{m.ag} {m.away} "
              f"· {m.league} · {m.sot} SOT{reds}")
    if not ms:
        print("  (nothing live, or your plan does not cover what is live —")
        print("   an empty list here at 3pm on a Saturday means the plan, not the code)")
    else:
        polls_per_day = 24 * 3600 // CFG.live_poll_s
        print(f"\n  No 'dangerous attacks' field on this provider — the model")
        print(f"  renormalises and runs on one fewer signal, always, for every fixture.")
        print(f"  At {len(ms)} fixture(s) live, a poll costs {1 + len(ms)} request(s).")
        print(f"  {polls_per_day} polls/day at this rate = "
              f"{polls_per_day * (1 + len(ms)):,} requests/day if it held all day —")
        print(f"  check that against your plan's daily cap before trusting a quiet night.")

    cert, key = _resolve_bf_cert()
    if not need["BF_APP_KEY"]:
        print("\nBetfair           no key — nothing can be priced, so nothing will fire")
        return
    if not (cert and key):
        print("\nBetfair           no certificate — plain username/password login is")
        print("                  blocked by Betfair for unattended scripts (403). Set")
        print("                  BF_CERT_PATH/BF_KEY_PATH (files) or BF_CERT_PEM/")
        print("                  BF_KEY_PEM (contents). See NEXT-STEPS.md.")
        return
    px = ExchangePrices(need["BF_APP_KEY"], need["BF_USERNAME"],
                        need["BF_PASSWORD"], CFG.price_delay_s, cert, key)
    print(f"\nBetfair           {'session opened' if px.login() else 'LOGIN FAILED'}")


def _markets() -> None:
    feed = ApiFootballFeed(_env("API_FOOTBALL_KEY"), _env("SURGE_LEAGUE_IDS"))
    cert, key = _resolve_bf_cert()
    px = ExchangePrices(_env("BF_APP_KEY"), _env("BF_USERNAME"),
                        _env("BF_PASSWORD"), CFG.price_delay_s, cert, key)
    if not px.login():
        print("Betfair login failed.")
        return
    ms = feed.matches()
    if not ms:
        print("Nothing in play.")
        return
    wanted = []
    for m in ms:
        found = px.find_market(m.home, m.away, m.hg + m.ag)
        line = m.hg + m.ag + 0.5
        if found:
            wanted.append(found)
            print(f"{m.home} v {m.away} ({m.hg}-{m.ag}) → Over {line} "
                  f"· market {found[0]}")
        else:
            print(f"{m.home} v {m.away} ({m.hg}-{m.ag}) → NO MATCH")
    q = px.refresh(wanted)
    print()
    for mid, quote in q.items():
        print(f"  {mid}  back {quote.back:.2f} / lay {quote.lay:.2f} "
              f"· £{quote.matched:,.0f} matched · spread {quote.spread * 100:.1f}%")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    if "--check" in sys.argv:
        _check()
    elif "--markets" in sys.argv:
        _markets()
    else:
        Runner().run()