"""
surge_live.py — the data layer. Sportmonks in, Betfair prices in, alerts out.

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

    SPORTMONKS_KEY      required
    SURGE_LEAGUE_IDS    optional, comma-separated Sportmonks league ids
    BF_APP_KEY          required — the key marked 1.0-DELAY
    BF_USERNAME         required
    BF_PASSWORD         required
    TG_BOT_TOKEN        required
    TG_CHAT_ID          required

    BF_PRICE_DELAY      seconds, default 60 — must match your key's real delay
    SURGE_MIN_MATCHED   minimum £ matched on the market, default 200
    SURGE_MAX_SPREAD    maximum back/lay spread as a fraction, default 0.08
    SURGE_DRY_RUN       1 to log alerts without sending them
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
from surge_state import write_state, upload_db

log = logging.getLogger("surge.live")

SM_BASE = "https://api.sportmonks.com/v3/football"
BF_LOGIN = "https://identitysso.betfair.com/api/login"
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


# ══════════════════════════════ Sportmonks ══════════════════════════════

# Statistics are matched on `developer_name` from the `statistics.type` include,
# not on hardcoded type ids. Ids are stable in practice but they are Sportmonks'
# to change, and a silent remap would corrupt tempo without raising anything.
WANTED_STATS = {
    "SHOTS_ON_TARGET": "sot",
    "SHOTS_OFF_TARGET": "soff",
    "SHOTS_INSIDEBOX": "inside",
    "SHOTS_OUTSIDEBOX": "outside",
    "CORNERS": "corners",
    "BALL_POSSESSION": "poss",
    "DANGEROUS_ATTACKS": "datk",
    "REDCARDS": "red",
}

# Fallback ids, used only when the type include is absent from the response.
STAT_IDS = {86: "sot", 41: "soff", 49: "inside", 50: "outside",
            34: "corners", 45: "poss", 44: "datk", 83: "red"}

LIVE_STATES = {"INPLAY_1ST_HALF", "INPLAY_2ND_HALF", "HT",
               "INPLAY_ET", "INPLAY_ET_2ND_HALF", "BREAK"}
DONE_STATES = {"FT", "AET", "FT_PEN", "POSTPONED", "CANCELLED",
               "ABANDONED", "WALKOVER", "AWARDED"}


class SportmonksFeed:
    """Live fixtures with the statistics the model needs.

    One request per poll returns every in-play fixture with scores, teams,
    period clock, state and team statistics. Sportmonks updates on a ten-second
    cycle, so polling faster than that spends quota to receive the same numbers.
    """

    def __init__(self, token: str, league_ids: str = "") -> None:
        self.token = token
        self.league_ids = [x.strip() for x in league_ids.split(",") if x.strip()]
        self.endpoint = _env("SURGE_SM_ENDPOINT", "/livescores/inplay")
        self.s = requests.Session()

    def _get(self, path: str, **params: Any) -> list[dict]:
        params["api_token"] = self.token
        try:
            r = self.s.get(f"{SM_BASE}{path}", params=params, timeout=15)
        except requests.RequestException:
            log.exception("Sportmonks request failed")
            return []
        if r.status_code == 429:
            log.warning("Sportmonks rate limit hit — backing off")
            time.sleep(20)
            return []
        if r.status_code in (401, 403):
            # Worth separating from a generic failure: these three look
            # identical from the outside (no fixtures returned) but need
            # completely different fixes, and guessing wastes an evening.
            log.error("Sportmonks rejected the token (%s). Either the token is "
                      "wrong, or your plan does not cover the leagues you asked "
                      "for, or the trial has lapsed.", r.status_code)
            return []
        if r.status_code != 200:
            log.warning("Sportmonks %s returned %s", path, r.status_code)
            return []
        body = r.json()
        data = body.get("data", [])
        return data if isinstance(data, list) else [data]

    def inplay(self) -> list[dict]:
        """Every live fixture, with full cumulative statistics.

        Sportmonks offers three livescores endpoints and only one suits this bot:

          /livescores/inplay   every fixture in play right now        ← this one
          /livescores          everything today, including unstarted
          /livescores/latest   only fixtures changed in the last 10s

        `/latest` is the efficient choice for a scoreboard that already holds
        state and just needs deltas. It is the wrong choice here, and quietly so.
        The model works from ten-minute windows of *cumulative* counters, so it
        needs each fixture's running totals on every pass. Polling `/latest` on
        a 60-second cycle returns only what moved inside a 10-second window —
        roughly a sixth of the cycle — so most live matches would simply be
        absent from most polls. Nothing would error. Alerts would just never
        fire, and the gap would look like a quiet night rather than a bug.

        Set SURGE_SM_ENDPOINT to override if you want to see this for yourself.
        """
        params = {
            "include": "scores;participants;statistics.type;periods;state;league",
        }
        if self.league_ids:
            params["filters"] = "fixtureLeagues:" + ",".join(self.league_ids)
        return self._get(self.endpoint, **params)

    # ─────────────────────────── parsing ───────────────────────────

    @staticmethod
    def _minute(fx: dict) -> float:
        """Match clock. The ticking period carries it; nothing else does."""
        for p in fx.get("periods") or []:
            if p.get("ticking"):
                return float(p.get("minutes") or 0) + float(p.get("time_added") or 0)
        # Not ticking: half time, or a period that has just ended.
        mins = [float(p.get("minutes") or 0) for p in (fx.get("periods") or [])]
        return max(mins) if mins else 0.0

    @staticmethod
    def _teams(fx: dict) -> tuple[str, str]:
        home = away = ""
        for p in fx.get("participants") or []:
            loc = (p.get("meta") or {}).get("location")
            if loc == "home":
                home = p.get("name") or ""
            elif loc == "away":
                away = p.get("name") or ""
        return home, away

    @staticmethod
    def _score(fx: dict) -> tuple[int, int]:
        hg = ag = 0
        for s in fx.get("scores") or []:
            if s.get("description") != "CURRENT":
                continue
            sc = s.get("score") or {}
            goals = int(sc.get("goals") or 0)
            if sc.get("participant") == "home":
                hg = goals
            elif sc.get("participant") == "away":
                ag = goals
        return hg, ag

    @staticmethod
    def _stats(fx: dict) -> dict[str, float]:
        """Match totals for shots, plus home possession percentage.

        The model prices *any* next goal, so shot counts are summed across both
        teams. Possession is the exception — it only means anything as the home
        share, because the model asks whether the side on the ball is the side
        chasing.
        """
        out = {"sot": 0.0, "soff": 0.0, "inside": 0.0,
               "outside": 0.0, "corners": 0.0, "datk": 0.0}
        poss_home = None
        red_home = red_away = 0
        for st in fx.get("statistics") or []:
            t = st.get("type") or {}
            key = WANTED_STATS.get(t.get("developer_name") or "")
            if key is None:
                key = STAT_IDS.get(st.get("type_id"))
            if key is None:
                continue
            val = (st.get("data") or {}).get("value")
            if val is None:
                continue
            if key == "poss":
                if st.get("location") == "home":
                    poss_home = float(val)
            elif key == "red":
                # Red cards are per side and never summed: which team went down
                # is the entire signal, and a total of 1 says nothing.
                if st.get("location") == "home":
                    red_home = int(val)
                else:
                    red_away = int(val)
            else:
                out[key] += float(val)
        out["poss_home"] = poss_home
        out["red_home"], out["red_away"] = red_home, red_away
        out["has_datk"] = any(
            (st.get("type") or {}).get("developer_name") == "DANGEROUS_ATTACKS"
            or st.get("type_id") == 44
            for st in fx.get("statistics") or [])
        return out

    def matches(self) -> list[Match]:
        found = []
        for fx in self.inplay():
            state = ((fx.get("state") or {}).get("developer_name") or "").upper()
            if state in DONE_STATES:
                continue
            home, away = self._teams(fx)
            if not home or not away:
                continue
            hg, ag = self._score(fx)
            s = self._stats(fx)
            found.append(Match(
                fid=str(fx.get("id")),
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
        out = {}
        for fx in self._get("/livescores", include="scores;state"):
            state = ((fx.get("state") or {}).get("developer_name") or "").upper()
            if state in DONE_STATES:
                out[str(fx.get("id"))] = self._score(fx)
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
                 delay_s: int = 60) -> None:
        self.app_key = app_key
        self.username = username
        self.password = password
        self.delay_s = delay_s
        self.token = ""
        self._token_at = 0.0
        self.s = requests.Session()
        self.history: dict[str, list[Quote]] = {}
        self._market_cache: dict[tuple[str, int], str] = {}
        self._event_cache: dict[str, str] = {}

    # ───────────────────────────── auth ─────────────────────────────

    def login(self) -> bool:
        try:
            r = self.s.post(
                BF_LOGIN,
                data={"username": self.username, "password": self.password},
                headers={"X-Application": self.app_key,
                         "Accept": "application/json",
                         "Content-Type": "application/x-www-form-urlencoded"},
                timeout=15)
            body = r.json()
        except Exception:
            log.exception("Betfair login failed")
            return False
        if body.get("status") != "SUCCESS":
            log.error("Betfair login rejected: %s", body.get("error") or body.get("status"))
            return False
        self.token = body["token"]
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
        """Match a Sportmonks fixture to a Betfair event by team names.

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
        self.feed = SportmonksFeed(_env("SPORTMONKS_KEY"), _env("SURGE_LEAGUE_IDS"))
        self.prices = ExchangePrices(_env("BF_APP_KEY"), _env("BF_USERNAME"),
                                     _env("BF_PASSWORD"), CFG.price_delay_s)
        self.tg = Telegram()
        self.evlog = EvalLog(_env("SURGE_DB", "surge.db"))
        self.tracked: dict[str, Tracked] = {}
        self._last_settle = 0.0

    # ──────────────────────────── one pass ────────────────────────────

    def tick(self) -> None:
        matches = self.feed.matches()
        if not matches:
            log.debug("No live fixtures")
            write_state([])
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

        # What the HTML control panel gets to see — identity plus the full
        # evaluate() output, nothing that touches a credential. Rebuilt fresh
        # every tick() rather than mutated, so a fixture that drops out of
        # `matches` (settled, postponed) simply stops appearing.
        live_out: list[dict] = []

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

            live_out.append({
                "id": m.fid, "home": m.home, "away": m.away, "league": m.league,
                "minute": m.minute, "hg": m.hg, "ag": m.ag, "odds": m.odds,
                "alerted": t.alerted,
                **r,
                "history": [
                    {"minute": s.minute, "pressure": s.pressure,
                     "model_p": s.model_p, "market_p": s.market_p}
                    for s in t.history[-20:]
                ],
            })

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

        write_state(live_out)

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
            return
        upload_db(self.evlog.path)  # so surge_api.py has *something* on first deploy,
                                     # rather than a 5-minute wait for the first cycle
        while True:
            start = time.time()
            try:
                self.tick()
                if start - self._last_settle > 300:
                    self.settle()
                    self.tg.flush_held()
                    self._last_settle = start
                    # surge.db only ever lives on this container's local
                    # disk (SQLite wants a real filesystem). Push a copy to
                    # Spaces on the same 5-minute cadence as settlement so
                    # surge_api.py has something recent to read calibration
                    # and trades from — see surge_state.py's docstring.
                    upload_db(self.evlog.path)
            except Exception:
                log.exception("Poll failed — continuing")
            time.sleep(max(10.0, CFG.live_poll_s - (time.time() - start)))


