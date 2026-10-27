/**
 * Claude's own record (server/claude-track-record.ts): how its per-alert verdicts turned out once settled, and what it
 * is shown of that so it can calibrate - the owner's "feedback loop" (27 Oct 2026).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { computeVerdictTrackRecord, describeTrackRecord, trackRecord, TRACK_RECORD_MIN, type TrackRecord } from "../src/server/claude-track-record";

const row = (n: number, hitRate: number | null, roi: number | null = null) => ({ n, hits: hitRate === null ? 0 : Math.round((n * hitRate) / 100), hitRate, counted: n, roi });
const none = row(0, null);

const rec = (overall: TrackRecord["overall"], byStrategy: TrackRecord["byStrategy"] = {}): TrackRecord => ({ overall, settledCount: 0, byStrategy });

test("an empty database has an empty record, and Claude is shown nothing", () => {
  const db = new EngineDb(":memory:", () => {});
  const r = computeVerdictTrackRecord(db);
  assert.equal(r.settledCount, 0);
  assert.equal(r.overall.weaker.n, 0);
  assert.equal(describeTrackRecord(r, "blistering momentum"), null);
  assert.equal(trackRecord(db).settledCount, 0, "the cached read agrees");
});

test("a verdict with too few settled picks behind it is left out", () => {
  const r = rec({ stronger: row(TRACK_RECORD_MIN - 1, 80), in_line: none, weaker: none });
  assert.equal(describeTrackRecord(r, null), null);
});

test("verdicts that haven't separated winners from losers are called out as such", () => {
  const r = rec({ stronger: row(40, 61, 0.02), in_line: row(60, 60, 0.01), weaker: row(30, 60, 0.0) });
  const d = describeTrackRecord(r, null) as { acrossAllStrategies: { separation: string } };
  assert.match(d.acrossAllStrategies.separation, /aren't telling winners from losers/);
});

test("verdicts pointing the wrong way, and ones that help, are each named", () => {
  const wrong = describeTrackRecord(rec({ stronger: row(40, 50), in_line: none, weaker: row(40, 70) }), null) as { acrossAllStrategies: { separation: string } };
  assert.match(wrong.acrossAllStrategies.separation, /wrong way/);
  const good = describeTrackRecord(rec({ stronger: row(40, 75), in_line: none, weaker: row(40, 50) }), null) as { acrossAllStrategies: { separation: string } };
  assert.match(good.acrossAllStrategies.separation, /are helping/);
});

test("this strategy's own record is shown when it has enough, alongside the overall one", () => {
  const mine = { stronger: row(12, 50), in_line: none, weaker: row(15, 80) };
  const d = describeTrackRecord(rec({ stronger: row(40, 60), in_line: none, weaker: row(40, 60) }, { "blistering momentum": mine }), "blistering momentum") as {
    acrossAllStrategies: unknown;
    onThisStrategy: { separation: string };
  };
  assert.ok(d.acrossAllStrategies);
  assert.match(d.onThisStrategy.separation, /wrong way/);
  const other = describeTrackRecord(rec({ stronger: row(40, 60), in_line: none, weaker: row(40, 60) }, { "blistering momentum": mine }), "some other strategy") as { onThisStrategy: unknown };
  assert.equal(other.onThisStrategy, null, "a strategy with no record of its own gets only the overall figures");
});
