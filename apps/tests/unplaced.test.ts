/**
 * A sent pick with no bet on Betfair 3 minutes after it was sent is "not placed": listed on the Sending page and
 * notified once. Only once Betfair has been checked after the 3 minutes; picks with any bet, or placed by hand, aren't.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { matchBets } from "../src/betfair/reconcile";
import { fixAndResend, listUnplaced, matchStatsLines, notifyUnplaced, scoreLine } from "../src/betfair/unplaced";

const S = "Time to fight";
const KEY = S.toLowerCase();
const alert = (n: number) =>
  [`🔔 ${S}`, "", "🇫🇷 France Ligue 1", `Lyon${n} vs Nantes${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "1.50 2.50"].join("\n");

/** Three picks sent through the feed just now; `later(ms)` is that long after they were sent. */
function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 100 });
  for (const n of [1, 2, 3]) {
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), new Date(Date.now() - 10_000).toISOString());
    buildFeed(db, { markSent: true, now: new Date() });
  }
  const sent = db.listSentPicks();
  const later = (ms: number) => new Date(Math.max(...sent.map((p) => Date.parse(p.sentAt))) + ms);
  return { db, sent, later };
}

test("no bet 3 minutes on is listed, once Betfair has been checked after that", () => {
  const { db, sent, later } = setup();
  const now = later(4 * 60_000);
  // Betfair last checked 2 minutes after sending: too soon to say.
  assert.equal(listUnplaced(db, later(2 * 60_000).toISOString(), now).length, 0);
  assert.equal(listUnplaced(db, now.toISOString(), now).length, 3);

  // One got a bet (even unmatched), one was placed by hand: only the third is unplaced.
  db.saveBetfairBets(
    [{ betId: "A", placedAt: new Date(Date.parse(sent[0]!.sentAt) + 5_000).toISOString(), settledAt: null, event: sent[0]!.sentRow!.eventName!, market: null, selection: "Over 0.5 Goals", side: "back", provider: null, status: "pending", stake: 1, matched: 0, odds: null, profit: null }],
    "t",
  );
  matchBets(db);
  db.setManualBet(sent[1]!.id, { stake: 1, odds: 1.5 });
  const left = listUnplaced(db, now.toISOString(), now);
  assert.deepEqual(left.map((u) => u.id), [sent[2]!.id]);
  assert.equal(left[0]!.strategy, S);
  assert.match(left[0]!.reason, /Not checked on Betfair/);
});

test("too recent to call: under 3 minutes", () => {
  const { db, later } = setup();
  const now = later(2 * 60_000);
  assert.equal(listUnplaced(db, now.toISOString(), now).length, 0);
});

test("each unplaced pick is notified once, and old ones never", async () => {
  const { db, later } = setup();
  const now = later(4 * 60_000);
  assert.equal(await notifyUnplaced(db, now.toISOString(), now), 3);
  assert.equal(await notifyUnplaced(db, now.toISOString(), now), 0, "not again");
  assert.ok(listUnplaced(db, now.toISOString(), now).every((u) => u.alertedAt !== null));

  const old = setup();
  const much = old.later(45 * 60_000);
  assert.equal(await notifyUnplaced(old.db, much.toISOString(), much), 0, "sent too long ago to notify");
  assert.equal(listUnplaced(old.db, much.toISOString(), much).length, 3, "but still listed");
});

test("a cleared pick leaves the list and isn't notified about, the others stay", async () => {
  const { db, sent, later } = setup();
  const now = later(4 * 60_000);
  assert.equal(db.clearUnplaced([sent[0]!.id, sent[1]!.id], now.toISOString()), 2);
  // Clearing again changes nothing.
  assert.equal(db.clearUnplaced([sent[0]!.id], now.toISOString()), 0);
  assert.deepEqual(listUnplaced(db, now.toISOString(), now).map((u) => u.id), [sent[2]!.id]);
  assert.equal(await notifyUnplaced(db, now.toISOString(), now), 1);
});