# ════════════════════════════════ cli ═══════════════════════════════════

def _check() -> None:
    n = load_dotenv()
    if n:
        print(f"Loaded {n} setting(s) from .env\n")

    need = {"SPORTMONKS_KEY": _env("SPORTMONKS_KEY"),
            "BF_APP_KEY": _env("BF_APP_KEY"),
            "BF_USERNAME": _env("BF_USERNAME"),
            "BF_PASSWORD": _env("BF_PASSWORD"),
            "TG_BOT_TOKEN": _env("TG_BOT_TOKEN"),
            "TG_CHAT_ID": _env("TG_CHAT_ID")}
    for k, v in need.items():
        # Never print a secret, even partially — a check command's output is the
        # thing people paste into a chat when asking why it isn't working.
        print(f"{k:<18} {'set' if v else 'MISSING'}")

    if not need["SPORTMONKS_KEY"]:
        print("\nNo Sportmonks token. Copy .env.example to .env and fill it in.")
        return

    print(f"\nEndpoint          {_env('SURGE_SM_ENDPOINT', '/livescores/inplay')}")
    print(f"Price delay       {CFG.price_delay_s}s")
    print(f"EV floor          {(CFG.min_ev + CFG.price_delay_s / 60 * 0.01) * 100:.1f}%")
    print(f"Odds range        {CFG.odds_floor:.2f}–{CFG.odds_ceil:.2f}")
    print(f"Commission        {CFG.commission * 100:.1f}%")
    print(f"Liquidity gate    £{MIN_MATCHED:.0f} matched, spread ≤ {MAX_SPREAD * 100:.0f}%")
    print(f"Stake             "
          + (f"flat £{CFG.flat_stake:.2f}" if CFG.flat_stake > 0
             else f"1/{CFG.kelly_div:.0f} Kelly, capped "
                  f"£{CFG.bank * CFG.max_stake_pct / 100:.2f}"))

    feed = SportmonksFeed(need["SPORTMONKS_KEY"], _env("SURGE_LEAGUE_IDS"))
    ms = feed.matches()
    print(f"\nSportmonks        {len(ms)} fixture(s) in play")
    missing_datk = 0
    for m in ms[:10]:
        reds = f" · {m.red_home}-{m.red_away} red" if (m.red_home or m.red_away) else ""
        datk = f"{m.datk} d.att" if m.has_datk else "no d.att"
        if not m.has_datk:
            missing_datk += 1
        print(f"  {int(m.minute):>3}' {m.home} {m.hg}-{m.ag} {m.away} "
              f"· {m.league} · {m.sot} SOT · {datk}{reds}")
    if not ms:
        print("  (nothing live, or your plan does not cover what is live —")
        print("   an empty list here at 3pm on a Saturday means the plan, not the code)")
    elif missing_datk:
        print(f"\n  {missing_datk} fixture(s) without dangerous attacks — tempo")
        print("  renormalises for those, so they are scored, just on fewer signals.")

    if not need["BF_APP_KEY"]:
        print("\nBetfair           no key — nothing can be priced, so nothing will fire")
        return
    px = ExchangePrices(need["BF_APP_KEY"], need["BF_USERNAME"],
                        need["BF_PASSWORD"], CFG.price_delay_s)
    print(f"\nBetfair           {'session opened' if px.login() else 'LOGIN FAILED'}")


def _markets() -> None:
    feed = SportmonksFeed(_env("SPORTMONKS_KEY"), _env("SURGE_LEAGUE_IDS"))
    px = ExchangePrices(_env("BF_APP_KEY"), _env("BF_USERNAME"),
                        _env("BF_PASSWORD"), CFG.price_delay_s)
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
