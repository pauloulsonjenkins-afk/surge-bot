/**
 * Leagues → Profit: money by league and strategy, milestone notifications (50 / 100 / 250 / 500 picks), the "stop it
 * in this league" suggestion, and a stopped strategy's picks going to Sim instead of being bet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeLeagueReturns, judge, newMilestones, setLeagueBlock, getLeagueBlocks } from "../src/server/league-returns";
import { applyAdvice, strategyAdvice } from "../src/server/strategy-advice";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();

function alert(n: number, league: string, result?: "hit" | "miss"): string {
  return [
    `🔔 ${S}`,
    "",
    `🇫🇷 ${league} (3rd vs 9th)`,
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 1000 });
  let id = 1;
  /** A pick that is bet (sent) and then settles. */
  const bet = (league: string, result: "hit" | "miss") => {
    const n = id++;
    const posted = new Date(Date.now() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n, league), parseAlert(alert(n, league)), posted);
    buildFeed(db, { markSent: true });
    db.upsertLivePick("chat", n, alert(n, league, result), parseAlert(alert(n, league, result)), posted);
  };
  return { db, bet };
}

test("money by league and by strategy within it, priced like Profit", () => {
  const { db, bet } = setup();
  bet("France Ligue 1", "hit");
  bet("France Ligue 1", "miss");
  bet("France Ligue 1", "miss");
  bet("France Ligue 2", "hit");
  const ls = computeLeagueReturns(db);
  const l1 = ls.find((l) => l.league.includes("Ligue 1"))!;
  assert.equal(l1.modes.all.picks, 3);
  assert.equal(l1.modes.all.won, 1);
  assert.equal(l1.modes.all.lost, 2);
  assert.equal(l1.modes.all.counted, 3);
  assert.ok(Math.abs(l1.modes.all.profit - -1) < 0.05, "won £1 at evens, lost £2");
  assert.equal(l1.byStrategy[KEY]!.all.picks, 3);
  assert.equal(ls[0]!.key, l1.key, "busiest first");
});

test("a verdict only once the whole likely range is one side of zero, and never before 50 priced picks", () => {
  const t = (won: number, lost: number) => ({ picks: won + lost, won, lost, counted: won + lost, staked: won + lost, profit: won - lost, sumR: won - lost, sumR2: won + lost });
  assert.equal(judge(t(10, 30)).verdict, "early");
  assert.equal(judge(t(25, 75)).verdict, "losing");
  assert.equal(judge(t(48, 52)).verdict, "unclear");
  assert.equal(judge(t(75, 25)).verdict, "winning");
});

test("milestones: the first run only records, then each new milestone is told once", () => {
  const { db, bet } = setup();
  for (let i = 0; i < 49; i++) bet("France Ligue 1", i % 2 ? "hit" : "miss");
  assert.deepEqual(newMilestones(db, computeLeagueReturns(db)), [], "first run records only");
  bet("France Ligue 1", "hit");
  const lines = newMilestones(db, computeLeagueReturns(db));
  assert.ok(lines.some((l) => /Ligue 1.*reached 50 picks/.test(l)), lines.join(" | "));
  assert.ok(lines.some((l) => /France \(all leagues\) reached 50/.test(l)));
  assert.ok(lines.some((l) => / in .*Ligue 1.*reached 50/.test(l)), "the strategy within the league too");
  assert.deepEqual(newMilestones(db, computeLeagueReturns(db)), [], "told once");
});

test("a Live strategy clearly losing in a league over 100+ picks gets 'stop it there'; Apply stops it", () => {
  const { db, bet } = setup();
  for (let i = 0; i < 100; i++) bet("France Ligue 1", i % 4 === 0 ? "hit" : "miss");
  const a = strategyAdvice(db).find((x) => x.kind === "league-block");
  assert.ok(a, "suggested");
  assert.equal(a!.key, KEY);
  assert.match(a!.reason, /over 100 picks/);
  applyAdvice(db, KEY, "league-block", new Date(), a!.league!.key);
  assert.ok(getLeagueBlocks(db)[KEY]?.[a!.league!.key]);
  assert.equal(strategyAdvice(db).filter((x) => x.kind === "league-block").length, 0, "gone once applied");
});

test("a stopped strategy's new picks in that league aren't bet but are recorded in Sim; other leagues carry on", () => {
  const { db } = setup();
  recordSimBets(db, new Date(Date.now() - 120_000)); // Sim recording starts before these picks arrive
  const posted = new Date(Date.now() - 60_000).toISOString();
  db.upsertLivePick("chat", 1, alert(1, "France Ligue 1"), parseAlert(alert(1, "France Ligue 1")), posted);
  db.upsertLivePick("chat", 2, alert(2, "France Ligue 2"), parseAlert(alert(2, "France Ligue 2")), posted);
  const picks = db.listLivePicks(10);
  const one = picks.find((p) => p.home === "Home 1")!;
  const two = picks.find((p) => p.home === "Home 2")!;
  setLeagueBlock(db, S, one.leagueKey, "Ligue 1", true);
  const feed = buildFeed(db, { markSent: true });
  assert.deepEqual(feed.rows.map((r) => r.pickId), [two.id], "only Ligue 2 is bet");
  assert.ok(feed.skipped.some((k) => k.pickId === one.id && /stopped in this league/.test(k.reason)));
  recordSimBets(db);
  for (const [n, league] of [[1, "France Ligue 1"], [2, "France Ligue 2"]] as const)
    db.upsertLivePick("chat", n, alert(n, league, "miss"), parseAlert(alert(n, league, "miss")), posted);
  const rows = db.listResultsForWinLoss("1970-01-01T00:00:00.000Z");
  const r1 = rows.find((r) => r.id === one.id)!;
  assert.equal(r1.placement, "sim");
  assert.equal(r1.sim?.skipped, null);
  assert.equal(r1.sim?.stake, 1, "simulated at its stake, so the block can be judged");
  assert.notEqual(rows.find((r) => r.id === two.id)!.placement, "sim");
  setLeagueBlock(db, S, one.leagueKey, "Ligue 1", false);
  assert.deepEqual(getLeagueBlocks(db), {});
});
