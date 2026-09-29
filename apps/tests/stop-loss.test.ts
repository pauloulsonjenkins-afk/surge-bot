/**
 * Checks the per-strategy stop loss: it must stop NEW picks once a limit is hit, never touch rows
 * already handed over, reset at UK midnight, and never guess winnings it can't price.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeStopLoss, saveStopLossRule, getStopLossRules } from "../src/inplayguru/stop-loss";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();

function alert(n: number, opts: { result?: "hit" | "miss"; over?: string } = {}): string {
  return [
    `🔔 ${S}`,
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    `${opts.over ?? "2.00"} 1.80`,
    ...(opts.result
      ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${opts.result === "hit" ? "1-0" : "0-0"}`, "", opts.result === "hit" ? "✅ Hit" : "❌ Miss"]
      : []),
  ].join("\n");
}

function setup(now: Date) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 2 }, strategies: { [KEY]: true }, dailyCap: 100 });
  let id = 1;
  const posted = () => new Date(now.getTime() - 60_000).toISOString();
  /** A pick that arrives, is handed to the betting software, and then finishes. */
  const sentAndSettled = (result: "hit" | "miss", over = "2.00") => {
    const n = id++;
    const open = alert(n, { over });
    db.upsertLivePick("chat", n, open, parseAlert(open), posted());
    buildFeed(db, { markSent: true, now });
    const done = alert(n, { over, result });
    db.upsertLivePick("chat", n, done, parseAlert(done), posted());
  };
  /** A fresh pick waiting to be sent. */
  const fresh = () => {
    const n = id++;
    const t = alert(n);
    db.upsertLivePick("chat", n, t, parseAlert(t), posted());
    return n;
  };
  return { db, sentAndSettled, fresh };
}

const NOW = new Date();

test("with no limits set, nothing is ever stopped", () => {
  const { db, sentAndSettled, fresh } = setup(NOW);
  sentAndSettled("miss"); sentAndSettled("miss"); sentAndSettled("miss");
  fresh();
  assert.equal(computeStopLoss(db, NOW).size, 0);
  assert.equal(buildFeed(db, { markSent: false, now: NOW }).rows.length, 1);
});

test("the daily loss limit stops new picks, with the reason shown", () => {
  const { db, sentAndSettled, fresh } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: 4 });
  sentAndSettled("miss");
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.stopped, false);   // down £2 of £4
  fresh();
  assert.equal(buildFeed(db, { markSent: false, now: NOW }).rows.length, 1);
  sentAndSettled("miss");                                            // down £4
  const st = computeStopLoss(db, NOW).get(KEY)!;
  assert.equal(st.stopped, true);
  assert.equal(st.todayNet, -4);
  fresh();
  const feed = buildFeed(db, { markSent: false, now: NOW });
  // the pick handed over before the stop keeps its row; the new one is held back and says why
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.skipped.length, 1);
  assert.match(feed.skipped[0]?.reason ?? "", /^Stopped: down £4.00 today \(limit £4.00\)/);
});

test("wins count against losses, using the alert's own price", () => {
  const { db, sentAndSettled } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: 3 });
  sentAndSettled("hit", "3.00");   // +£4.00 (stake 2 at 3.00)
  sentAndSettled("miss");          // -£2.00
  sentAndSettled("miss");          // -£2.00  => net 0
  const st = computeStopLoss(db, NOW).get(KEY)!;
  assert.equal(st.todayNet, 0);
  assert.equal(st.stopped, false);
});

test("a hit with no usable price counts as £0 won, so the stop can only come early", () => {
  const { db, sentAndSettled } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: 2 });
  const n = 900;
  const noOdds = ["🔔 " + S, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", "Home vs Away", "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80"].join("\n");
  db.upsertLivePick("chat", n, noOdds, parseAlert(noOdds), new Date(NOW.getTime() - 60_000).toISOString());
  buildFeed(db, { markSent: true, now: NOW });
  // the result arrives, but its Over/Under line no longer matches the bet, so its price can't be trusted
  const settled = noOdds.replace("Over/Under 0.50 Odds:\n2.00 1.80", "Over/Under 1.50 Odds:\n2.00 1.80") + "\n\n⸻⸻ Match Summary ⸻⸻\nHalf-Time Score: 0-0\nFull-Time Score: 1-0\n\n✅ Hit";
  db.upsertLivePick("chat", n, settled, parseAlert(settled), new Date(NOW.getTime() - 60_000).toISOString());
  sentAndSettled("miss");
  const st = computeStopLoss(db, NOW).get(KEY)!;
  assert.equal(st.todayNet, -2);   // the unpriced win added nothing
  assert.equal(st.stopped, true);
});

