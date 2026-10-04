/**
 * The Settings page's "Download every pick": one row per pick, with its stats, prices, result and money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { picksExportCsv } from "../src/server/picks-export";

function alert(home: string, away: string, result: "hit" | "miss" | null): string {
  return [
    "🔔 Blistering Momentum",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `${home} vs ${away}`,
    "",
    "Timer: 60'",
    "Goals: 1 - 0",
    "Momentum: 120 - 40",
    "Shots On Target: 6 - 1",
    "Over/Under 1.50 Odds:",
    "1.80 2.00",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 1-0", `Full-Time Score: ${result === "hit" ? "2-0" : "1-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");
}

function rowsOf(csv: string): Array<Record<string, string>> {
  const [header, ...lines] = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  const cols = header!.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i]!, v])));
}

test("every pick is a row, with stats, Live or Sim, result and profit priced as the app prices it", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 2 }, strategies: { "blistering momentum": true } });
  const at = new Date().toISOString();
  db.upsertLivePick("chat", 1, alert("Lyon", "Nice", null), parseAlert(alert("Lyon", "Nice", null)), at);
  buildFeed(db, { markSent: true });
  // The alert is edited with its result, as Telegram does at full time.
  db.upsertLivePick("chat", 1, alert("Lyon", "Nice", "hit"), parseAlert(alert("Lyon", "Nice", "hit")), at);
  db.upsertLivePick("chat", 2, alert("Lens", "Brest", "miss"), parseAlert(alert("Lens", "Brest", "miss")), at);

  const rows = rowsOf(picksExportCsv(db));
  assert.equal(rows.length, 2);
  const [a, b] = rows;
  assert.equal(a!["Strategy (InPlayGuru)"], "Blistering Momentum");
  assert.equal(a!["Mode"], "Live");
  assert.equal(a!["Momentum home"], "120");
  assert.equal(a!["Shots On Target away"], "1");
  assert.equal(a!["Result"], "hit");
  assert.equal(a!["Goals after alert"], "1");
  assert.equal(a!["Weekday"].length, 3);
  assert.equal(b!["Mode"], "Sim");
  assert.equal(b!["Result"], "miss");
});