test("the feed sends Betfair's own event name once the match is found, and waits briefly for that check", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 100 });
  const at = new Date(Date.now() - 5_000);
  db.upsertLivePick("chat", 1, alert(1), parseAlert(alert(1)), at.toISOString());
  const id = db.listLivePicks(5)[0]!.id;
  // Not checked yet: held back for now, sent anyway once the wait is over.
  assert.equal(buildFeed(db, { markSent: false, holdForExchangeMs: 45_000 }).rows.length, 0);
  assert.equal(buildFeed(db, { markSent: false, holdForExchangeMs: 45_000, now: new Date(at.getTime() + 60_000) }).rows.length, 1);
  // Found on Betfair under a fuller name: that name goes in the feed.
  db.setPickExchange(id, "on", "Olympique Lyon1 v Nantes1", 1.5, { status: "ok", detail: "" });
  const rows = buildFeed(db, { markSent: true, holdForExchangeMs: 45_000 }).rows;
  assert.equal(rows[0]!.eventName, "Olympique Lyon1 v Nantes1");
});

test("a team Betfair spells differently: Add name & send saves the Match name and re-sends under Betfair's name", () => {
  const { db, sent, later } = setup();
  const p = sent[0]!;
  db.setPickExchange(p.id, "nameDiffers", "Lyon1 v FC Nantes1", null, null);
  const now = later(4 * 60_000);
  const listed = listUnplaced(db, now.toISOString(), now).find((u) => u.id === p.id)!;
  assert.equal(listed.betfairEvent, "Lyon1 v FC Nantes1");

  const r = fixAndResend(db, p.id, now);
  assert.equal(r.sent, true);
  assert.deepEqual(r.added, ["Nantes1 = FC Nantes1"]);
  assert.match(getSendingSettings(db).aliases, /Nantes1 = FC Nantes1/);
  // Re-sent: the feed now serves Betfair's name, and the 3-minute clock starts again.
  const row = buildFeed(db, { markSent: true }).rows.find((x) => x.pickId === p.id)!;
  assert.equal(row.eventName, "Lyon1 v FC Nantes1");
  assert.equal(listUnplaced(db, now.toISOString(), now).some((u) => u.id === p.id), false);
});

test("a Betfair price below the strategy's minimum odds is given as the reason", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, minOdds: { [KEY]: 1.2 }, dailyCap: 100 });
  db.upsertLivePick("chat", 1, alert(1), parseAlert(alert(1)), new Date(Date.now() - 10_000).toISOString());
  const id = db.listLivePicks(5)[0]!.id;
  db.setPickExchange(id, "on", "Lyon1 v Nantes1", 1.08, { status: "ok", detail: "OVER_UNDER_05 · Over 0.5 Goals" });
  buildFeed(db, { markSent: true });
  const now = new Date(Date.now() + 4 * 60_000);
  assert.match(listUnplaced(db, now.toISOString(), now)[0]!.reason, /price was 1\.08, below this strategy's minimum odds of 1\.20/);
});

test("the notification shows the score, shots/on target, corners and a momentum bar", () => {
  const text = [
    "🔔 Time to fight", "", "🇫🇷 France Ligue 1", "Lyon vs Nantes", "", "Timer: 68'", "Goals: 1 - 3", "Corners: 1 - 4",
    "Momentum: 20 - 80", "Shots On Target: 2 - 4", "Shots Off Target: 0 - 7", "Dangerous Attacks: 36 - 53",
  ].join("\n");
  const db = new EngineDb(":memory:", () => {});
  const at = new Date("2026-10-02T12:00:00Z");
  db.upsertLivePick("chat", 1, text, parseAlert(text), at.toISOString());
  const p = db.listLivePicks(5)[0]!;
  assert.equal(scoreLine(p, new Date(at.getTime() + 3 * 60_000)), " · 1–3 at 68' (now ~71')");
  assert.deepEqual(matchStatsLines(p), [
    "Shots/on target: Lyon 2/2 · Nantes 11/4",
    "Corners 1–4 · Dangerous attacks 36–53",
    "Momentum ██░░░░░░░░ 20–80",
  ]);
});
