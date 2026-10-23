/**
 * Clashes (inplayguru/clash.ts): a new Live bet that would cancel out one already on the match isn't placed, by the
 * feed or by hand; bets that offset or double up still go.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { betPickNow, buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { clashOf, exposureOf } from "../src/inplayguru/clash";
import { LAY_CHAT, LAY_GROUPS, layText } from "../src/inplayguru/lay-groups";

const alert = (strategy: string, goals: [number, number], match = "Home FC vs Away FC") =>
  [`🔔 ${strategy}`, "", "🇪🇸 Spain La Liga", match, "", "Timer: 60'", `Goals: ${goals[0]} - ${goals[1]}`, "Over/Under 1.50 Odds:", "1.70 2.10"].join("\n");

test("what cancels, offsets, doubles or is unrelated", () => {
  const over15 = { kind: "goals", line: 1.5, over: true } as const;
  assert.equal(clashOf(over15, { kind: "goals", line: 1.5, over: false }), "cancels", "back Over 1.5 with LAY Over 1.5");
  assert.equal(clashOf(over15, { kind: "goals", line: 2.5, over: false }), "offsets");
  assert.equal(clashOf(over15, { kind: "goals", line: 2.5, over: true }), "doubles");
  assert.equal(clashOf({ kind: "result", wins: ["H"] }, { kind: "result", wins: ["D", "A"] }), "cancels", "home to win with LAY home win");
  assert.equal(clashOf({ kind: "result", wins: ["H", "D"] }, { kind: "result", wins: ["D", "A"] }), "offsets", "away win lay with LAY home win");
  assert.equal(clashOf({ kind: "result", wins: ["D", "A"] }, { kind: "result", wins: ["A", "D"] }), "doubles", "LAY home win with underdog (away) double chance");
  assert.equal(clashOf(over15, { kind: "result", wins: ["H"] }), "unrelated");
  assert.equal(clashOf(null, over15), "unrelated");
  assert.deepEqual(exposureOf({ market: "UNDERDOG_DOUBLE_CHANCE", detail: { underdog: "away" } }), { kind: "result", wins: ["A", "D"] });
  assert.deepEqual(exposureOf({ market: "NEXT_GOAL_LAY", detail: { targetLine: 1.5 } }), { kind: "goals", line: 1.5, over: false });
});

test("a Live back bet that would cancel a Live LAY on the match isn't placed; another match is", () => {
  const db = new EngineDb(":memory:", () => {});
  const lay = "lay next goal · wake-up call 1 goal apart";
  saveSendingSettings(db, { enabled: true, strategies: { [lay]: true, "blistering momentum": true }, stakes: { [lay]: 2, "blistering momentum": 1 } });
  const at = new Date(Date.now() - 20_000).toISOString();
  const layAlert = layText(alert("Time to fight", [1, 0]), LAY_GROUPS[1]!);
  db.upsertLivePick(LAY_CHAT, 1, layAlert, parseAlert(layAlert), at, at);
  const first = buildFeed(db, { markSent: true, direct: true });
  assert.equal(first.newlySent, 1, "the LAY goes Live");

  db.upsertLivePick("c", 2, alert("Blistering Momentum", [1, 0]), parseAlert(alert("Blistering Momentum", [1, 0])), at, at);
  db.upsertLivePick("c", 3, alert("Blistering Momentum", [1, 0], "Other FC vs Third FC"), parseAlert(alert("Blistering Momentum", [1, 0], "Other FC vs Third FC")), at, at);
  const second = buildFeed(db, { markSent: true, direct: true });
  assert.equal(second.newlySent, 1, "only the other match");
  assert.match(second.skipped.find((s) => /cancel/.test(s.reason))!.reason, /Would cancel out LAY next goal · Wake-up Call 1 goal apart's Live bet/);

  // By hand too.
  const p = db.listLivePicks(10).find((x) => x.chatId === "c" && x.messageId === 2)!;
  assert.throws(() => betPickNow(db, p.id, { directLive: true }), /cancel out/);
});

test("the clash check counts how a strategy's picks met what is Live now", async () => {
  const { clashCheck } = await import("../src/server/clash-check");
  const db = new EngineDb(":memory:", () => {});
  const lay = "lay next goal · wake-up call 1 goal apart";
  saveSendingSettings(db, { enabled: true, strategies: { [lay]: true }, stakes: { [lay]: 2 } });
  const at = new Date(Date.now() - 60_000).toISOString();
  const layAlert = layText(alert("Time to fight", [1, 0]), LAY_GROUPS[1]!);
  db.upsertLivePick(LAY_CHAT, 1, layAlert, parseAlert(layAlert), at, at);
  db.upsertLivePick("c", 2, alert("Blistering Momentum", [1, 0]), parseAlert(alert("Blistering Momentum", [1, 0])), at, at);
  db.upsertLivePick("c", 3, alert("Blistering Momentum", [2, 0], "Other FC vs Third FC"), parseAlert(alert("Blistering Momentum", [2, 0], "Other FC vs Third FC")), at, at);
  const c = clashCheck(db, "Blistering Momentum");
  assert.equal(c.picks, 2);
  assert.equal(c.shared, 1);
  assert.equal(c.totals.cancels, 1);
  assert.equal(c.against[0]!.key, lay);
});

test("a lay idea watched becomes a LAY group in Sim at £2, and lays only its slice", async () => {
  const { layGroups, syncLayPicks, watchLayGroup, unwatchLayGroup } = await import("../src/inplayguru/lay-groups");
  const { getSendingSettings } = await import("../src/inplayguru/bet-feed");
  const db = new EngineDb(":memory:", () => {});
  const g = watchLayGroup(db, "Blistering Momentum", "NEXT_GOAL", ["min70"], "Losing when backed.");
  assert.equal(g.header, "LAY next goal · Blistering momentum: 70'+");
  assert.equal(getSendingSettings(db).stakes[g.header.toLowerCase()], 2);
  assert.equal(getSendingSettings(db).strategies[g.header.toLowerCase()] ?? false, false, "Sim");
  assert.throws(() => watchLayGroup(db, "blistering momentum", "NEXT_GOAL", ["min70"], ""), /already/);
  const at = new Date(Date.now() - 60_000).toISOString();
  const late = alert("Blistering Momentum", [0, 0]).replace("Timer: 60'", "Timer: 75'");
  db.upsertLivePick("c", 1, late, parseAlert(late), at, at);
  db.upsertLivePick("c", 2, alert("Blistering Momentum", [0, 0], "Other FC vs Third FC"), parseAlert(alert("Blistering Momentum", [0, 0], "Other FC vs Third FC")), at, at);
  assert.equal(syncLayPicks(db), 1, "only the 75' alert");
  const made = db.listLivePicks(10).find((p) => p.chatId === LAY_CHAT)!;
  assert.equal(made.strategy, g.header);
  assert.equal(made.market, "NEXT_GOAL_LAY");
  unwatchLayGroup(db, g.header);
  assert.equal(layGroups(db).length, LAY_GROUPS.length);
});

test("lay ideas leave out alerts a LAY group already lays", async () => {
  const { findLayIdeas } = await import("../src/server/lay-finder");
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { "time to fight": 1, "blistering momentum": 1 } });
  const settled = (strategy: string, goals: [number, number], line: string, match: string) =>
    [`🔔 ${strategy}`, "", "🇪🇸 Spain La Liga", match, "", "Timer: 75'", `Goals: ${goals[0]} - ${goals[1]}`, `Over/Under ${line} Odds:`, "1.70 2.10", "", "⸻⸻ Match Summary ⸻⸻", `Half-Time Score: ${goals[0]}-${goals[1]}`, `Full-Time Score: ${goals[0]}-${goals[1]}`, "", "❌ Miss"].join("\n");
  for (let i = 0; i < 60; i++) {
    const at = new Date(Date.now() - (60 - i) * 3_600_000).toISOString();
    const a = settled("Time to fight", [1, 0], "1.50", `Home${i} vs Away${i}`); // 1 goal apart: already laid
    const b = settled("Blistering Momentum", [0, 0], "0.50", `Other${i} vs Third${i}`); // not laid by anything
    db.upsertLivePick("c", i * 2 + 1, a, parseAlert(a), at, at);
    db.upsertLivePick("c", i * 2 + 2, b, parseAlert(b), at, at);
  }
  const ideas = findLayIdeas(db);
  assert.ok(ideas.length > 0, "Blistering Momentum, which lost every time, is an idea");
  assert.ok(ideas.every((i) => i.strategyKey === "blistering momentum"), "nothing from Wake-up Call 1 goal apart");
});
