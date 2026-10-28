/**
 * Claude's daily/weekly review (server/claude-review.ts). The network call itself needs a real API key and isn't
 * exercised here; this covers the forward-looking "close to its next Golden stage" watchlist, which doesn't.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { loadCustomSegments, TRIAL_FROM, watchSegment } from "../src/server/golden";
import { setCustomSegments } from "../src/server/segments";
import { getClaudeReviewFailures, getClaudeReviewNotes, goldenCloseToNextStage, requestDailyClaudeReview, setReviewClientForTest } from "../src/server/claude-review";

const alert = (n: number, result: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "2.00 1.80", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "9-9" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");

test("goldenCloseToNextStage: a candidate near its trial threshold is flagged, a long way off or past it isn't", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  loadCustomSegments(db);
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 1 }, dailyCap: 1000 });
  watchSegment(db, "Blistering Momentum", ["score00"]);
  recordSimBets(db, new Date(Date.now() - 120_000));
  // TRIAL_FROM (150) minus 5: in profit (mostly wins), so it's a candidate close to a Live trial, not "not holding up".
  const n = TRIAL_FROM - 5;
  for (let i = 1; i <= n; i++) {
    const win = i % 10 !== 0;
    const at = new Date(Date.now() - 60_000).toISOString();
    const raw = alert(i, win ? "hit" : "miss").split("\n\n⸻")[0]!;
    db.upsertLivePick("chat", i, raw, parseAlert(raw), at);
    recordSimBets(db);
    db.upsertLivePick("chat", i, alert(i, win ? "hit" : "miss"), parseAlert(alert(i, win ? "hit" : "miss")), at);
  }
  const watchlist = goldenCloseToNextStage(db, new Date());
  const mine = watchlist.find((w) => w.strategy === "Blistering Momentum");
  assert.ok(mine, "flagged: close to its next stage");
  assert.equal(mine!.nextStage, "a Live trial");
  assert.equal(mine!.picksAway, 5);

  // Nothing else manufactured is anywhere near a threshold, so the list is just this one slice.
  assert.equal(watchlist.length, 1);
});

test("goldenCloseToNextStage: nothing watched at all gives an empty list, not an error", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.deepEqual(goldenCloseToNextStage(db, new Date()), []);
});

/** A stand-in for Claude: each call returns the next of these replies. */
function fakeClaude(replies: Array<{ stop_reason: string; text?: string } | Error>) {
  let i = 0;
  return {
    calls: () => i,
    client: {
      messages: {
        create: async () => {
          const r = replies[Math.min(i++, replies.length - 1)]!;
          if (r instanceof Error) throw r;
          return { stop_reason: r.stop_reason, content: r.text ? [{ type: "text", text: r.text }] : [] };
        },
      },
    } as unknown as Parameters<typeof setReviewClientForTest>[0],
  };
}

test("daily review: a cut-off reply is tried again once, and the second, finished one is saved", async () => {
  const db = new EngineDb(":memory:", () => {});
  const fake = fakeClaude([{ stop_reason: "max_tokens", text: "Half a sen" }, { stop_reason: "end_turn", text: "A whole note." }]);
  setReviewClientForTest(fake.client);
  try {
    await requestDailyClaudeReview(db);
    assert.equal(fake.calls(), 2);
    assert.equal(getClaudeReviewNotes(db).daily?.note, "A whole note.");
    assert.equal(getClaudeReviewFailures(db).daily, undefined);
  } finally {
    setReviewClientForTest(undefined);
  }
});

test("daily review: two failures keep yesterday's note and say why on Today, until the next one works", async () => {
  const db = new EngineDb(":memory:", () => {});
  setReviewClientForTest(fakeClaude([{ stop_reason: "end_turn", text: "Yesterday's note." }]).client);
  await requestDailyClaudeReview(db, new Date("2026-10-26T21:30:00Z"));
  const fails = fakeClaude([{ stop_reason: "max_tokens", text: "Cut" }, new Error("overloaded")]);
  setReviewClientForTest(fails.client);
  try {
    await requestDailyClaudeReview(db, new Date("2026-10-27T21:30:00Z"));
    assert.equal(fails.calls(), 2, "one retry, no more");
    assert.equal(getClaudeReviewNotes(db).daily?.note, "Yesterday's note.", "never replaced by a cut-off one");
    const f = getClaudeReviewFailures(db).daily;
    assert.ok(f && /overloaded/.test(f.reason), "the last attempt's reason is kept");
    assert.equal(f!.at, "2026-10-27T21:30:00.000Z");
    setReviewClientForTest(fakeClaude([{ stop_reason: "end_turn", text: "Today's note." }]).client);
    await requestDailyClaudeReview(db, new Date("2026-10-28T21:30:00Z"));
    assert.equal(getClaudeReviewFailures(db).daily, undefined, "cleared once one works");
  } finally {
    setReviewClientForTest(undefined);
  }
});
