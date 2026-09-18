"""
surge_alerts.py — goal-anticipation alerts to Telegram.

This places no bets and talks to no exchange. It polls a live stats feed, runs
the six-gate model, and messages you when all six open. You place the bet.

    pip install requests
    python surge_alerts.py --test      # check config, send a test message
    python surge_alerts.py             # run the poller

Config comes from environment variables (see CONFIG below). Nothing is hardcoded
and no credential is ever written to a log.
"""

from __future__ import annotations

import logging
import math
import os
import sys
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import requests

log = logging.getLogger("surge")

TG_API = "https://api.telegram.org/bot{token}/sendMessage"


def load_dotenv(path: str = ".env") -> int:
    """Read secrets from a file next to the script, never from the source.

    This runs before Config is built, because Config reads the environment at
    import time — a .env loaded afterwards would be ignored silently and every
    setting would quietly fall back to its default.

    Real environment variables win over the file, so a systemd unit or a shell
    export can override .env without editing it. Missing file is not an error:
    on a server you may prefer to export the variables directly.
    """
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.exists(p):
        return 0
    mode = os.stat(p).st_mode
    if mode & 0o077:
        print(f"WARNING: {path} is readable by other users on this machine. "
              f"Run: chmod 600 {path}", file=sys.stderr)
    n = 0
    with open(p, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v
                n += 1
    return n


load_dotenv()


def _env(k: str, d: str = "") -> str:
    return os.environ.get(k, d)


def _f(k: str, d: float) -> float:
    try:
        return float(_env(k, str(d)))
    except ValueError:
        return d


def _flag(k: str, d: bool) -> bool:
    return _env(k, str(d)).strip().lower() in ("1", "true", "yes", "on")


# ─────────────────────────────── config ────────────────────────────────


@dataclass
class Config:
    # feed
    api_key: str = field(default_factory=lambda: _env("APIFOOTBALL_KEY"))
    live_poll_s: int = field(default_factory=lambda: int(_f("SURGE_LIVE_POLL", 60)))
    stats_poll_s: int = field(default_factory=lambda: int(_f("SURGE_STATS_POLL", 60)))
    leagues: str = field(default_factory=lambda: _env("SURGE_LEAGUES", ""))

    # model
    league_gpg: float = field(default_factory=lambda: _f("SURGE_LEAGUE_GPG", 2.70))
    shrink: float = field(default_factory=lambda: _f("SURGE_SHRINK", 0.70))
    commission: float = field(default_factory=lambda: _f("SURGE_COMMISSION", 0.02))

    # the six gates
    min_tempo: float = field(default_factory=lambda: _f("SURGE_MIN_TEMPO", 1.10))
    min_slope: float = field(default_factory=lambda: _f("SURGE_MIN_SLOPE", 1.5))
    min_lag: float = field(default_factory=lambda: _f("SURGE_MIN_LAG", 0.02))
    min_edge: float = field(default_factory=lambda: _f("SURGE_MIN_EDGE", 0.07))
    min_ev: float = field(default_factory=lambda: _f("SURGE_MIN_EV", 0.04))
    overround: float = field(default_factory=lambda: _f("SURGE_OVERROUND", 1.03))
    trust_base: float = field(default_factory=lambda: _f("SURGE_TRUST_BASE", 0.35))
    trust_lag: float = field(default_factory=lambda: _f("SURGE_TRUST_LAG", 4.0))
    odds_floor: float = field(default_factory=lambda: _f("SURGE_ODDS_FLOOR", 2.40))
    odds_ceil: float = field(default_factory=lambda: _f("SURGE_ODDS_CEIL", 4.50))
    min_minute: int = field(default_factory=lambda: int(_f("SURGE_MIN_MINUTE", 22)))
    max_minute: int = field(default_factory=lambda: int(_f("SURGE_MAX_MINUTE", 84)))
    min_left: int = field(default_factory=lambda: int(_f("SURGE_MIN_LEFT", 8)))

    # staking (advisory — the alert tells you, it does not act)
    bank: float = field(default_factory=lambda: _f("SURGE_BANK", 500))
    max_stake_pct: float = field(default_factory=lambda: _f("SURGE_MAX_STAKE_PCT", 2))
    kelly_div: float = field(default_factory=lambda: _f("SURGE_KELLY_DIV", 4))
    flat_stake: float = field(default_factory=lambda: _f("SURGE_FLAT_STAKE", 2))

    # exchange feed (READ ONLY — the delayed key physically cannot place bets)
    bf_app_key: str = field(default_factory=lambda: _env("BF_APP_KEY"))
    bf_user: str = field(default_factory=lambda: _env("BF_USERNAME"))
    bf_pass: str = field(default_factory=lambda: _env("BF_PASSWORD"))
    price_delay_s: int = field(default_factory=lambda: int(_f("BF_PRICE_DELAY", 60)))
    poss_weight: float = field(default_factory=lambda: _f("SURGE_POSS_WEIGHT", 0.18))

    bot_name: str = field(default_factory=lambda: _env("SURGE_BOT_NAME", "Next Goal XG"))
    style: str = field(default_factory=lambda: _env("SURGE_STYLE", "simple"))
    send_headsup: bool = field(default_factory=lambda: _flag("SURGE_HEADSUP", False))


CFG = Config()

# Goals per game by competition. One global figure put Liga Profesional (2.18)
# and the Eerste Divisie (3.30) on the same baseline — a 25% error in lambda
# before any tempo adjustment, carried straight through into EV.
LEAGUE_GPG = {
    "Premier League": 2.80, "La Liga": 2.52, "Serie A": 2.70, "Liga Portugal": 2.62,
    "Eerste Divisie": 3.30, "Allsvenskan": 2.92, "Superettan": 2.80, "Eliteserien": 3.10,
    "Veikkausliiga": 2.72, "Superliga (Denmark)": 2.90, "Ekstraklasa": 2.60,
    "Super Lig": 3.02, "1. HNL (Croatia)": 2.48, "Besta deild": 3.00,
    "Serie A (Brazil)": 2.38, "Liga MX": 2.82, "Liga Profesional": 2.18,
    "Premier Division (Ireland)": 2.46,
}


def gpg_for(league: str) -> float:
    """League scoring rate, falling back to the global default."""
    return LEAGUE_GPG.get(league, CFG.league_gpg)


# ─────────────────────────────── model ─────────────────────────────────


def base_rate(minute: float, gpg: float) -> float:
    """Goals per minute, rising through the match. Normalised to mean 1.0."""
    return (gpg / 90) * (0.65 + 0.0078 * min(minute, 95))


def state_mult(home: int, away: int, minute: float) -> float:
    """Scoreline changes intent. 0-0 late is the trap, not the opportunity."""
    d, total, late = abs(home - away), home + away, minute >= 70
    if d == 0 and total == 0:
        return 0.86 if late else 0.97
    if d == 0 and total >= 2:
        return 1.14 if late else 1.04
    if d == 1:
        return 1.22 if late else 1.08
    if d == 2:
        return 1.04 if late else 1.02
    return 0.88


def proxy_xg(inside_box: int, outside_box: int) -> float:
    """API-Football returns no xG, so build one from shot location.

    Calibrates to about 2.65 per match against a 2.70 goals-per-game league.
    Coarser than real xG — it can't tell a tap-in from a scuffed six-yarder —
    which is why the shrinkage runs higher and the edge floor sits wider.
    """
    return 0.150 * inside_box + 0.040 * outside_box


def tempo_mult(pxg10: float, sot10: float, corners10: float, minute: float,
               gpg: float | None = None, soff10: float = 0.0,
               datk10: float = 0.0, has_datk: bool = False) -> float:
    """Shots on target and off target are different evidence, weighted apart.

    On target is the strongest single predictor available. Off target is weaker
    but not noise — a side repeatedly missing is still creating positions, which
    is territory and intent.

    Dangerous attacks carry less information per event than a shot, but they
    arrive five to ten times more often. For a model whose entire thesis is
    moving before the price does, a signal that updates between shots is worth
    more than its predictive weight alone suggests: it is the difference between
    reading pressure at the moment it builds and reading it once the market has
    already seen the same shot you have.

    Coverage for that stat is patchy outside the bigger leagues, so `has_datk`
    says whether the feed supplied it rather than inferring absence from a zero.
    Missing data must not read as calm: treating an absent stat as 0 would
    deflate tempo by about 6% on exactly the obscure leagues this bot favours,
    quietly suppressing alerts there. When it is absent the remaining weights
    are renormalised instead.
    """
    e10 = base_rate(minute, gpg or CFG.league_gpg) * 10
    e_sot, e_all, e_cnr = e10 / 0.30, e10 / 0.105, 1.1
    terms = [(0.40, pxg10 / e10), (0.25, sot10 / e_sot),
             (0.14, (sot10 + soff10) / e_all), (0.09, corners10 / e_cnr)]
    if has_datk:
        terms.append((0.12, datk10 / (e10 / 0.025)))
    total_w = sum(w for w, _ in terms)
    raw = sum(w * r for w, r in terms) / total_w
    return max(0.45, min(2.30, 1 + CFG.shrink * (raw - 1)))


def red_mult(red_home: int, red_away: int, hg: int, ag: int) -> float:
    """A sending-off, which the model was previously blind to.

    This is a hole being closed, not an edge being found. The market reprices a
    red card in seconds, so there is no lag to exploit — but without this term
    the model kept its pre-card goal rate and would happily fire into a game
    that had just changed shape.

    Direction is better established than magnitude: eleven against ten produces
    more goals than eleven against eleven, and it matters enormously which side
    went down. A leader reduced to ten gets pinned in and usually concedes; a
    chasing side reduced to ten shuts up shop and the game dies. The numbers
    below are priors, not fitted values — treat them as placeholders until the
    log has enough red-card fixtures to say otherwise.
    """
    d = red_home - red_away
    if d == 0:
        return 1.0 if red_home == 0 else 1.06   # both down, game opens slightly
    short, lead = (-1 if d > 0 else 1), (hg > ag) - (hg < ag)
    if lead == 0:
        return 1.10                              # level, someone must now chase
    return 1.18 if short == -lead else 0.92


def poss_mult(poss_home: float | None, hg: int, ag: int) -> float:
    """Possession, used the one way it predicts anything.

    Raw possession barely relates to goals — a side can hold 70% passing
    sideways, and a team protecting a lead concedes the ball deliberately. What
    carries information is whether the side dominating is the side that needs a
    goal. A 70/30 split means the opposite thing at 0-1 and at 1-0.

    Sterile domination needs no term of its own: lots of the ball with few shots
    already lands as low tempo.
    """
    if not CFG.poss_weight or poss_home is None:
        return 1.0
    dom = (poss_home - 50) / 50
    lead = (hg > ag) - (hg < ag)
    return max(0.82, min(1.22, 1 + CFG.poss_weight * (-dom * lead)))


def poss_read(poss_home: float | None, hg: int, ag: int) -> str:
    if poss_home is None:
        return "—"
    dom = (poss_home - 50) / 50
    lead = (hg > ag) - (hg < ag)
    if abs(dom) < 0.12:
        return "even"
    if lead == 0:
        return ("home" if dom > 0 else "away") + " on top, level"
    return "the side behind is on top" if -dom * lead > 0 else "the side ahead is managing it"


def breakeven_prob(odds: float, commission: float) -> float:
    return 1 / ((odds - 1) * (1 - commission) + 1)


def required_odds(p: float, commission: float, ev_target: float = 0.0) -> float:
    """Lowest price at which a bet at probability p returns ev_target per £1.

    ev_target=0 gives plain break-even. The floor of 0.02 on the denominator
    stops a near-zero probability producing an absurd price rather than an
    error — at that point the bet is not worth making at any price anyway.
    """
    return 1 + (ev_target + 1 - p) / max(0.02, p * (1 - commission))


def kelly(p: float, odds: float, commission: float) -> float:
    b = (odds - 1) * (1 - commission)
    return 0.0 if b <= 0 else max(0.0, (p * b - (1 - p)) / b)


def recommended_stake(p: float, odds: float) -> float:
    """Flat while the model is unproven, Kelly once it isn't.

    Kelly sizes in proportion to believed edge, so it stakes hardest exactly
    where the model is most confident — and an uncalibrated model is most
    confident precisely where it is most wrong. Until the calibration buckets
    line up, a flat stake makes the sample cheap to collect and keeps one bad
    assumption from compounding. Set SURGE_FLAT_STAKE=0 to switch Kelly back on.
    """
    if CFG.flat_stake > 0:
        return round(min(CFG.flat_stake, CFG.bank * CFG.max_stake_pct / 100), 2)
    full = CFG.bank * kelly(p, odds, CFG.commission) / CFG.kelly_div
    return round(min(CFG.bank * CFG.max_stake_pct / 100, full), 2)


# ───────────────────────────── match state ─────────────────────────────


@dataclass
class Snapshot:
    minute: float
    pressure: int
    model_p: float
    market_p: float


@dataclass
class Match:
    fid: str
    home: str
    away: str
    league: str
    minute: float = 0.0
    hg: int = 0
    ag: int = 0
    odds: float = 0.0
    # cumulative counters straight off the feed
    inside: int = 0
    outside: int = 0
    sot: int = 0
    soff: int = 0
    corners: int = 0
    datk: int = 0
    has_datk: bool = False
    red_home: int = 0
    red_away: int = 0
    poss_home: float | None = None
    history: list[Snapshot] = field(default_factory=list)
    alerted: bool = False

    def window(self, mins: float) -> Snapshot | None:
        """Most recent snapshot at least `mins` of match time ago."""
        if not self.history:
            return None
        target = self.minute - mins
        found = None
        for s in self.history:
            if s.minute <= target:
                found = s
            else:
                break
        return found

    def deltas(self, prev: "Match | None") -> tuple[float, ...]:
        """Ten-minute windows. The feed is cumulative, so we subtract."""
        if prev is None:
            return 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        return (
            max(0, self.inside - prev.inside),
            max(0, self.outside - prev.outside),
            max(0, self.sot - prev.sot),
            max(0, self.corners - prev.corners),
            max(0, self.soff - prev.soff),
            max(0, self.datk - prev.datk),
        )


def evaluate(m: Match, prev10: Match | None, prices: "ExchangePrices | None" = None,
             market_id: str = "") -> dict[str, Any]:
    """One number decides it: expected value per £1 staked.

    Hard constraints are genuinely binary — you cannot take the bet outside the
    window or on an excluded scoreline. Everything else feeds EV. An earlier
    version required six conditions true at once, which threw information away:
    a large edge with one weak reading beats a marginal one where every reading
    scrapes over its line.
    """
    inside10, outside10, sot10, cnr10, soff10, datk10 = m.deltas(prev10)
    pxg10 = proxy_xg(inside10, outside10)
    gpg = gpg_for(m.league)

    tempo = tempo_mult(pxg10, sot10, cnr10, m.minute, gpg, soff10,
                       datk10, m.has_datk)
    state = state_mult(m.hg, m.ag, m.minute)
    poss = poss_mult(m.poss_home, m.hg, m.ag)
    red = red_mult(m.red_home, m.red_away, m.hg, m.ag)
    lam = base_rate(m.minute, gpg) * tempo * state * poss * red
    left = max(0.0, 92 - m.minute)
    p = 1 - math.exp(-lam * left)

    pressure = round(max(0, min(100, (tempo - 0.45) / 1.85 * 100)))
    market_p = 1 / m.odds if m.odds > 1 else 0.0
    be = breakeven_prob(m.odds, CFG.commission) if m.odds > 1 else 1.0

    # Price lag, read off one clock. The quote is CFG.price_delay_s old, so
    # comparing a current model against a stale market reading would show the
    # model "ahead" purely because our market data is behind — manufacturing
    # edge out of latency. Sample the model at the moment the price was taken.
    d_min = CFG.price_delay_s / 60
    at_quote = m.window(d_min) if d_min > 0.05 else None
    prior = m.window(d_min + 5)
    past = m.window(5)
    if at_quote and prior:
        lag = (at_quote.model_p - prior.model_p) - (market_p - prior.market_p)
    elif past:
        lag = (p - past.model_p) - (market_p - past.market_p)
    else:
        lag = 0.0
    slope = (pressure - past.pressure) / max(0.1, m.minute - past.minute) if past else 0.0

    # The quote has had time to move and tends to keep going the way it was.
    proj_odds = prices.project(market_id, m.odds) if prices and market_id else m.odds
    stale_cost = m.odds - proj_odds

    # The book usually knows more than this model, so blend toward it. Price lag
    # sets the weight: outrunning the price earns trust, trailing it loses trust.
    p_mkt = max(0.02, min(0.98, market_p / CFG.overround))
    w = max(0.15, min(0.70, CFG.trust_base + CFG.trust_lag * lag))
    p_used = w * p + (1 - w) * p_mkt

    ev = p_used * (proj_odds - 1) * (1 - CFG.commission) - (1 - p_used)
    ev_floor = CFG.min_ev + d_min * 0.01     # extra return for not knowing the price
    min_price = required_odds(p_used, CFG.commission, ev_floor)

    d, total = abs(m.hg - m.ag), m.hg + m.ag
    hard = [
        (CFG.min_minute <= m.minute <= CFG.max_minute,
         f"{int(m.minute)}' is outside the {CFG.min_minute}'–{CFG.max_minute}' window"),
        (left >= CFG.min_left, f"only {round(left)} minutes left"),
        (total > 0, "0-0 is excluded"),
        (d < 3, f"{m.hg}-{m.ag} is a dead game"),
        (m.odds >= CFG.odds_floor, f"{m.odds:.2f} is under the {CFG.odds_floor:.2f} floor"),
        (m.odds <= CFG.odds_ceil, f"{m.odds:.2f} is over the {CFG.odds_ceil:.2f} ceiling"),
    ]
    failed = [why for ok, why in hard if not ok]
    eligible = not failed

    if not eligible:
        tier, reason = "HOLD", failed[0]
    elif ev >= ev_floor:
        tier, reason = "FIRE", ""
    elif lag < 0:
        tier = "WATCH" if ev >= ev_floor * 0.35 else "HOLD"
        reason = (f"the market already repriced — lag {lag * 100:+.1f}pp, "
                  f"model weighted down to {w * 100:.0f}%")
    else:
        tier = "WATCH" if ev >= ev_floor * 0.35 else "HOLD"
        reason = (f"EV only {ev * 100:+.1f}% against a {ev_floor * 100:.1f}% floor"
                  + (" (widened for feed delay)" if d_min > 0.05 else ""))

    return {
        "tier": tier, "reason": reason, "eligible": eligible, "failed": failed,
        "p": p, "p_mkt": p_mkt, "p_used": p_used, "w": w, "ev": ev,
        "ev_floor": ev_floor, "be": be, "edge": p_used - be,
        "tempo": tempo, "state": state, "poss": poss, "red": red,
        "datk": datk10,
        "poss_read": poss_read(m.poss_home, m.hg, m.ag),
        "pressure": pressure, "slope": slope, "lag": lag,
        "sot": sot10, "soff": soff10,
        "proj_odds": proj_odds, "stale_cost": stale_cost,
        "min_price": min_price, "stake": recommended_stake(p_used, proj_odds),
    }


# ────────────────────────────── telegram ───────────────────────────────


class Telegram:
    """Alerts to your phone, rate-limited and quiet-hours aware.

    An alert at 03:44 for a marginal price is an alert that gets bet badly, so
    overnight ones are held and delivered together in the morning.
    """

    def __init__(self) -> None:
        self.token = _env("TG_BOT_TOKEN")
        self.chat = _env("TG_CHAT_ID")
        self.max_per_hour = int(_f("TG_MAX_PER_HOUR", 6))
        self.quiet = _flag("TG_QUIET_HOURS", True)
        self.quiet_from = _f("TG_QUIET_FROM", 23.5)
        self.quiet_to = _f("TG_QUIET_TO", 6.5)
        self._sent: list[float] = []
        self._held: list[str] = []
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.chat)

    def _in_quiet(self) -> bool:
        if not self.quiet:
            return False
        now = datetime.now()
        hour = now.hour + now.minute / 60
        if self.quiet_from > self.quiet_to:  # window crosses midnight
            return hour >= self.quiet_from or hour < self.quiet_to
        return self.quiet_from <= hour < self.quiet_to

    def send(self, text: str, *, force: bool = False) -> bool:
        if not self.enabled:
            log.warning("Telegram not configured — alert dropped")
            return False
        with self._lock:
            if self._in_quiet() and not force:
                self._held.append(text)
                log.info("Quiet hours — holding alert (%d queued)", len(self._held))
                return False
            cutoff = time.time() - 3600
            self._sent = [t for t in self._sent if t > cutoff]
            if len(self._sent) >= self.max_per_hour and not force:
                log.info("Rate limit — alert suppressed")
                return False
            self._sent.append(time.time())
        try:
            r = requests.post(TG_API.format(token=self.token),
                              json={"chat_id": self.chat, "text": text}, timeout=10)
            ok = r.json().get("ok", False)
            if not ok:
                log.warning("Telegram rejected the message")
            return ok
        except Exception:
            log.exception("Telegram send failed")
            return False

    def flush_held(self) -> int:
        with self._lock:
            queued, self._held = self._held, []
        if not queued:
            return 0
        self.send(f"{len(queued)} alert(s) held overnight:\n\n"
                  + "\n\n———\n\n".join(queued), force=True)
        return len(queued)


