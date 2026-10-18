/**
 * Slices watched on a strategy's card (server/segments.ts): Second Pour's "Golden" alerts (0-0, or the favourite with
 * twice the opponent's dangerous attacks) against the rest. Nothing is bet differently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { computeStrategyReturns } from "../src/server/winloss";
import { SEGMENTS } from "../src/server/segments";

const alert = (n: number, goals: string, da: string, ft: string) =>
  [
    "🔔 Favourite pressure 2nd half",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 62'",
    `Goals: ${goals}`,
    `Dangerous Attacks: ${da}`,
    "",
    "1X2 Pre-Match Odds:",
    "1.60 4.00 5.50",
    "Over/Under 0.50 Odds:",
    "1.50 2.50",
    "",
    "⸻⸻ Match Summary ⸻⸻",
    "Half-Time Score: 0-0",
    `Full-Time Score: ${ft}`,
    "",
    "✅ Hit",
  ].join("\n");

test("the Golden test: 0-0, or the pre-match favourite with 2x the dangerous attacks", () => {
  const golden = SEGMENTS["favourite pressure 2nd half"]![0]!.test;
  const f = (gh: number, ga: number, da: [number, number], pre: [number, number, number] = [1.6, 4, 5.5]) => ({ goalsHome: gh, goalsAway: ga, stats: { "Dangerous Attacks": da }, preMatch1x2: pre, live1x2: null });
  assert.equal(golden(f(0, 0, [10, 30])), true, "0-0 counts whatever the attacks");
  assert.equal(golden(f(1, 1, [40, 20])), true, "home favourite with double");
  assert.equal(golden(f(1, 1, [30, 20])), false);
  assert.equal(golden(f(1, 1, [20, 40], [5.5, 4, 1.6])), true, "away favourite with double");
});

test("Second Pour's card gets the Golden slice and the rest, from the alerts' own stats", () => {
  const db = new EngineDb(":memory:", () => {});
  const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
  SEGMENTS["favourite pressure 2nd half"]![0]!.since = "1970-01-01T00:00:00.000Z"; // the clock-independent case
  db.upsertLivePick("chat", 1, alert(1, "0 - 0", "20 - 25", "1-0"), parseAlert(alert(1, "0 - 0", "20 - 25", "1-0")), at);
  db.upsertLivePick("chat", 2, alert(2, "1 - 1", "30 - 25", "2-1"), parseAlert(alert(2, "1 - 1", "30 - 25", "2-1")), at);
  db.upsertLivePick("chat", 3, alert(3, "1 - 1", "50 - 20", "2-1"), parseAlert(alert(3, "1 - 1", "50 - 20", "2-1")), at);
  const r = computeStrategyReturns(db)["favourite pressure 2nd half"]!;
  const seg = r.segments?.find((s) => s.id === "golden");
  assert.ok(seg, "watched");
  assert.equal(seg!.in.all.settled, 2);
  assert.equal(seg!.out.all.settled, 1);
  SEGMENTS["favourite pressure 2nd half"]![0]!.since = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(computeStrategyReturns(db)["favourite pressure 2nd half"]!.segments, undefined, "picks before its start don't count");
});
