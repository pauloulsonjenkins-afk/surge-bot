import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { memberContext, startTrial } from "../src/members/service";
import { trackRecordView } from "../src/members/track-record";
import { whyFired } from "../src/members/why";

function alert(strategy: string, n: number, result: "hit" | "miss" | null, stats: string[] = []): string {
  const lines = [`🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 1", ...stats, "Over/Under 1.50 Odds:", "2.00 1.40"];
  if (result) lines.push("", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-1", `Full-Time Score: ${result === "hit" ? "1-1" : "0-1"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss");
  return lines.join("\n");
}

test("track record: every graded alert, winners and losers, with £1 profit; nothing about the rules", () => {
  const db = new EngineDb(":memory:", () => {});
  const stats = ["Momentum: 70 - 12", "Shots On Target: 6 - 1", "Dangerous Attacks: 55 - 14", "xG: 1.9 - 0.3"];
  const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  for (const [i, r] of (["hit", "miss", "hit"] as const).entries()) {
    const text = alert("Action-packed", i + 1, r, stats);
    db.upsertLivePick("chat", i + 1, text, parseAlert(text), at(10 - i));
  }
  const id = db.createAppUser("rec@example.com", "Rec", "x")!.id;
  const free = trackRecordView(db, memberContext(db, id)!);
  assert.equal(free.total, 3);
  assert.equal(free.rows.filter((r) => r.result === "miss").length, 1);
  const s = free.strategies[0]!;
  assert.equal(s.current.wins + (s.changed?.before.wins ?? 0), 2);
  assert.ok(free.rows.every((r) => r.profit !== null));
  // Free members see the record, but not the "why" (it's for strategies their access shows in full).
  assert.ok(free.rows.every((r) => r.why === null));
  assert.equal(startTrial(db, memberContext(db, id)!, ["action-packed"]).ok, true);
  const trial = trackRecordView(db, memberContext(db, id)!);
  const why = trial.rows[0]!.why!;
  assert.match(why, /Home 3/);
  assert.doesNotMatch(why, /\d{2}|1\.9|70/); // words, never the figures
});

test("why it fired: the stronger side, the chances and the score, in words", () => {
  const p = (stats: string[], goals = "0 - 1") => {
    const text = alert("X", 1, null, stats).replace("Goals: 0 - 1", `Goals: ${goals}`);
    const db = new EngineDb(":memory:", () => {});
    db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
    return db.listLivePicks(1)[0]!;
  };
  assert.equal(whyFired(p(["Momentum: 70 - 12", "Shots On Target: 6 - 1", "xG: 1.9 - 0.3"])), "Home 1 piling on the pressure, the chances created say a goal is overdue, and chasing the game.");
  assert.equal(whyFired(p(["Momentum: 50 - 48", "Shots On Target: 1 - 1"], "0 - 0")), "An open, end-to-end game, few clear chances so far.");
  assert.equal(whyFired(p([])), null);
});
