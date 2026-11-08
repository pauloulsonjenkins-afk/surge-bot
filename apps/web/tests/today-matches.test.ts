/** The counts at the top of Live: in play now, still to play today, from the Schedule's kick-off times. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { countTodayMatches, IN_PLAY_MS } from "../src/lib/today-matches";

const now = Date.parse("2026-11-08T15:30:00Z");
const at = (minsFromNow: number, status = "NS") => ({ kickoff: new Date(now + minsFromNow * 60_000).toISOString(), status });

test("in play by the clock, still to play from the kick-off time, postponed and finished games left out", () => {
  const c = countTodayMatches([at(-30), at(-100), at(-(IN_PLAY_MS / 60_000) - 5), at(-20, "FT"), at(15), at(90), at(60, "PST"), at(-10, "CANC")], now);
  assert.equal(c.inPlay, 2, "30 and 100 minutes in; not the one long over, the finished one or the cancelled one");
  assert.equal(c.toPlay, 2, "15 and 90 minutes away; not the postponed one");
  assert.equal(c.nextKickoff, new Date(now + 15 * 60_000).toISOString());
});

test("an empty day", () => {
  assert.deepEqual(countTodayMatches([], now), { inPlay: 0, toPlay: 0, nextKickoff: null });
});
