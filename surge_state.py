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

Environment (all required):

    DO_SPACES_KEY       Spaces access key
    DO_SPACES_SECRET    Spaces secret key
    DO_SPACES_BUCKET    the Space's name (not the endpoint URL)
    DO_SPACES_REGION    the region you created the Space in, e.g. nyc3

Nothing here is public — objects are written with a private ACL, so only
requests signed with the access key can read them back. The API key your
HTML sends (SURGE_API_KEY) is a separate, unrelated secret; Spaces never
sees it and the browser never sees your Spaces keys.
"""

from __future__ import annotations

import json
import os
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

_STATE_KEY = "surge/state.json"
_DB_KEY = "surge/surge.db"


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
    b = os.environ.get("DO_SPACES_BUCKET", "")
    if not b:
        raise RuntimeError(
            "DO_SPACES_BUCKET is not set — surge_state.py has nowhere to "
            "write. Set it (and DO_SPACES_KEY/SECRET/REGION) as environment "
            "variables on both the Worker and the Service in App Platform."
        )
    return b


# ─────────────────────────────── live matches ───────────────────────────────


def write_state(matches: list[dict]) -> None:
    """Called by the Runner at the end of every tick()."""
    payload = json.dumps({"ts": time.time(), "matches": matches}).encode("utf-8")
    _client().put_object(
        Bucket=_bucket(), Key=_STATE_KEY, Body=payload,
        ContentType="application/json", ACL="private",
    )


def read_state() -> dict:
    """Called by the API on every /api/live request. Returns an empty
    snapshot rather than raising if nothing's been written yet (or Spaces
    is briefly unreachable) — the caller decides what "stale" means by
    checking `ts` against wall-clock time."""
    try:
        obj = _client().get_object(Bucket=_bucket(), Key=_STATE_KEY)
        return json.loads(obj["Body"].read())
    except (ClientError, Exception):
        return {"ts": 0, "matches": []}


# ────────────────────────────── calibration db ──────────────────────────────
# surge.db is SQLite, which wants a real filesystem, not an object store — so
# unlike state.json it isn't read/written directly against Spaces. Instead
# the Runner keeps writing it locally, same as always, and periodically
# uploads the whole file; the API periodically downloads a fresh copy to its
# own local disk and queries that. A few tens of seconds of lag between "a
# bet settled" and "the dashboard shows it" is the trade-off for not running
# a database server.


def upload_db(local_path: str) -> None:
    """Called periodically by the Runner (see surge_live.py's run loop)."""
    try:
        with open(local_path, "rb") as fh:
            _client().put_object(
                Bucket=_bucket(), Key=_DB_KEY, Body=fh.read(),
                ContentType="application/octet-stream", ACL="private",
            )
    except FileNotFoundError:
        pass  # nothing recorded yet — nothing to upload


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
    except (ClientError, Exception):
        return False
