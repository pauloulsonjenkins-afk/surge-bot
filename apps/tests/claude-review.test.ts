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
import { goldenCloseToNextStage } from "../src/server/claude-review";

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
