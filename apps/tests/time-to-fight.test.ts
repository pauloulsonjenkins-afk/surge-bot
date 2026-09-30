/** "Time to fight" is an Over next goal bet: the Over line is the goals so far plus 0.5. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

const ALERT = [
  "🔔 Time to fight",
  "",
  "🇮🇳 India Bangalore Super Division ",
  "Megt & Centre vs Kodagu FC",
  "🟥🟥🟩🟩🟩 - 🟩🟩🟩🟨🟩",
  "",
  "Timer: 64'",
  "Last Goal: Away at 60' (4 minutes ago)",
  "",
  "Goals: 3 - 2",
  "Corners: 2 - 3",
  "Momentum: 33 - 71",
  "",
  "1X2 Pre-Match Odds:",
  "3.90 4.10 1.62",
  "1X2 Live Odds:",
  "1.73 3.25 5.00",
  "Over/Under 5.50 Odds:",
  "1.30 3.40",
  "",
  "📈 Matched: £12,245",
  "",
  "🎯 Strike Rate: N/A",
].join("\n");

const settled = (ft: string) => [ALERT, "", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 1-1", `Full-Time Score: ${ft}`, "", "✅ Hit"].join("\n");

test("Time to fight is read as an Over next goal bet", () => {
  const p = parseAlert(ALERT);
  assert.equal(p.strategyRaw, "Time to fight");
  assert.equal(p.market, "NEXT_GOAL");
  assert.equal(p.targetLine, 5.5, "3 + 2 goals + 0.5, matching the Over/Under 5.50 line in the alert");
  assert.equal(p.selection, "Over 5.5");
  assert.deepEqual(p.flags, []);
  assert.equal(p.sendable, true);
});

test("it settles on the final total goals against the line", () => {
  assert.equal(parseAlert(settled("3-3")).result, "hit", "6 goals is over 5.5");
  assert.equal(parseAlert(settled("3-2")).result, "miss", "no more goals");
});

test("it is handed to the betting software as Over 5.5 goals under its own name", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "time to fight": 2 }, strategies: { "time to fight": true } });
  db.upsertLivePick("chat", 1, ALERT, parseAlert(ALERT), new Date(Date.now() - 60_000).toISOString());
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.rows[0]?.provider, "Time to fight");
  assert.equal(feed.rows[0]?.marketType, "OVER_UNDER_55");
  assert.equal(feed.rows[0]?.selectionName, "Over 5.5 Goals");
  assert.equal(feed.rows[0]?.stake, 2);
});