test("a losing run stops the strategy, and a win in between resets the run", () => {
  const { db, sentAndSettled, fresh } = setup(NOW);
  saveStopLossRule(db, S, { lossRun: 3 });
  sentAndSettled("miss"); sentAndSettled("miss");
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.stopped, false);
  sentAndSettled("hit");
  sentAndSettled("miss"); sentAndSettled("miss");
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.todayRun, 2);
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.stopped, false);
  sentAndSettled("miss");
  const st = computeStopLoss(db, NOW).get(KEY)!;
  assert.equal(st.stopped, true);
  assert.match(st.reason ?? "", /3 losing picks in a row today \(limit 3\)/);
  fresh();
  assert.equal(buildFeed(db, { markSent: false, now: NOW }).rows.length, 0);
});

test("a stop never touches rows already handed over", () => {
  const { db, fresh } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: 2 });
  fresh();
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).newlySent, 1);   // sent while still allowed
  // the strategy now hits its limit while that pick is still open
  const later = setup(NOW);
  void later;
  saveStopLossRule(db, S, { dailyLoss: 0.01 });
  // simulate a loss today by settling a second sent pick
  const n = 500;
  const t = alert(n);
  db.upsertLivePick("chat", n, t, parseAlert(t), new Date(NOW.getTime() - 60_000).toISOString());
  const before = buildFeed(db, { markSent: true, now: NOW });
  const done = alert(n, { result: "miss" });
  db.upsertLivePick("chat", n, done, parseAlert(done), new Date(NOW.getTime() - 60_000).toISOString());
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.stopped, true);
  const after = buildFeed(db, { markSent: true, now: NOW });
  assert.ok(after.rows.length >= 1, "the still-open sent pick keeps its row");
  assert.equal(after.newlySent, 0);
  assert.ok(before.rows.length >= 1);
});

test("only picks actually sent to bet are counted", () => {
  const { db } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: 2 });
  const n = 700;
  const open = alert(n);
  db.upsertLivePick("chat", n, open, parseAlert(open), new Date(NOW.getTime() - 60_000).toISOString());
  const done = alert(n, { result: "miss" });          // finished without ever being sent
  db.upsertLivePick("chat", n, done, parseAlert(done), new Date(NOW.getTime() - 60_000).toISOString());
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.todayNet, 0);
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.stopped, false);
});

test("the count starts again at UK midnight", () => {
  const { db, sentAndSettled } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: 2 });
  sentAndSettled("miss");
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.stopped, true);
  const tomorrow = new Date(NOW.getTime() + 26 * 60 * 60 * 1000);
  assert.equal(computeStopLoss(db, tomorrow).get(KEY)?.stopped, false);
});

test("Resume today restarts the count; clearing limits removes the rule", () => {
  const { db, sentAndSettled } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: 2 });
  sentAndSettled("miss");
  assert.equal(computeStopLoss(db, NOW).get(KEY)?.stopped, true);
  saveStopLossRule(db, S, { resume: true }, new Date(NOW.getTime() + 1000));
  assert.equal(computeStopLoss(db, new Date(NOW.getTime() + 2000)).get(KEY)?.stopped, false);
  saveStopLossRule(db, S, { dailyLoss: null });
  assert.deepEqual(getStopLossRules(db), {});
});

test("bad values are ignored, not saved", () => {
  const { db } = setup(NOW);
  saveStopLossRule(db, S, { dailyLoss: -5, lossRun: 0 });
  assert.deepEqual(getStopLossRules(db), {});
  saveStopLossRule(db, S, { dailyLoss: 10, lossRun: 2.5 });
  assert.equal(getStopLossRules(db)[KEY]?.dailyLoss, 10);
  assert.equal(getStopLossRules(db)[KEY]?.lossRun, null);
});
