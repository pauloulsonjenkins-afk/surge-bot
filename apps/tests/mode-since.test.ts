/**
 * modeSince (bet-feed.ts): when a strategy's Live/Sim switch was last flipped, and computeSinceModeReturns
 * (winloss.ts), which the Strategies page's "Own mode" headline uses instead of a mode's whole history - reported
 * 27 Oct 2026, switching a strategy to Sim immediately showed its big, mostly pre-switch Sim record as if it were
 * evidence the switch had already paid off.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { ALL_TIME, computeSinceModeReturns } from "../src/server/winloss";

const S = "Favourite pressure level";
const KEY = S.toLowerCase();

test("modeSince is recorded only when a strategy's switch actually flips", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(getSendingSettings(db).modeSince[KEY], undefined);
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true } });
  const first = getSendingSettings(db).modeSince[KEY];
  assert.ok(first, "recorded on the first switch to Live");
  // Saving something unrelated, with the switch left the same, doesn't touch it.
  saveSendingSettings(db, { stakes: { [KEY]: 2 } });
  assert.equal(getSendingSettings(db).modeSince[KEY], first, "unchanged: the switch itself didn't flip");
  // Flipping it back to Sim records a new date.
  saveSendingSettings(db, { strategies: { [KEY]: false } });
  const second = getSendingSettings(db).modeSince[KEY];
  assert.ok(second, "recorded on the flip back to Sim");
});

test("computeSinceModeReturns counts only picks from the switch date, in the current mode", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: false }, dailyCap: 1000 });
  const now = new Date();
  let id = 1;
  const alert = (n: number, result?: "hit" | "miss") =>
    [`🔔 ${S}`, "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80", ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : [])].join("\n");
  const bet = (daysAgo: number, result: "hit" | "miss") => {
    const n = id++;
    const posted = new Date(now.getTime() - daysAgo * 86_400_000 - 60_000).toISOString();
    const at = new Date(now.getTime() - daysAgo * 86_400_000);
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted, posted);
    buildFeed(db, { markSent: true, now: at });
    db.upsertLivePick("chat", n, alert(n, result), parseAlert(alert(n, result)), posted);
  };
  // A big, mostly-winning Sim record from well before the strategy was ever switched to Live.
  for (let i = 0; i < 20; i++) bet(60, i % 5 === 0 ? "miss" : "hit");
  saveSendingSettings(db, { strategies: { [KEY]: true } });
  // Backdate the recorded switch to 10 days ago (saveSendingSettings always stamps real "now", which a test can't
  // backdate; the picks below are backdated the same way everywhere else in this file).
  const backdated = new Date(now.getTime() - 10 * 86_400_000).toISOString();
  const raw = JSON.parse(db.getSetting("sending")!) as { modeSince: Record<string, string> };
  raw.modeSince[KEY] = backdated;
  db.setSetting("sending", JSON.stringify(raw));
  // Since the switch: a losing Live spell.
  for (let i = 0; i < 6; i++) bet(5, i % 3 === 0 ? "hit" : "miss");

  const rows = db.listResultsForWinLoss(ALL_TIME);
  const settings = getSendingSettings(db);
  assert.equal(settings.modeSince[KEY], backdated);
  const since = computeSinceModeReturns(db, settings.modeSince, { [KEY]: "live" }, rows);
  assert.ok(since[KEY], "has a since-switch figure for the strategy");
  assert.equal(since[KEY]!.settled, 6, "only the 6 picks since the switch, not the 20 from before it");
  assert.ok(since[KEY]!.roi !== null && since[KEY]!.roi < 0, "reflects the losing spell, not the old winning Sim record");

  // A strategy that's never been flipped (no modeSince entry at all) is left out.
  assert.equal(computeSinceModeReturns(db, {}, { [KEY]: "live" }, rows)[KEY], undefined);
});
