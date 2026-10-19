/**
 * "Matched odds home" (19 Oct 2026): the home team to win, Match Odds. Priced from the alert's live home price,
 * graded from the final score (a draw loses), and sent as Match Odds on the home team.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

const alert = (ft?: string) =>
  [
    "🔔 Matched odds home", "", "🏴 England Premier League (5th vs 12th)", "Tottenham vs Coventry", "", "Timer: 10'", "Goals: 0 - 0",
    "1X2 Live Odds:", "1.80 3.60 4.50",
    ...(ft ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${ft}`, "", "✅ Hit"] : []),
  ].join("\n");

test("it's the home team to win, with no 'not in the strategy table' flag", () => {
  const p = parseAlert(alert());
  assert.equal(p.market, "HOME_TO_WIN");
  assert.equal(p.selection, "Home to win");
  assert.ok(!p.flags.some((f) => /strategy table/.test(f)));
});

test("graded from the final score: a home win hits, a draw or away win misses", () => {
  assert.equal(parseAlert(alert("2-1")).result, "hit");
  assert.equal(parseAlert(alert("1-1")).result, "miss");
  assert.equal(parseAlert(alert("0-1")).result, "miss");
});

test("priced at the alert's live home price, and sent as Match Odds on the home team when Live", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "matched odds home": 1 }, strategies: { "matched odds home": true } });
  db.upsertLivePick("chat", 1, alert(), parseAlert(alert()), new Date(Date.now() - 60_000).toISOString());
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows[0]?.marketType, "MATCH_ODDS");
  assert.equal(feed.rows[0]?.selectionName, "Tottenham");
  db.upsertLivePick("chat", 1, alert("2-0"), parseAlert(alert("2-0")), new Date(Date.now() - 60_000).toISOString());
  const r = db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")[0]!;
  assert.equal(r.favouriteOdds, 1.8);
});
