"""
surge_api.py — the only thing the HTML is ever allowed to talk to.

Deployed on DigitalOcean App Platform as a **Service** (has a public URL),
separate from the **Worker** that runs `surge_live.py`'s Runner (background
only, no URL). The two share nothing but DigitalOcean Spaces —
`state.json` and a periodic copy of `surge.db`, both written by the Worker
via surge_state.py. This process holds no Sportmonks, Betfair or Telegram
credential — only the Spaces keys needed to read what the Worker wrote, and
its own SURGE_API_KEY.

    pip install flask boto3
    export SURGE_API_KEY=<pick something long and random>
    export DO_SPACES_KEY=... DO_SPACES_SECRET=... DO_SPACES_BUCKET=... DO_SPACES_REGION=...
    flask --app surge_api run          # local test, http://127.0.0.1:5000

On App Platform this runs under gunicorn — see the run_command in
GOING_LIVE.md / app.yaml. It listens on $PORT, which App Platform sets
itself; nothing here needs to read that variable directly.

Every route below requires the key, sent as either header
`X-API-Key: <key>` or query string `?key=<key>`, matched against
SURGE_API_KEY. Leaving that variable unset disables the check — fine while
testing on localhost, never on a public App Platform URL.

Routes: /api/live (current matches), /api/alerts (recent evaluations),
/api/trades (fired + settled alerts, for the dashboard), /api/calibration
(bucketed accuracy), /api/health (no key needed).
"""

from __future__ import annotations

import os
import sqlite3
import time

from flask import Flask, abort, jsonify, request

from surge_alerts import CFG
from surge_state import download_db, read_state

API_KEY = os.environ.get("SURGE_API_KEY", "")
# Spaces holds the durable copy; this is just where the Service keeps its
# own local, disposable copy between downloads. /tmp is fine — App
# Platform's local disk is ephemeral anyway, which is the whole reason
# surge.db lives in Spaces and not here.
DB_LOCAL = os.environ.get("SURGE_DB_LOCAL", "/tmp/surge.db")
DB_TTL_S = int(os.environ.get("SURGE_DB_TTL", "30"))

app = Flask(__name__)
_last_db_refresh = 0.0


def _authed() -> bool:
    if not API_KEY:
        return True
    got = request.headers.get("X-API-Key", "") or request.args.get("key", "")
    return got == API_KEY


def _ensure_db() -> bool:
    """Refreshes the local copy of surge.db from Spaces at most once every
    DB_TTL_S seconds — no point re-downloading it on every single request
    when the Worker itself only re-uploads every 5 minutes. Returns True if
    a usable local copy exists (fresh or merely not-yet-expired)."""
    global _last_db_refresh
    now = time.time()
    if now - _last_db_refresh > DB_TTL_S or not os.path.exists(DB_LOCAL):
        if download_db(DB_LOCAL):
            _last_db_refresh = now
    return os.path.exists(DB_LOCAL)


def _db_query(sql: str, params: tuple = ()) -> list[dict]:
    if not _ensure_db():
        return []
    # Read-only URI connection: this file gets overwritten wholesale by
    # _ensure_db() from underneath any open connection, so nothing here
    # should hold one open longer than a single request.
    con = sqlite3.connect(f"file:{DB_LOCAL}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(sql, params).fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


@app.after_request
def _cors(resp):
    # The HTML is a local file or lives on a different origin to this API,
    # so the browser needs this to allow the fetch() at all. Read-only GET
    # endpoints behind a shared key — no cookies, nothing to protect by
    # restricting the origin instead.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "X-API-Key, Content-Type"
    return resp


@app.route("/api/live")
def live():
    """Every currently-tracked fixture with a live price, exactly as the
    Runner last evaluated it. `ts` (unix seconds) tells the caller how
    stale this is — age near zero means the poller is alive; age growing
    past a couple of poll periods means it has stalled, crashed, or is
    mid-redeploy."""
    if not _authed():
        abort(401)
    return jsonify(read_state())


@app.route("/api/alerts")
def alerts():
    """Recent rows from the calibration log, newest first — every
    evaluation, not just the ones that fired, so WATCH and HOLD traffic is
    visible too. Lags the Worker by up to DB_TTL_S seconds and up to the
    Worker's own 5-minute upload cycle — see surge_state.py."""
    if not _authed():
        abort(401)
    try:
        limit = min(200, max(1, int(request.args.get("limit", 50))))
    except ValueError:
        limit = 50
    rows = _db_query(
        "SELECT ts, fixture_id, league, home, away, minute, score, model_p, "
        "market_odds, edge, tier, alerted, outcome FROM evaluations "
        "ORDER BY id DESC LIMIT ?", (limit,),
    )
    return jsonify(rows)


@app.route("/api/trades")
def trades():
    """Every alert that actually fired and has since settled. No record of
    what you were actually matched at or whether you got on at all (that's
    `FILLS`, tracked client-side in the HTML, per device) — this assumes a
    flat stake at the quoted price every time. CFG.flat_stake and
    CFG.commission are returned alongside so the HTML prices it the same
    way the bot did."""
    if not _authed():
        abort(401)
    try:
        limit = min(2000, max(1, int(request.args.get("limit", 1000))))
    except ValueError:
        limit = 1000
    rows = _db_query(
        "SELECT ts, fixture_id, league, home, away, minute, score, model_p, "
        "market_odds, edge, outcome FROM evaluations "
        "WHERE alerted = 1 AND outcome IS NOT NULL "
        "ORDER BY id DESC LIMIT ?", (limit,),
    )
    return jsonify({
        "trades": rows,
        "flat_stake": CFG.flat_stake,
        "bank": CFG.bank,
        "max_stake_pct": CFG.max_stake_pct,
        "kelly_div": CFG.kelly_div,
        "commission": CFG.commission,
        "bot_name": CFG.bot_name,
    })


@app.route("/api/calibration")
def calibration():
    """Bucketed model_p vs observed outcome — the one screen that answers
    whether the model works, per SETUP.md Step 6. Empty buckets just mean
    fewer than one settled alert has landed in that probability band yet.
    Reimplements EvalLog.calibration()'s bucketing here (rather than
    importing EvalLog) so this process never holds a long-lived connection
    to a file that gets swapped out from under it every DB_TTL_S
    seconds — see _db_query()."""
    if not _authed():
        abort(401)
    rows = _db_query(
        "SELECT model_p, outcome FROM evaluations "
        "WHERE alerted = 1 AND outcome IN ('W','L')"
    )
    buckets = 10
    out = []
    for i in range(buckets):
        lo, hi = i / buckets, (i + 1) / buckets
        hits = [r for r in rows if lo <= r["model_p"] < hi]
        if not hits:
            continue
        out.append({
            "bucket": f"{lo:.0%}\u2013{hi:.0%}", "n": len(hits),
            "predicted": (lo + hi) / 2,
            "observed": sum(1 for r in hits if r["outcome"] == "W") / len(hits),
        })
    return jsonify(out)


@app.route("/api/health")
def health():
    """No key required — lets the HTML tell "wrong URL" apart from "wrong
    key" without exposing anything. Also reports whether the Spaces
    environment variables are even set, which is otherwise easy to
    mistake for a poller problem."""
    missing = [k for k in ("DO_SPACES_KEY", "DO_SPACES_SECRET",
                            "DO_SPACES_BUCKET", "DO_SPACES_REGION")
               if not os.environ.get(k)]
    return jsonify({"ok": True, "spaces_configured": not missing, "missing_env": missing})


if __name__ == "__main__":
    app.run(port=5000, debug=False)
