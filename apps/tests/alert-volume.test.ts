/**
 * Alert-volume anomaly check (server/today.ts): "0 alerts in the last hour" showed on Today with nothing flagging it
 * (28 Oct 2026) - telegramHealth only checks the connection is open, not that alerts are actually arriving at a
 * normal rate. This compares the last hour against the same hour of day over the last 7 days.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { alertVolumeAnomaly } from "../src/server/today";

const alert = (n: number) => ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");

test("a busy hour, quiet now: flagged low", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  let id = 1;
  // The same hour of day, each of the last 7 days: 8 alerts a day, a steady busy hour. +1 so none lands exactly on
  // the window's own boundary (that end is exclusive).
  for (let d = 1; d <= 7; d++) {
    for (let i = 1; i <= 8; i++) {
      const at = new Date(now.getTime() - d * 86_400_000 - i * 5 * 60_000).toISOString();
      db.upsertLivePick("chat", id++, alert(id), parseAlert(alert(id)), at, at);
    }
  }
  const v = alertVolumeAnomaly(db, now, 0);
  assert.ok(v);
  assert.equal(v!.lastHour, 0);
  assert.equal(v!.typical, 8);
  assert.equal(v!.low, true);
});

test("a naturally quiet hour (few alerts normally) isn't flagged just for staying quiet", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  let id = 1;
  // Only 1-2 alerts in this hour on a normal day: too quiet to judge by.
  for (let d = 1; d <= 7; d++) {
    const at = new Date(now.getTime() - d * 86_400_000 - 10 * 60_000).toISOString();
    db.upsertLivePick("chat", id++, alert(id), parseAlert(alert(id)), at, at);
  }
  const v = alertVolumeAnomaly(db, now, 0);
  assert.equal(v!.low, false, "typical itself is too quiet to mean anything");
});

test("a busy hour that's still roughly busy now isn't flagged", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  let id = 1;
  for (let d = 1; d <= 7; d++) {
    for (let i = 1; i <= 8; i++) {
      const at = new Date(now.getTime() - d * 86_400_000 - i * 5 * 60_000).toISOString();
      db.upsertLivePick("chat", id++, alert(id), parseAlert(alert(id)), at, at);
    }
  }
  const v = alertVolumeAnomaly(db, now, 6); // close to the usual 8
  assert.equal(v!.low, false);
});

test("one freak quiet day among seven busy ones doesn't skew the typical figure", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  let id = 1;
  for (let d = 1; d <= 7; d++) {
    const n = d === 4 ? 0 : 8; // one oddly quiet day
    for (let i = 1; i <= n; i++) {
      const at = new Date(now.getTime() - d * 86_400_000 - i * 5 * 60_000).toISOString();
      db.upsertLivePick("chat", id++, alert(id), parseAlert(alert(id)), at, at);
    }
  }
  const v = alertVolumeAnomaly(db, now, 0);
  assert.equal(v!.typical, 8, "the median of 6 busy days and 1 quiet one is still a busy day");
  assert.equal(v!.low, true);
});