def bet_alert(m: Match, r: dict, bot: str, style: str = "simple") -> str:
    if style == "simple":
        return (f"⚽ BACK · {bot}\n{int(m.minute)}' {m.home} v {m.away}\n"
                f"{m.hg}-{m.ag} · {m.league}\n\n"
                f"BACK next goal @ {r['proj_odds']:.2f}\n"
                f"£{r['stake']:.2f} — don't take under {r['min_price']:.2f}\n\n"
                f"EV {r['ev'] * 100:+.1f}%")
    stale = (f"Quoted {m.odds:.2f}, likely now {r['proj_odds']:.2f}\n"
             if abs(r["stale_cost"]) > 0.01 else "")
    return (f"⚽ BACK · {bot}\n{m.home} v {m.away}\n"
            f"{m.league} · {int(m.minute)}' · {m.hg}-{m.ag}\n\n"
            f"Back the next goal\nTake {r['proj_odds']:.2f} or better\n"
            f"Do not take under {r['min_price']:.2f}\n\n"
            f"Stake £{r['stake']:.2f}\n\n"
            + stale +
            f"Model {r['p']:.1%} · market {r['p_mkt']:.1%}\n"
            f"Blended {r['p_used']:.1%} at {r['w'] * 100:.0f}% model weight\n"
            f"Break-even {r['be']:.1%} · EV {r['ev'] * 100:+.1f}%\n\n"
            f"Pressure {r['pressure']}/100 rising {r['slope']:+.1f}/min\n"
            f"Shots {r['sot']:.1f} on / {r['soff']:.1f} off in 10'\n"
            f"Possession: {r['poss_read']}\n"
            f"Price lag {r['lag'] * 100:+.1f}pp")


