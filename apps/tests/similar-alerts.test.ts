/**
 * "Similar alerts" on the admin's Live tab (server/similar-alerts.ts): the same strategy, minute band and price band,
 * over the last 30 days. Information only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { SIMILAR_MIN, similarAlertsFor, similarKey } from "../src/server/similar-alerts";

const alert = (n: number, minute: number, over: string, result?: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", `Timer: ${minute}'`, "Goals: 1 - 0",
    "Over/Under 1.50 Odds:", `${over} 2.00`,
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${result === "hit" ? "3-0" : "1-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

const add = (db: EngineDb, n: number, minute: number, over: string, result?: "hit" | "miss") => {
  const at = new Date(Date.now() - 3600_000).toISOString();
  const text = alert(n, minute, over, result);
  db.upsertLivePick("chat", n, text, parseAlert(text), at);
  return db.getLivePickByMessage("chat", n)!;
};

test("the band key: same strategy, minute band and price band", () => {
  assert.equal(similarKey("Blistering Momentum", 62, 1.5), similarKey("blistering momentum", 68, 1.55), "60-69' and 1.45-1.59 either way");
  assert.notEqual(similarKey("Blistering Momentum", 62, 1.5), similarKey("Blistering Momentum", 72, 1.5), "another minute band");
  assert.notEqual(similarKey("Blistering Momentum", 62, 1.5), similarKey("Blistering Momentum", 62, 1.7), "another price band");
  assert.match(similarKey("First Half Goal", null, 1.4), /\|pre\|/, "pre-match alerts have their own band");
});

test("a live alert is summarised by settled alerts like it, and only those", () => {
  const db = new EngineDb(":memory:", () => {});
  // 12 similar (61-69', over 1.55): 9 won, 3 lost. Plus 12 in another minute band that must not count.
  for (let i = 1; i <= 12; i++) add(db, i, 62 + (i % 5), "1.55", i <= 9 ? "hit" : "miss");
  for (let i = 101; i <= 112; i++) add(db, i, 75, "1.55", "miss");
  const live = add(db, 500, 66, "1.55");
  const s = similarAlertsFor(db, live);
  assert.ok(s);
  assert.equal(s!.n, 12, "only the same minute band and price band");
  assert.equal(s!.wonPct, 75);
  assert.ok(s!.roiPct !== null && s!.roiPct > 0, "9 wins at 1.55 outweigh 3 losses");
  assert.equal(s!.days, 30);
});

test("under 10 similar alerts: no figures, just how many", () => {
  const db = new EngineDb(":memory:", () => {});
  for (let i = 1; i < SIMILAR_MIN; i++) add(db, i, 62, "1.55", "hit");
  const s = similarAlertsFor(db, add(db, 500, 66, "1.55"));
  assert.deepEqual(s, { n: SIMILAR_MIN - 1, wonPct: null, roiPct: null, days: 30 });
});

test("a settled alert gets no line", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(similarAlertsFor(db, add(db, 1, 62, "1.55", "hit")), null);
});
