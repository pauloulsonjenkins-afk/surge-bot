/** Golden's time-of-day feature (owner, 28 Nov 2026): the UK hour an alert fired, so the finder can test "16:00-22:59 UK". */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { findGolden } from "../src/server/golden";
import { extraFacts, FEATURES, setCustomSegments, ukHourOf } from "../src/server/segments";

test("the UK hour follows the clocks: GMT in winter, BST in summer", () => {
  assert.equal(ukHourOf("2026-11-28T16:30:00.000Z"), 16);
  assert.equal(ukHourOf("2026-07-01T15:30:00.000Z"), 16, "BST: an hour ahead of UTC");
  assert.equal(ukHourOf("2026-11-28T23:59:00.000Z"), 23);
  assert.equal(ukHourOf("2026-11-29T00:05:00.000Z"), 0);
  assert.equal(ukHourOf(null), null);
  assert.equal(ukHourOf("not a time"), null);
  assert.equal(extraFacts({ alertAt: "2026-11-28T18:00:00.000Z" }).ukHour, 18);
  assert.equal(extraFacts({}).ukHour, null);
});

test("16:00-22:59 UK: from 16:00 up to 22:59, and nothing when the time isn't known", () => {
  const at = (ukHour: number | null) => FEATURES.uk16to22.test({ goalsHome: 0, goalsAway: 0, stats: {}, preMatch1x2: null, live1x2: null, ukHour });
  assert.deepEqual([15, 16, 19, 22, 23, 0].map(at), [false, true, true, true, false, false]);
  assert.equal(at(null), false);
  assert.equal(FEATURES.uk16to22.group, "time");
  assert.ok(!("manual" in FEATURES.uk16to22), "the finder tries it by itself");
});

const alert = (n: number, result: "hit" | "miss" | null) =>
  [
    "🔔 Blistering Momentum", "", n % 3 === 0 ? "🇩🇪 Germany Bundesliga (3rd vs 9th)" : n % 3 === 1 ? "🇫🇷 France Ligue 1 (3rd vs 9th)" : "🇪🇸 Spain La Liga (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 50'", "Goals: 1 - 0",
    "Over/Under 1.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${result === "hit" ? "2-0" : "1-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

test("the finder can find the time of day: evening alerts that win when the afternoon ones lose", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 1 }, dailyCap: 1000 });
  const start = Date.parse("2026-11-01T00:00:00.000Z");
  recordSimBets(db, new Date(start - 120_000)); // Sim recording starts before the alerts
  // Over 20 days: an alert at 13:00 UK and one at 18:00 UK each day (and a few more), all at evens. Evening ones win 75%,
  // afternoon ones 35%.
  let n = 0;
  for (let day = 0; day < 20; day++) {
    for (const hour of [13, 13, 14, 18, 18, 19, 20, 21, 12, 15]) {
      n++;
      const at = new Date(start + day * 86_400_000 + hour * 3_600_000);
      const evening = hour >= 16;
      const win = evening ? n % 4 !== 0 : n % 20 < 7;
      db.upsertLivePick("chat", n, alert(n, null), parseAlert(alert(n, null)), at.toISOString(), at.toISOString());
      recordSimBets(db, new Date(at.getTime() + 30_000));
      db.upsertLivePick("chat", n, alert(n, win ? "hit" : "miss"), parseAlert(alert(n, win ? "hit" : "miss")), at.toISOString(), at.toISOString());
    }
  }
  const found = findGolden(db);
  assert.ok(
    found.some((g) => g.strategyKey === "blistering momentum" && g.rule.includes("uk16to22") && g.label.includes("16:00-22:59 UK")),
    JSON.stringify(found.map((g) => g.label)),
  );
});
