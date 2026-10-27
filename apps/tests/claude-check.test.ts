/**
 * Claude's per-alert second opinion (server/claude-check.ts). The network call itself needs a real API key and isn't
 * exercised here; this covers the parts that don't: reading the tool call's structured input (not re-parsing text,
 * since 27 Oct 2026 - see the file's own comment for why), and remembering the last failure for the admin page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildAlertContext, claudeConfigured, lastCheckFailure, parseVerdict, truncateNote } from "../src/server/claude-check";

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
  // A genuinely runaway note is trimmed rather than rejected, on a word boundary (truncateNote below) - the normal
  // case is a short note that fits well inside the limit and goes through untouched.
  const long = "x".repeat(2500);
  assert.ok(parseVerdict({ verdict: "in_line", confidence: "low", note: long })!.note.endsWith("…"));
});

test("truncateNote never stops mid-word: a real note was once hard-cut to 'Recent strat' (27 Oct 2026, seen on the Live tab)", () => {
  const short = "Momentum favours the home side.";
  assert.equal(truncateNote(short), short, "well under the limit: untouched");
  // "word " is 5 chars; a 103-char cutoff lands mid-word ("...word wo|rd...") unless it backs up to the space.
  const long = `${"word ".repeat(200)}tail`;
  const cut = truncateNote(long, 103);
  assert.equal(cut, `${"word ".repeat(19)}word…`, "backs up to the last whole word before the mark, never a partial one");
  // No space the whole way through the cut: nothing to back up to, so it marks the hard cut rather than return nothing.
  assert.ok(truncateNote("x".repeat(200), 100).endsWith("…"));
});

test("buildAlertContext carries head-to-head alongside everything else, and never throws with no league history loaded", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", "Lens vs Lille", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const pick = db.getLivePickByMessage("chat", 1)!;
  const context = buildAlertContext(db, pick, new Date());
  assert.ok("recentFormAndHeadToHead" in context, "the field is always present, even when null");
  assert.ok("leagueTablePosition" in context, "the field is always present, even when null");
  // No league history file is downloaded in a test run, so both are null here; edge.test.ts and
  // football-data.test.ts exercise edgeCard's and tablePositions' own logic directly with synthetic match rows.
  assert.equal(context.recentFormAndHeadToHead, null);
  assert.equal(context.leagueTablePosition, null);
});

test("the last per-alert check failure is remembered for the admin page, and cleared once one succeeds", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(lastCheckFailure(db), null, "nothing yet");
  db.setSetting("claude_check_last_failure", JSON.stringify({ reason: "couldn't get a usable verdict from its reply (stop reason: end_turn).", at: "2026-10-27T11:00:00.000Z" }));
  assert.deepEqual(lastCheckFailure(db), { reason: "couldn't get a usable verdict from its reply (stop reason: end_turn).", at: "2026-10-27T11:00:00.000Z" });
  db.setSetting("claude_check_last_failure", "null");
  assert.equal(lastCheckFailure(db), null, "cleared once a later check succeeded");
});