def headsup_alert(m: Match, r: dict, bot: str, style: str = "simple") -> str:
    if style == "simple":
        return (f"👀 HEADS UP · {bot}\n{int(m.minute)}' {m.home} v {m.away}\n"
                f"{m.hg}-{m.ag} · {m.league}\n\n"
                f"Goal looks likely — model {r['p']:.0%}\n"
                f"But EV is only {r['ev'] * 100:+.1f}%\n\n"
                f"No bet: {r['reason'] or 'below the floor'}")
    return (f"👀 HEADS UP · {bot}\n{m.home} v {m.away}\n"
            f"{m.league} · {int(m.minute)}' · {m.hg}-{m.ag}\n\n"
            f"Model {r['p']:.1%} · market {r['p_mkt']:.1%}\n"
            f"Blended {r['p_used']:.1%} at {r['w'] * 100:.0f}% model weight\n"
            f"Break-even {r['be']:.1%} · EV {r['ev'] * 100:+.1f}%\n\n"
            f"No bet: {r['reason'] or 'below the floor'}\n\n"
            f"Pressure {r['pressure']}/100 ({r['slope']:+.1f}/min) "
            f"· lag {r['lag'] * 100:+.1f}pp")


# ─────────────────────────── calibration log ───────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY, ts TEXT, fixture_id TEXT, league TEXT,
  minute REAL, score TEXT, tempo REAL, pressure INTEGER, slope REAL, lag REAL,
  model_p REAL, market_odds REAL, breakeven_p REAL, edge REAL,
  green INTEGER, tier TEXT, alerted INTEGER, outcome TEXT
);
CREATE INDEX IF NOT EXISTS ix_eval_ts ON evaluations(ts);
"""


class EvalLog:
    """Every evaluation, not just the alerts.

    This file eventually answers whether the model works. Bucket `model_p` and
    compare each bucket's hit rate to its midpoint: if the 60% bucket lands near
    60%, the model is calibrated. That test means something long before the P&L
    does, because at this sample size the P&L is mostly noise and calibration
    is not.
    """

    def __init__(self, path: str = "surge.db") -> None:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript(SCHEMA)
        self.db.commit()
        self._lock = threading.Lock()

    def record(self, m: Match, r: dict, alerted: bool) -> None:
        # r.get, not r["green"]: the `green` column exists in the schema but
        # `evaluate()` never actually computes a "green" value — that's a
        # gap in the model itself, predating this fix. Logging NULL for it
        # keeps every OTHER evaluation from being lost to a crash; it
        # doesn't answer what "green" was meant to measure.
        with self._lock:
            self.db.execute(
                "INSERT INTO evaluations (ts,fixture_id,league,minute,score,tempo,"
                "pressure,slope,lag,model_p,market_odds,breakeven_p,edge,green,tier,"
                "alerted,outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
                (datetime.now(timezone.utc).isoformat(), m.fid, m.league, m.minute,
                 f"{m.hg}-{m.ag}", r["tempo"], r["pressure"], r["slope"], r["lag"],
                 r["p"], m.odds, r["be"], r["edge"], r.get("green"), r["tier"],
                 1 if alerted else 0))
            self.db.commit()


    def settle(self, fixture_id: str, goals_after_entry: bool) -> int:
        """Mark open alerts on a finished fixture.

        A Next Goal bet wins the moment one more goal arrives and loses at full
        time if none does. Nothing was writing this column, so the strike rate
        could never be computed and `calibration` could never return a row —
        the feedback loop was not weak, it was absent.
        """
        with self._lock:
            cur = self.db.execute(
                "UPDATE evaluations SET outcome = ? "
                "WHERE fixture_id = ? AND alerted = 1 AND outcome IS NULL",
                ("W" if goals_after_entry else "L", fixture_id))
            self.db.commit()
            return cur.rowcount

    def open_alerts(self) -> list[tuple[str, float, str]]:
        """Alerted fixtures still awaiting a result: (fixture_id, minute, score)."""
        return self.db.execute(
            "SELECT fixture_id, minute, score FROM evaluations "
            "WHERE alerted = 1 AND outcome IS NULL").fetchall()

    def calibration(self, buckets: int = 10) -> list[dict]:
        rows = self.db.execute(
            "SELECT model_p, outcome FROM evaluations "
            "WHERE alerted=1 AND outcome IN ('W','L')").fetchall()
        out = []
        for i in range(buckets):
            lo, hi = i / buckets, (i + 1) / buckets
            hits = [o for p, o in rows if lo <= p < hi]
            if not hits:
                continue
            out.append({"bucket": f"{lo:.0%}–{hi:.0%}", "n": len(hits),
                        "predicted": (lo + hi) / 2,
                        "observed": sum(1 for o in hits if o == "W") / len(hits)})
        return out


# ──────────────────────────────── cli ──────────────────────────────────


def _test() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    tg = Telegram()
    print(f"Feed key      : {'set' if CFG.api_key else 'MISSING'}")
    print(f"Telegram      : {'configured' if tg.enabled else 'MISSING token or chat id'}")
    print(f"Bot name      : {CFG.bot_name}")
    print(f"Style         : {CFG.style}")
    print(f"Heads-up      : {'on' if CFG.send_headsup else 'off'}")
    print(f"Decision      : EV ≥ {CFG.min_ev * 100:.1f}% "
          f"(+{CFG.price_delay_s / 60 * 1:.1f}% delay margin)")
    print(f"Blend         : {CFG.trust_base * 100:.0f}% base model weight, "
          f"{CFG.trust_lag:.1f}× per unit of lag")
    print(f"Possession    : weight {CFG.poss_weight:.2f}")
    print(f"Exchange      : {'read-only key set' if CFG.bf_app_key else 'MISSING — no price source'}, "
          f"{CFG.price_delay_s}s delay")
    print(f"Commission    : {CFG.commission * 100:.1f}%")
    print(f"Odds range    : {CFG.odds_floor:.2f}–{CFG.odds_ceil:.2f}")
    print(f"Stake         : "
          + (f"flat £{CFG.flat_stake:.2f} (Kelly off while unproven)"
             if CFG.flat_stake > 0 else
             f"≤£{CFG.bank * CFG.max_stake_pct / 100:.2f} "
             f"(1/{CFG.kelly_div:.0f} Kelly of £{CFG.bank:.0f})"))

    demo = Match("0", "Inter Turku", "VPS", "Veikkausliiga",
                 minute=68, hg=1, ag=1, odds=2.42,
                 inside=9, outside=6, sot=5, soff=7, corners=4, poss_home=58)
    demo.history = [Snapshot(58, 44, 0.470, 1 / 2.62), Snapshot(63, 48, 0.505, 1 / 2.50)]
    prev = Match("0", "", "", "", inside=4, outside=4, sot=2, soff=4, corners=3)
    r = evaluate(demo, prev)
    print(f"\nDemo evaluation: tier {r['tier']}, EV {r['ev'] * 100:+.1f}% "
          f"vs floor {r['ev_floor'] * 100:.1f}%")
    for k, v in [("Model", f"{r['p']:.1%}"), ("Market", f"{r['p_mkt']:.1%}"),
                 ("Model weight", f"{r['w'] * 100:.0f}%"), ("Blended", f"{r['p_used']:.1%}"),
                 ("Break-even", f"{r['be']:.1%}"), ("Tempo", f"×{r['tempo']:.2f}"),
                 ("Possession", f"×{r['poss']:.2f} — {r['poss_read']}"),
                 ("Shots", f"{r['sot']:.0f} on / {r['soff']:.0f} off"),
                 ("Price lag", f"{r['lag'] * 100:+.1f}pp")]:
        print(f"  {k:<14} {v}")
    if r["reason"]:
        print(f"  {'Blocked by':<14} {r['reason']}")

    msg = bet_alert(demo, r, CFG.bot_name, CFG.style) if r["tier"] == "FIRE" \
        else headsup_alert(demo, r, CFG.bot_name, CFG.style)
    print("\n--- message ---\n" + msg)

    if tg.enabled:
        print("\nSending test…", "delivered" if tg.send(msg, force=True) else "failed")
    else:
        print("\nSet TG_BOT_TOKEN and TG_CHAT_ID to send it.")


if __name__ == "__main__":
    import sys
    if "--test" in sys.argv:
        _test()
    else:
        print(__doc__)
        print("Run with --test first. The live poller needs APIFOOTBALL_KEY set\n"
              "and a league whitelist in SURGE_LEAGUES.")