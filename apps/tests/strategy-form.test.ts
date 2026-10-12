import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { computeStrategyForm } from "../src/server/winloss";

function alert(n: number, hit: boolean): string {
  return [
    "🔔 Late goal hunter", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80",
    "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${hit ? "1-0" : "0-0"}`, "", hit ? "✅ Hit" : "❌ Miss",
  ].join("\n");
}

test("form: the last 20 picks and the last 7 days, each with the window before and the current run", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  // 30 picks over 15 days: the older ones all lost, the last 10 days won except every third.
  for (let i = 0; i < 30; i++) {
    const at = new Date(now.getTime() - (15 - i * 0.5) * 86_400_000 + 60_000);
    const hit = i >= 10 && i % 3 !== 0;
    db.upsertLivePick("c", i + 1, alert(i, hit), parseAlert(alert(i, hit)), at.toISOString(), at.toISOString());
  }
  const f = computeStrategyForm(db, now)["late goal hunter"]!;
  assert.equal(f.recent.all.settled, 20);
  assert.equal(f.recent.before.settled, 10);
  assert.equal(f.recent.before.hits, 0);
  assert.ok((f.recent.all.hits ?? 0) > 10);
  assert.ok(f.week.all.settled >= 13 && f.week.all.settled <= 15);
  assert.ok(f.week.before.settled >= 13);
  assert.ok(f.recent.streak && f.recent.streak.n >= 1);
});

test("a strategy whose rules changed: the week before the change against everything since", async () => {
  const { RECORD_FROM } = await import("../src/storage/engine-db");
  const db = new EngineDb(":memory:", () => {});
  const from = Date.parse(RECORD_FROM["late goal hunter"] = new Date(Date.now() - 2 * 86_400_000).toISOString());
  try {
    for (let i = 0; i < 12; i++) {
      const at = new Date(from + (i < 6 ? -(i + 1) * 3_600_000 : (i - 5) * 3_600_000));
      const hit = i >= 6 || i === 0;
      db.upsertLivePick("c", i + 1, alert(i, hit), parseAlert(alert(i, hit)), at.toISOString(), at.toISOString());
    }
    const c = computeStrategyForm(db)["late goal hunter"]!.change!;
    assert.equal(c.before.all.settled, 6);
    assert.equal(c.before.all.hits, 1);
    assert.equal(c.after.all.settled, 6);
    assert.equal(c.after.all.hits, 6);
  } finally {
    delete RECORD_FROM["late goal hunter"];
  }
});
