/**
 * The finder's own (quiet) slices, since 29 Oct 2026: retired after 14 days with too few picks (or 30+ and losing),
 * never one the admin chose or bets on its own; and no more than 2 per strategy, 12 in all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { loadCustomSegments, QUIET_LIMITS, retireQuietSlices } from "../src/server/golden";
import { setCustomSegments } from "../src/server/segments";

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

test("quiet slices going nowhere are retired after 14 days; chosen, bet-on and young ones stay", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  db.setSetting(
    "custom_segments",
    JSON.stringify([
      { strategyKey: "time to fight", id: "f-score00", rule: ["score00"], since: days(20), auto: true },
      { strategyKey: "time to fight", id: "f-apart2", rule: ["apart2"], since: days(3), auto: true },
      { strategyKey: "time to fight", id: "f-min70", rule: ["min70"], since: days(20) },
      { strategyKey: "time to fight", id: "f-redcard", rule: ["redCard"], since: days(20), auto: true },
    ]),
  );
  loadCustomSegments(db);
  saveSendingSettings(db, { segmentBets: { "time to fight#f-redcard": { live: false } } });
  const retired = retireQuietSlices(db);
  assert.deepEqual(retired.map((c) => c.id), ["f-score00"], "only the old, empty, finder-added one with no betting of its own");
  assert.deepEqual(loadCustomSegments(db).map((c) => c.id).sort(), ["f-apart2", "f-min70", "f-redcard"]);
});

test("the finder's limits are 2 per strategy and 12 in all", () => {
  assert.equal(QUIET_LIMITS.perStrategy, 2);
  assert.equal(QUIET_LIMITS.total, 12);
});
