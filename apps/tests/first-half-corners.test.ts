/**
 * First Half Corner Race: one more corner before half-time, i.e. first-half corners Over (corners so far + 0.5).
 * Checks the line, the bet the feed sends once its Betfair market code is set, and finding the market by name to price it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, feedMarket, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { firstHalfCornersRunner } from "../src/betfair/exchange";

const S = "⚡First Half Corner Race";

function alert(n: number, corners: string, timer = "28'"): string {
  return [
    `🔔 ${S}`,
    "",
    "🇩🇪 Germany Bundesliga",
    `Wolfsburg${n} vs Havelse${n}`,
    "🟩🟩🟨🟥🟩 - 🟩🟥🟨🟥🟥",
    "",
    `Timer: ${timer}`,
    "Last Goal: None",
    "",
    "Goals: 2 - 0",
    `Corners: ${corners}`,
    "Momentum: 38 - 36",
  ].join("\n");
}

test("the line is the corners so far + 0.5, so one more corner before half-time wins", () => {
  const p = parseAlert(alert(1, "1 - 4"));
  assert.equal(p.market, "FIRST_HALF_CORNERS");
  assert.equal(p.targetLine, 5.5);
  assert.equal(p.selection, "Over 5.5 first-half corners");
  assert.equal(parseAlert(alert(1, "0 - 2")).targetLine, 2.5);
  // No corner count, no line.
  const none = parseAlert(alert(1, "1 - 4").replace(/Corners: .*\n/, ""));
  assert.equal(none.targetLine, null);
  assert.ok(none.flags.some((f) => /Corners line/.test(f)));
});

test("not sent until the Betfair market code is set; then the code and selection carry the line", () => {
  const db = new EngineDb(":memory:", () => {});
  const key = "first half corner race";
  saveSendingSettings(db, { enabled: true, stakes: { [key]: 2 }, strategies: { [key]: true }, dailyCap: 100 });
  const now = new Date();
  const text = alert(1, "1 - 4");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date(now.getTime() - 60_000).toISOString());

  let feed = buildFeed(db, { markSent: false, now });
  assert.equal(feed.rows.length, 0);
  assert.match(feed.skipped[0]!.reason, /corners market code/);

  saveSendingSettings(db, { firstHalfCornersMarketType: "FIRST_HALF_CORNERS_{line10}", firstHalfCornersSelection: "Over {line} Corners" });
  const pick = db.listLivePicks(5)[0]!;
  assert.deepEqual(feedMarket(pick, getSendingSettings(db), (n) => n), { marketType: "FIRST_HALF_CORNERS_55", selectionName: "Over 5.5 Corners" });
  feed = buildFeed(db, { markSent: false, now });
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.rows[0]!.selectionName, "Over 5.5 Corners");

  // Clearing the code stops it being sent again.
  saveSendingSettings(db, { firstHalfCornersMarketType: "" });
  assert.equal(getSendingSettings(db).firstHalfCornersMarketType, "");
});

test("the first-half corners market is found by name to price the pick before its code is set", () => {
  const markets = [
    { name: "Corners Over/Under 9.5", runners: [{ selectionId: 1, runnerName: "Over 9.5" }] },
    { name: "1st Half Corners", runners: [{ selectionId: 2, runnerName: "Under 5.5" }, { selectionId: 3, runnerName: "Over 5.5" }] },
  ];
  assert.equal(firstHalfCornersRunner(markets, 5.5)?.selectionId, 3);
  assert.equal(firstHalfCornersRunner(markets, 6.5), null);
  assert.equal(firstHalfCornersRunner([{ name: "First Half Corners 4.5", runners: [{ selectionId: 9, runnerName: "Over 4.5 Corners" }] }], 4.5)?.selectionId, 9);
});
