/**
 * Claude's per-alert second opinion (server/claude-check.ts). The network call itself needs a real API key and isn't
 * exercised here; this covers the parts that don't: reading the tool call's structured input (not re-parsing text,
 * since 27 Oct 2026 - see the file's own comment for why), and remembering the last failure for the admin page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { claudeConfigured, lastCheckFailure, parseVerdict } from "../src/server/claude-check";

test("without an API key, claudeConfigured is false", () => {
  // No ANTHROPIC_API_KEY in the test environment: the module's lazily-cached client is never built.
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "this test needs no key set, or it isn't testing the no-key path");
  assert.equal(claudeConfigured(), false);
});

test("parseVerdict reads the tool call's own structured input, not text to re-parse", () => {
  assert.deepEqual(parseVerdict({ verdict: "weaker", confidence: "high", note: "Momentum well below this strategy's usual pattern." }), {
    verdict: "weaker",
    confidence: "high",
    note: "Momentum well below this strategy's usual pattern.",
  });
  // Every field required; an unknown verdict or confidence value; a note that's missing or not a string.
  assert.equal(parseVerdict({ confidence: "high", note: "x" }), null, "no verdict");
  assert.equal(parseVerdict({ verdict: "confident", confidence: "high", note: "x" }), null, "not one of the three allowed");
  assert.equal(parseVerdict({ verdict: "weaker", confidence: "high" }), null, "no note");
  assert.equal(parseVerdict({ verdict: "weaker", confidence: "high", note: 5 }), null, "note isn't text");
  assert.equal(parseVerdict(null), null);
  assert.equal(parseVerdict("not an object"), null);
  // A very long note is trimmed to a sane length rather than rejected.
  const long = "x".repeat(900);
  assert.equal(parseVerdict({ verdict: "in_line", confidence: "low", note: long })!.note.length, 600);
});

test("the last per-alert check failure is remembered for the admin page, and cleared once one succeeds", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(lastCheckFailure(db), null, "nothing yet");
  db.setSetting("claude_check_last_failure", JSON.stringify({ reason: "couldn't get a usable verdict from its reply (stop reason: end_turn).", at: "2026-10-27T11:00:00.000Z" }));
  assert.deepEqual(lastCheckFailure(db), { reason: "couldn't get a usable verdict from its reply (stop reason: end_turn).", at: "2026-10-27T11:00:00.000Z" });
  db.setSetting("claude_check_last_failure", "null");
  assert.equal(lastCheckFailure(db), null, "cleared once a later check succeeded");
});
