/**
 * A notification when a bet with real money on it settles (server/bet-result-notify.ts): told once, a correction told
 * again, nothing old on the first pass, held back in quiet hours, and a busy pass is one summary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { notifyBetResults } from "../src/server/bet-result-notify";

const alert = (n: number, result?: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

/** An alert logged as bet by hand (£2 at 2.10), settled or not. */
function handBet(db: EngineDb, n: number, result?: "hit" | "miss") {
  const at = new Date(Date.now() - 3600_000).toISOString();
  const text = alert(n, result);
  db.upsertLivePick("chat", n, text, parseAlert(text), at);
  const id = db.getLivePickByMessage("chat", n)!.id;
  db.setManualBet(id, { stake: 2, odds: 2.1 });
  return id;
}
const settle = (db: EngineDb, n: number, result: "hit" | "miss") => {
  const at = new Date(Date.now() - 3600_000).toISOString();
  db.upsertLivePick("chat", n, alert(n, result), parseAlert(alert(n, result)), at);
};
/** Midday UK on today's date: never a quiet hour. */
const noon = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)); };
const pushes = (db: EngineDb) => db.listPushLog();

test("the first pass tells nothing old; a bet that settles afterwards is told once, as won", async () => {
  const db = new EngineDb(":memory:", () => {});
  handBet(db, 1, "hit"); // already settled
  assert.equal(await notifyBetResults(db, noon()), 0, "first pass: baseline only");
  handBet(db, 2); // placed by hand, still open
  assert.equal(await notifyBetResults(db, noon()), 0, "nothing settled yet");
  settle(db, 2, "hit");
  assert.equal(await notifyBetResults(db, noon()), 1);
  const [p] = pushes(db);
  assert.match(p!.title, /^Won \+£/);
  assert.match(p!.body, /£2\.00 at 2\.10 \(placed by hand\)/);
  assert.equal(await notifyBetResults(db, noon()), 0, "not told twice");
});

test("a lost bet is told as lost; a result changed by hand later is told as a correction", async () => {
  const db = new EngineDb(":memory:", () => {});
  await notifyBetResults(db, noon());
  handBet(db, 3);
  settle(db, 3, "miss");
  await notifyBetResults(db, noon());
  assert.match(pushes(db)[0]!.title, /^Lost −£2\.00$/);
  const id = db.getLivePickByMessage("chat", 3)!.id;
  assert.ok(db.setResultOverride(id, "hit"), "result fixed by hand");
  assert.equal(await notifyBetResults(db, noon()), 1);
  assert.match(pushes(db)[0]!.title, /^Result changed: Won \+£/);
  assert.equal(await notifyBetResults(db, noon()), 0, "the correction isn't repeated");
});

test("quiet hours hold results back until the first pass after 07:00", async () => {
  const db = new EngineDb(":memory:", () => {});
  await notifyBetResults(db, noon());
  handBet(db, 4);
  settle(db, 4, "hit");
  const d = new Date();
  const night = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 2));
  assert.equal(await notifyBetResults(db, night), 0, "02:00: held back");
  assert.equal(await notifyBetResults(db, noon()), 1, "told once it's day");
});

test("more than three at once come as one summary", async () => {
  const db = new EngineDb(":memory:", () => {});
  await notifyBetResults(db, noon());
  for (let n = 10; n < 15; n++) { handBet(db, n); settle(db, n, n % 2 ? "hit" : "miss"); }
  assert.equal(await notifyBetResults(db, noon()), 1);
  assert.match(pushes(db)[0]!.title, /^5 bets settled: /);
});

test("a busy day goes hourly: results are held, then sent as one summary with today's total once the hour is up", async () => {
  const db = new EngineDb(":memory:", () => {});
  const t0 = noon();
  await notifyBetResults(db, t0); // baseline
  // Three results trickle in, one at a time, a few minutes apart: still sent one each (a quiet day's behaviour).
  for (let n = 20; n < 23; n++) {
    handBet(db, n);
    settle(db, n, "hit");
    assert.equal(await notifyBetResults(db, new Date(t0.getTime() + (n - 19) * 60_000)), 1, `bet ${n}: sent on its own`);
  }
  // The fourth within the hour makes it a busy day: held, not sent.
  handBet(db, 23);
  settle(db, 23, "miss");
  const held = new Date(t0.getTime() + 10 * 60_000);
  const before = pushes(db).length;
  assert.equal(await notifyBetResults(db, held), 0, "held for the hour");
  handBet(db, 24);
  settle(db, 24, "hit");
  assert.equal(await notifyBetResults(db, new Date(t0.getTime() + 30 * 60_000)), 0, "still held, nothing more sent");
  assert.equal(pushes(db).length, before);
  // An hour on: everything held goes as one summary.
  assert.equal(await notifyBetResults(db, new Date(t0.getTime() + 3 * 3_600_000)), 1);
  const [p] = pushes(db);
  assert.match(p!.title, /^2 bets settled: /);
  assert.match(p!.body, /Today so far/);
  assert.equal(await notifyBetResults(db, new Date(t0.getTime() + 3 * 3_600_000 + 60_000)), 0, "not told twice");
});
