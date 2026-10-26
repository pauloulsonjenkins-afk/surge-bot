/**
 * LAY badges (server/lay-badges.ts): a LAY group proves itself the same way Golden does, from its own settled picks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { LAY_CHAT, LAY_GROUPS, layText } from "../src/inplayguru/lay-groups";
import { layGroupRecords, monitorLayBadges } from "../src/server/lay-badges";

const group = LAY_GROUPS[1]!; // "LAY next goal · Wake-up Call 1 goal apart"
const header = group.header.toLowerCase();

const alert = (n: number, result: "hit" | "miss") =>
  [
    "🔔 Time to fight", "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.70 2.10", "",
    "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${result === "hit" ? "1-0" : "2-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");

function addPicks(db: EngineDb, results: Array<"hit" | "miss">, fromSecsAgo: number, startId: number): void {
  const T = Date.now();
  results.forEach((r, i) => {
    const id = startId + i;
    const at = new Date(T - (fromSecsAgo - i) * 1000).toISOString();
    const text = layText(alert(id, r), group);
    db.upsertLivePick(LAY_CHAT, id, text, parseAlert(text), at, at);
  });
}

test("a LAY group is a candidate under 50 picks, proved at 50+ winning in both halves, and shown with a badge", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { [header]: 1 }, dailyCap: 1000 });
  addPicks(db, Array.from({ length: 20 }, (_, i) => (i % 3 === 2 ? "miss" : "hit")), 900, 1);
  assert.equal(layGroupRecords(db).find((r) => r.key === header)!.status, "candidate");

  addPicks(db, Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? "miss" : "hit")), 600, 21);
  const rec = layGroupRecords(db).find((r) => r.key === header)!;
  assert.equal(rec.n, 50);
  assert.equal(rec.status, "proved");
  assert.ok(rec.halves[0]! >= 0.03 && rec.halves[1]! >= 0.03, "beats the rule in both halves");
});

test("notifies once when proved, and once when it loses the badge on a bad last 30", async () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { [header]: 1 }, dailyCap: 1000 });
  addPicks(db, Array.from({ length: 50 }, (_, i) => (i % 3 === 2 ? "miss" : "hit")), 900, 1);
  await monitorLayBadges(db, new Date(Date.now() - 700_000)); // first run: records it, says nothing
  assert.equal(layGroupRecords(db).find((r) => r.key === header)!.status, "proved");

  // The next 30 lose badly: the badge goes even though the group is still up overall.
  addPicks(db, Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? "hit" : "miss")), 600, 51);
  const lost = layGroupRecords(db).find((r) => r.key === header)!;
  assert.equal(lost.status, "not holding up");
  assert.match(lost.why!, /last 30 picks/);
});
