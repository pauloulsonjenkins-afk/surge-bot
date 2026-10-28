/**
 * Horses → Today's bets: a day not saved yet carries the last day's amounts, but takes win or each-way from that day's
 * tips (28 Oct 2026: rank 2 was each-way one day and win the next, and the carried-over choice stayed wrong).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsFor } from "@/components/admin/views/HorsesTodayView";
import type { HorseBet, HorseSuggestion } from "@/server/engine-client";

const bet = (rank: 1 | 2 | 3 | 4, betType: "win" | "ew", ewPlaces: number | null): HorseBet => ({
  id: rank, day: "2026-10-26", rank, horse: "X", course: null, stake: 8, betType, ewFraction: 4, ewPlaces, odds: 5, oddsText: "4/1", result: "pending",
});
const tip = (rank: number, betType: "win" | "ew", ewPlaces: number | null = null): HorseSuggestion => ({
  day: "2026-10-27", rank, horse: "Y", course: null, raceTime: null, oddsText: "9/2", betType, ewPlaces, points: null, source: "tips", importedAt: "2026-10-27T13:40:00Z",
});

test("a new day takes win or each-way from its tips, keeping the carried-over stakes", () => {
  const bets = [bet(1, "win", null), bet(2, "ew", 5), bet(3, "ew", 5), bet(4, "ew", 4)];
  const rows = rowsFor(bets, "2026-10-27", [tip(1, "win"), tip(2, "win"), tip(3, "ew"), tip(4, "ew", 3)]);
  assert.equal(rows.carriedFrom, "2026-10-26");
  assert.equal(rows[2]!.betType, "win", "the tip says win, though yesterday's rank 2 was each-way");
  assert.equal(rows[2]!.stake, "8", "the amount is still carried over");
  assert.equal(rows[3]!.betType, "ew");
  assert.equal(rows[4]!.ewPlaces, "3", "the tip's places when it gives them");
  assert.equal(rows[3]!.ewPlaces, "5", "otherwise the carried-over places");
});

test("no tips yet: yesterday's choices carry over as before; a saved day is never changed by tips", () => {
  const bets = [bet(2, "ew", 5)];
  assert.equal(rowsFor(bets, "2026-10-27")[2]!.betType, "ew");
  assert.equal(rowsFor(bets, "2026-10-26", [{ ...tip(2, "win"), day: "2026-10-26" }])[2]!.betType, "ew", "saved: left as saved");
});
