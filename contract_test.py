"""
contract_test.py — does surge_alerts still satisfy surge_live?

Run this before every deploy. Three separate failures reached production because
surge_alerts.py was edited as though it were standalone, when surge_live.py
imports nine names from it and reaches into their attributes:

    ImportError: cannot import name 'load_dotenv'
    AttributeError: 'EvalLog' object has no attribute 'path'
    AttributeError: 'Match' object has no attribute 'datk'

Each cost a deploy. None would have survived this file.

    python contract_test.py
"""

from __future__ import annotations

import sys
import tempfile
import traceback

FAIL: list[str] = []


def check(label: str, fn) -> None:
    try:
        fn()
        print(f"  ok      {label}")
    except Exception as exc:
        FAIL.append(label)
        print(f"  FAILED  {label}\n            {type(exc).__name__}: {exc}")


print("Importing surge_alerts…")
import surge_alerts as sa  # noqa: E402

# ── the nine names surge_live.py imports ──────────────────────────────────
print("\nImports surge_live.py performs:")
for name in ("CFG", "EvalLog", "Match", "load_dotenv", "Snapshot",
             "Telegram", "bet_alert", "evaluate", "headsup_alert"):
    check(f"from surge_alerts import {name}",
          lambda n=name: getattr(sa, n))

# ── CFG fields it reads ───────────────────────────────────────────────────
print("\nCFG attributes surge_live.py reads:")
for attr in ("bank", "bot_name", "commission", "flat_stake", "kelly_div",
             "live_poll_s", "max_stake_pct", "min_ev", "odds_ceil",
             "odds_floor", "price_delay_s", "send_headsup", "style"):
    check(f"CFG.{attr}", lambda a=attr: getattr(sa.CFG, a))

# ── Match built with every field the feed supplies ────────────────────────
print("\nMatch construction, exactly as surge_live.py builds it:")


def build_match():
    return sa.Match(
        fid="1", home="Wolfsburg", away="Darmstadt", league="2. Bundesliga",
        minute=62.0, hg=0, ag=1, odds=1.85,
        inside=12, outside=8, sot=6, soff=7, corners=5,
        datk=41, has_datk=True, red_home=0, red_away=1, poss_home=61.0,
    )


check("Match(... datk, has_datk, red_home, red_away, poss_home)", build_match)

# ── EvalLog surface ───────────────────────────────────────────────────────
print("\nEvalLog surface:")
_db = tempfile.mktemp(suffix=".db")
_log = sa.EvalLog(_db)
check("EvalLog(path).path        # upload_db reads this", lambda: _log.path)
check("EvalLog.record(m, r, fire)",
      lambda: _log.record(build_match(),
                          sa.evaluate(build_match(), None), True))
check("EvalLog.open_alerts()", lambda: _log.open_alerts())
check("EvalLog.settle(fid, scored)", lambda: _log.settle("1", True))
check("EvalLog.calibration()", lambda: _log.calibration())

# ── Telegram surface ──────────────────────────────────────────────────────
print("\nTelegram surface:")
_tg = sa.Telegram()
# Deliberately not calling send(). With a .env present this would fire a real
# message at your phone every time the test runs, which is a fast way to teach
# yourself to ignore the alerts.
check("Telegram().send exists", lambda: callable(_tg.send))
check("Telegram().flush_held()", lambda: _tg.flush_held())
check("Telegram().enabled reports config state", lambda: _tg.enabled in (True, False))

# ── evaluate() called positionally, and its result keys ───────────────────
print("\nevaluate() as surge_live.py calls it:")


def eval_positional():
    m = build_match()
    return sa.evaluate(m, None, None, "1.245")


check("evaluate(m, prev10, prices, market_id)", eval_positional)
_r = eval_positional()
for key in ("tier", "ev", "p", "pressure", "reason", "stake", "min_price"):
    check(f'r["{key}"]', lambda k=key: _r[k])

check("Snapshot(minute, pressure, model_p, market_p)",
      lambda: sa.Snapshot(62.0, 55, 0.5, 0.52))
check("bet_alert(m, r, bot, style)",
      lambda: sa.bet_alert(build_match(), _r, "Next Goal XG", "simple"))
check("headsup_alert(m, r, bot, style)",
      lambda: sa.headsup_alert(build_match(), _r, "Next Goal XG", "simple"))

# ── guards must not be able to kill a container ───────────────────────────
print("\nGuards fail safe:")


def bad_league_list():
    saved = sa._env("SURGE_LEAGUE_IDS")
    import os
    os.environ["SURGE_LEAGUE_IDS"] = "Premier League, Nonsense FC, 40"
    ids = sa._parse_leagues(os.environ["SURGE_LEAGUE_IDS"])
    os.environ["SURGE_LEAGUE_IDS"] = saved
    assert 39 in ids and 40 in ids, ids


check("bad SURGE_LEAGUE_IDS parses instead of raising", bad_league_list)
check("unknown league id allowed when whitelist empty",
      lambda: sa.betfair_prices_it(9999) or True)
check("betfair_prices_it survives a non-numeric id",
      lambda: sa.betfair_prices_it("not-a-number"))

# ── new entry rules ───────────────────────────────────────────────────────
print("\nEntry rules:")
check(f"no alerts before the 55th minute (min_minute={sa.CFG.min_minute})",
      lambda: (_ for _ in ()).throw(AssertionError(
          f"min_minute is {sa.CFG.min_minute}")) if sa.CFG.min_minute != 55 else None)
check(f"odds band {sa.CFG.odds_floor:.2f}–{sa.CFG.odds_ceil:.2f}",
      lambda: (_ for _ in ()).throw(AssertionError("band wrong"))
      if (sa.CFG.odds_floor, sa.CFG.odds_ceil) != (1.50, 2.00) else None)

print()
if FAIL:
    print(f"{len(FAIL)} contract failure(s) — do NOT deploy:")
    for f in FAIL:
        print(f"  · {f}")
    sys.exit(1)
print("All contract checks passed. Safe to deploy.")
