import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { ladderStep, strategyAdvice, applyAdvice } from "../src/server/strategy-advice";
import { buildWeeklyReview, dueWeeklyReview } from "../src/server/weekly-review";
import { saveSendingSettings, getSendingSettings } from "../src/inplayguru/bet-feed";

test("the stake ladder moves one step at a time and stops at its ends", () => {
  assert.deepEqual(ladderStep({ pct: 2 }, 1), { pct: 3 });
  assert.deepEqual(ladderStep({ pct: 2 }, -1), { pct: 1.5 });
  assert.deepEqual(ladderStep({ pct: 2.5 }, 1), { pct: 3 }, "an off-ladder stake goes to the next step");
  assert.equal(ladderStep({ pct: 5 }, 1), null);
  assert.equal(ladderStep({ pct: 1 }, -1), null);
  assert.deepEqual(ladderStep({ flat: 2 }, 1), { flat: 3 });
  assert.equal(ladderStep({ flat: 1 }, -1), null);
});

test("no suggestions and nothing applied without enough bets", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, strategies: { "favourite pressure 2nd half": true }, stakePct: { "favourite pressure 2nd half": 2 } });
  assert.deepEqual(strategyAdvice(db), []);
  assert.throws(() => applyAdvice(db, "favourite pressure 2nd half", "stake-up"), /no longer applies/);
  assert.equal(getSendingSettings(db).stakePct["favourite pressure 2nd half"], 2, "the stake is untouched");
});

test("the Sunday review is due once, from 19:00 UK on Sunday", () => {
  const sun = new Date("2026-10-18T18:05:00Z"); // 19:05 UK (BST)
  const monday = dueWeeklyReview(null, sun);
  assert.equal(monday, "2026-10-12");
  assert.equal(dueWeeklyReview(monday, sun), null, "sent already");
  assert.equal(dueWeeklyReview(null, new Date("2026-10-18T16:00:00Z")), null, "17:00 UK: not yet");
  assert.equal(dueWeeklyReview(null, new Date("2026-10-17T18:05:00Z")), null, "Saturday");
  const msg = buildWeeklyReview(new EngineDb(":memory:", () => {}), sun);
  assert.match(msg.title, /GoalBrew week: Live/);
  assert.match(msg.body, /No changes suggested/);
});

test("automatic stakes: off by default, saved by its switch, and nothing moves without a qualifying strategy", async () => {
  const { autoApplyStakes } = await import("../src/server/strategy-advice");
  const db = new EngineDb(":memory:", () => {});
  assert.equal(getSendingSettings(db).ladderAuto, false);
  saveSendingSettings(db, { ladderAuto: true, enabled: true, strategies: { "favourite pressure 2nd half": true }, stakePct: { "favourite pressure 2nd half": 2 } });
  assert.equal(getSendingSettings(db).ladderAuto, true);
  assert.deepEqual(autoApplyStakes(db), []);
  assert.equal(getSendingSettings(db).stakePct["favourite pressure 2nd half"], 2);
});

/** A Live strategy at £2 a bet, raised an hour ago, with `n` Live bets since, all lost. */
async function raisedThenLosing(n: number) {
  const { buildFeed } = await import("../src/inplayguru/bet-feed");
  const { parseAlert } = await import("../src/inplayguru/parse-alert");
  const S = "Blistering Momentum";
  const KEY = S.toLowerCase();
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, ladderAuto: true, stakes: { [KEY]: 2 }, strategies: { [KEY]: true }, dailyCap: 100 });
  const now = new Date();
  db.setSetting("stake_ladder_raises", JSON.stringify({ [KEY]: { at: new Date(now.getTime() - 3_600_000).toISOString() } }));
  // Its last step was yesterday: the usual 7 days between automatic steps hasn't passed.
  db.setSetting("stake_ladder_last_step", JSON.stringify({ [KEY]: new Date(now.getTime() - 86_400_000).toISOString() }));
  const alert = (i: number, done: boolean) =>
    [`🔔 ${S}`, "", "🇫🇷 France Ligue 1", `Lyon${i} vs Nantes${i}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80",
      ...(done ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", "Full-Time Score: 0-0", "", "❌ Miss"] : [])].join("\n");
  const posted = new Date(now.getTime() - 60_000).toISOString();
  for (let i = 1; i <= n; i++) {
    db.upsertLivePick("chat", i, alert(i, false), parseAlert(alert(i, false)), posted);
    buildFeed(db, { markSent: true, now });
  }
  for (let i = 1; i <= n; i++) db.upsertLivePick("chat", i, alert(i, true), parseAlert(alert(i, true)), posted);
  return { db, KEY, now };
}

test("a raise that loses at once is cut a step straight away, without waiting the 7 days, and not raised again for 14", async () => {
  const { autoApplyStakes } = await import("../src/server/strategy-advice");
  const few = await raisedThenLosing(10);
  assert.equal(strategyAdvice(few.db, few.now).filter((a) => a.fast).length, 0, "10 bets since the raise: too few to judge");

  const { db, KEY, now } = await raisedThenLosing(15);
  const cut = strategyAdvice(db, now).find((a) => a.key === KEY && a.kind === "stake-down");
  assert.ok(cut?.fast);
  assert.match(cut!.reason, /since it was raised/);
  assert.deepEqual(autoApplyStakes(db, now).map((a) => a.action), ["Lower to £1"]);
  assert.equal(getSendingSettings(db).stakes[KEY], 1);
  // Cut once: the same bets don't cut it again.
  assert.equal(strategyAdvice(db, now).filter((a) => a.fast).length, 0);
  assert.ok(JSON.parse(db.getSetting("stake_ladder_raises")!)[KEY].cutAt);
});

test("back to Sim: the reason also gives the whole Live record, so it doesn't contradict a later green headline", async () => {
  const { buildFeed } = await import("../src/inplayguru/bet-feed");
  const { parseAlert } = await import("../src/inplayguru/parse-alert");
  const S = "Favourite pressure level";
  const KEY = S.toLowerCase();
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 1000 });
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
  // Whole record (older than 30 days): mostly wins, clearly profitable.
  for (let i = 0; i < 40; i++) bet(40, i % 5 === 0 ? "miss" : "hit");
  // Last 30 days: mostly losses, a bad recent spell.
  for (let i = 0; i < 32; i++) bet(10, i % 5 === 0 ? "hit" : "miss");

  const advice = strategyAdvice(db, now);
  const a = advice.find((x) => x.key === KEY && x.kind === "back-to-sim");
  assert.ok(a, "suggested back to Sim from the bad last 30 days");
  assert.match(a!.reason, /Live bets \(30 days\)/);
  assert.match(a!.reason, /whole Live record is still \+\d/, "names the whole-record figure so it isn't read as a contradiction once the headline shows it");
});
