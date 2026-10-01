/**
 * A sent pick with no bet on Betfair 3 minutes after it was sent is "not placed": listed on the Sending page and
 * notified once. Only once Betfair has been checked after the 3 minutes; picks with any bet, or placed by hand, aren't.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { matchBets } from "../src/betfair/reconcile";
import { listUnplaced, notifyUnplaced } from "../src/betfair/unplaced";

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
