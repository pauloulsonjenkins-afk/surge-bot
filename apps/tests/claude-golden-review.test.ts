/**
 * Claude's per-slice Golden summary (server/claude-golden-review.ts). The network call itself needs a real API key
 * and isn't exercised here; this covers the no-key path, which is what every CI run actually exercises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { watchSegment } from "../src/server/golden";
import { claudeGoldenConfigured, getGoldenNotes, requestGoldenReviews } from "../src/server/claude-golden-review";

test("without an API key, claudeGoldenConfigured is false and requestGoldenReviews is a safe no-op", () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "this test needs no key set, or it isn't testing the no-key path");
  assert.equal(claudeGoldenConfigured(), false);
  const db = new EngineDb(":memory:", () => {});
  watchSegment(db, "Blistering Momentum", ["score00"]);
  assert.doesNotThrow(() => requestGoldenReviews(db));
  assert.deepEqual(getGoldenNotes(db), {}, "no note written without a key");
});

test("getGoldenNotes reads back whatever's stored, and nothing without a matching key", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.deepEqual(getGoldenNotes(db), {});
  db.setSetting("claude_golden_notes", JSON.stringify({ "blistering momentum#f-score00": { note: "Holding up well so far.", status: "candidate", generatedAt: "2026-10-27T21:30:00.000Z" } }));
  assert.deepEqual(getGoldenNotes(db), { "blistering momentum#f-score00": { note: "Holding up well so far.", status: "candidate", generatedAt: "2026-10-27T21:30:00.000Z" } });
});
