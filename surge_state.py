"""
surge_state.py — the shared object DigitalOcean Spaces holds so the two App
Platform components can see the same data.

App Platform gives the Worker (`surge_live.py`) and the Service
(`surge_api.py`) each their own container with their own throwaway disk —
nothing one writes to local disk is visible to the other, and either can be
redeployed or restarted at any time, wiping it. Spaces — DigitalOcean's
S3-compatible object storage — is the thing both containers can reach over
the network instead.

Needs one package beyond the standard library:

    pip install boto3

Environment (all required for storage to work):

    DO_SPACES_KEY       Spaces access key
    DO_SPACES_SECRET    Spaces secret key
    DO_SPACES_BUCKET    the Space's name (not the endpoint URL)
    DO_SPACES_REGION    the region you created the Space in, e.g. nyc3

Set them as App-Level environment variables, not on one component: the Worker
and the Service both need them, and per-component variables are a quiet way to
give one of them and forget the other.

Nothing here is public — objects are written with a private ACL, so only
requests signed with the access key can read them back. The API key your
HTML sends (SURGE_API_KEY) is a separate, unrelated secret; Spaces never
sees it and the browser never sees your Spaces keys.

── on failing soft ──────────────────────────────────────────────────────────
Every function here degrades rather than raising. That was already true of the
read paths, and it is now true of the writes too.

The asymmetry was a real outage: `upload_db` caught FileNotFoundError but not
the RuntimeError from an unset bucket, so a missing environment variable took
down the whole Worker at boot — before a single match had been polled. Losing
remote backup is bad. Losing every alert because backup is unavailable is
worse, and the bot is perfectly capable of watching football without it.

The trade-off is that a silent write failure loses data invisibly, so each one
is logged loudly the first time and counted thereafter.
"""

from __future__ import annotations

import json
import logging
import os
import time

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

log = logging.getLogger("surge.state")

_STATE_KEY = "surge/state.json"
_DB_KEY = "surge/surge.db"

# Storage errors repeat every tick. Warn in full once, then count, so a broken
# bucket is impossible to miss but does not bury the alerts in the log.
_warned: set[str] = set()
_failures: dict[str, int] = {}


def _complain(where: str, detail: str) -> None:
    _failures[where] = _failures.get(where, 0) + 1
    if where not in _warned:
        _warned.add(where)
        log.error("%s failed: %s — continuing without object storage. "
                  "Check DO_SPACES_BUCKET/KEY/SECRET/REGION are set at app "
                  "level on both components.", where, detail)
    elif _failures[where] % 50 == 0:
        log.warning("%s still failing (%d times)", where, _failures[where])


def storage_health() -> dict:
    """What has been failing, for a status endpoint or a startup check."""
    return {"configured": bool(os.environ.get("DO_SPACES_BUCKET")),
            "failures": dict(_failures)}


def _client():
    region = os.environ.get("DO_SPACES_REGION", "nyc3")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{region}.digitaloceanspaces.com",
        region_name=region,
        aws_access_key_id=os.environ.get("DO_SPACES_KEY", ""),
        aws_secret_access_key=os.environ.get("DO_SPACES_SECRET", ""),
        config=Config(signature_version="s3v4"),
    )


def _bucket() -> str:
    """The Space's name. Raises if unset — callers below turn that into a
    logged warning rather than letting it reach the process."""
    b = os.environ.get("DO_SPACES_BUCKET", "")
    if not b:
        raise RuntimeError(
            "DO_SPACES_BUCKET is not set — surge_state.py has nowhere to "
            "write. Set it (and DO_SPACES_KEY/SECRET/REGION) as environment "
            "variables on both the Worker and the Service in App Platform."
        )
    return b


# ─────────────────────────────── live matches ───────────────────────────────


def write_state(matches: list[dict]) -> bool:
    """Called by the Runner at the end of every tick().

    Returns True if it landed. A failure means the dashboard goes stale, which
    is worth knowing about and not worth stopping for.
    """
    try:
        payload = json.dumps({"ts": time.time(), "matches": matches}).encode("utf-8")
        _client().put_object(
            Bucket=_bucket(), Key=_STATE_KEY, Body=payload,
            ContentType="application/json", ACL="private",
        )
        return True
    except (RuntimeError, ClientError, BotoCoreError, OSError) as exc:
        _complain("write_state", str(exc).split("\n")[0])
        return False


def read_state() -> dict:
    """Called by the API on every /api/live request. Returns an empty
    snapshot rather than raising if nothing's been written yet (or Spaces
    is briefly unreachable) — the caller decides what "stale" means by
    checking `ts` against wall-clock time."""
    try:
        obj = _client().get_object(Bucket=_bucket(), Key=_STATE_KEY)
        return json.loads(obj["Body"].read())
    except (RuntimeError, ClientError, BotoCoreError, OSError, ValueError) as exc:
        # Logged rather than swallowed: an unset bucket and "nothing written
        # yet" produce the same empty result, and only one of them is fine.
        _complain("read_state", str(exc).split("\n")[0])
        return {"ts": 0, "matches": []}


# ────────────────────────────── calibration db ──────────────────────────────
# surge.db is SQLite, which wants a real filesystem, not an object store — so
# unlike state.json it isn't read/written directly against Spaces. Instead
# the Runner keeps writing it locally, same as always, and periodically
# uploads the whole file; the API periodically downloads a fresh copy to its
# own local disk and queries that. A few tens of seconds of lag between "a
# bet settled" and "the dashboard shows it" is the trade-off for not running
# a database server.


def upload_db(local_path: str) -> bool:
    """Called at startup and periodically by the Runner.

    Returns True if it landed. Previously this caught FileNotFoundError only,
    so an unset DO_SPACES_BUCKET raised straight through the startup call and
    killed the Worker before it polled a single match.
    """
    try:
        with open(local_path, "rb") as fh:
            _client().put_object(
                Bucket=_bucket(), Key=_DB_KEY, Body=fh.read(),
                ContentType="application/octet-stream", ACL="private",
            )
        return True
    except FileNotFoundError:
        return False  # nothing recorded yet — nothing to upload, and not an error
    except (RuntimeError, ClientError, BotoCoreError, OSError) as exc:
        _complain("upload_db", str(exc).split("\n")[0])
        return False


def download_db(local_path: str) -> bool:
    """Called periodically by the API (see surge_api.py's _ensure_db).
    Leaves whatever's already at local_path alone and returns False if the
    object isn't there yet or the fetch fails, rather than raising."""
    try:
        obj = _client().get_object(Bucket=_bucket(), Key=_DB_KEY)
        tmp = f"{local_path}.tmp"
        with open(tmp, "wb") as fh:
            fh.write(obj["Body"].read())
        os.replace(tmp, local_path)
        return True
    except (RuntimeError, ClientError, BotoCoreError, OSError) as exc:
        _complain("download_db", str(exc).split("\n")[0])
        return False
