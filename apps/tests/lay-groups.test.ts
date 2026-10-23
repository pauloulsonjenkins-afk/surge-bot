/**
 * LAY groups (inplayguru/lay-groups.ts): next-goal alerts in a losing group get their own LAY pick (lay Over goals so far
 * + 0.5), which wins when no more goals come, is priced from Betfair's lay price, settles with its source, and is never
 * made against a pick being backed Live.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { isLayMarket, parseAlert } from "../src/inplayguru/parse-alert";
import { feedMarket, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { LAY_CHAT, layText, LAY_GROUPS, syncLayPicks } from "../src/inplayguru/lay-groups";
import { pickOdds } from "../src/server/pricing";

const alert = (strategy: string, league: string, goals: [number, number], ft?: [number, number]) =>
  [
    `🔔 ${strategy}`, "", league, "Home FC vs Away FC", "", "Timer: 60'", `Goals: ${goals[0]} - ${goals[1]}`, "Over/Under 1.50 Odds:", "1.70 2.10",
    ...(ft ? ["", "⸻⸻ Match Summary ⸻⸻", `Half-Time Score: ${goals[0]}-${goals[1]}`, `Full-Time Score: ${ft[0]}-${ft[1]}`, "", ft[0] + ft[1] > goals[0] + goals[1] ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

const recent = (db: EngineDb) => db.listLivePicks(50, { from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() });

test("a LAY pick parses as a lay of Over goals so far + 0.5, which wins when no more goals come", () => {
  const g = LAY_GROUPS[1]!;
  const noGoal = parseAlert(layText(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0], [1, 0]), g));
  assert.equal(noGoal.market, "NEXT_GOAL_LAY");
  assert.equal(noGoal.selection, "LAY Over 1.5");
  assert.equal(noGoal.result, "hit", "no more goals: the LAY wins");
  assert.equal(parseAlert(layText(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0], [2, 0]), g)).result, "miss", "another goal: the LAY loses");
  assert.ok(isLayMarket("NEXT_GOAL_LAY") && isLayMarket("AWAY_WIN_LAY") && !isLayMarket("NEXT_GOAL"));
  assert.doesNotMatch(layText(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0], [2, 0]), g), /Hit|✅/, "the back bet's tick is left out");
});

test("it is laid in the Over/Under market on the Over selection, priced from Betfair's lay price", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = layText(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0]), LAY_GROUPS[1]!);
  db.upsertLivePick(LAY_CHAT, 1, text, parseAlert(text));
  const p = db.getLivePickByMessage(LAY_CHAT, 1)!;
  const back = parseAlert(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0]));
  db.upsertLivePick("c", 2, alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0]), back);
  const q = db.getLivePickByMessage("c", 2)!;
  assert.deepEqual(feedMarket(p, getSendingSettings(db), (n) => n), feedMarket(q, getSendingSettings(db), (n) => n));
  // Lay at 1.80: risk £0.80 to win £1, so it pays like a back bet at 1.80 / 0.80 = 2.25.
  assert.equal(pickOdds({ market: "NEXT_GOAL_LAY", targetLine: 1.5, overLine: 1.5, overOdds: 1.7, favouriteOdds: null, betOdds: null, exchangeOdds: 1.8, takenOdds: null }, null)?.odds, 2.25);
});

test("LAY picks are made for the groups, once, never against a Live back bet, and settle with their source", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date().toISOString();
  // Japan (any strategy), Wake-up Call one goal apart, a Wake-up Call two apart (not a group), and a Spanish Boiling Point (not a group).
  db.upsertLivePick("c", 1, alert("Blistering Momentum", "🇯🇵 Japan J1 League", [0, 0]), parseAlert(alert("Blistering Momentum", "🇯🇵 Japan J1 League", [0, 0])), now, now);
  db.upsertLivePick("c", 2, alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0]), parseAlert(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0])), now, now);
  db.upsertLivePick("c", 3, alert("Time to fight", "🇪🇸 Spain Segunda", [2, 0]).replace("Home FC", "Other FC"), parseAlert(alert("Time to fight", "🇪🇸 Spain Segunda", [2, 0]).replace("Home FC", "Other FC")), now, now);
  assert.equal(syncLayPicks(db), 2);
  const lays = recent(db).filter((p) => p.chatId === LAY_CHAT);
  assert.deepEqual(lays.map((p) => p.strategy).sort(), ["LAY next goal · Japan and Brazil", "LAY next goal · Wake-up Call 1 goal apart"]);
  assert.equal(syncLayPicks(db), 0, "once");

  // The source's full-time edit is copied across: 1-0 stayed 1-0, so the Wake-up Call LAY wins.
  const src = recent(db).find((p) => p.chatId === "c" && p.messageId === 2)!;
  db.upsertLivePick("c", 2, alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0], [1, 0]), parseAlert(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0], [1, 0])));
  syncLayPicks(db);
  assert.equal(db.getLivePickByMessage(LAY_CHAT, src.id)!.result, "hit");

  // Backed Live: no LAY.
  const db2 = new EngineDb(":memory:", () => {});
  saveSendingSettings(db2, { enabled: true, strategies: { "time to fight": true }, stakes: { "time to fight": 1 } });
  db2.upsertLivePick("c", 1, alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0]), parseAlert(alert("Time to fight", "🇪🇸 Spain La Liga", [1, 0])), now, now);
  assert.equal(syncLayPicks(db2), 0);
});

test("LAY home win: each Matched odds home alert gets a LAY of the home side in Match Odds, winning on a draw or away win", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date(Date.now() - 1000).toISOString();
  const moh = (ft?: [number, number]) => alert("Matched odds home", "🇪🇸 Spain La Liga", [0, 0], ft);
  const back = parseAlert(moh());
  assert.equal(back.market, "HOME_TO_WIN");
  db.upsertLivePick("c", 1, moh(), back, now, now);
  assert.equal(syncLayPicks(db), 1);
  const lay = recent(db).find((p) => p.chatId === LAY_CHAT)!;
  assert.equal(lay.strategy, "LAY home win · Matched odds home");
  assert.equal(lay.market, "HOME_WIN_LAY");
  assert.ok(isLayMarket("HOME_WIN_LAY"));
  assert.deepEqual(feedMarket(lay, getSendingSettings(db), (n) => n), feedMarket(recent(db).find((p) => p.chatId === "c")!, getSendingSettings(db), (n) => n));
  assert.equal(parseAlert(layText(moh([1, 1]), LAY_GROUPS[3]!)).result, "hit", "a draw: the LAY wins");
  assert.equal(parseAlert(layText(moh([0, 1]), LAY_GROUPS[3]!)).result, "hit", "an away win: the LAY wins");
  assert.equal(parseAlert(layText(moh([2, 1]), LAY_GROUPS[3]!)).result, "miss", "a home win: the LAY loses");
  // Lay the home side at 2.50: risk £1.50 to win £1, so it pays like a back bet at 2.50 / 1.50.
  assert.equal(pickOdds({ market: "HOME_WIN_LAY", targetLine: null, overLine: null, overOdds: null, favouriteOdds: null, betOdds: null, exchangeOdds: 2.5, takenOdds: null }, null)?.odds, 1.667);
});
