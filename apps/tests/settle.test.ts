/**
 * A change gets time to run before anything more is suggested (owner, 8 Nov 2026): a Live strategy is judged only on
 * its Live bets since its latest change, and only once it has SETTLE_BETS of them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { SETTLE_BETS, strategyAdvice } from "../src/server/strategy-advice";

const S = "Favourite pressure level";
const KEY = S.toLowerCase();
const alert = (n: number, result?: "hit" | "miss") =>
  [`🔔 ${S}`, "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80", ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : [])].join("\n");

function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 10_000 });
  let id = 1;
  const bet = (at: Date, result: "hit" | "miss") => {
    const n = id++;
    const posted = new Date(at.getTime() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted, posted);
    buildFeed(db, { markSent: true, now: at });
    db.upsertLivePick("chat", n, alert(n, result), parseAlert(alert(n, result)), posted);
  };
  const switchedLive = (at: Date) => {
    const raw = JSON.parse(db.getSetting("sending")!) as { modeSince?: Record<string, string>; stakeSince?: Record<string, string> };
    db.setSetting("sending", JSON.stringify({ ...raw, modeSince: { ...raw.modeSince, [KEY]: at.toISOString() }, stakeSince: { ...raw.stakeSince, [KEY]: at.toISOString() } }));
  };
  return { db, bet, switchedLive };
}

const back = (db: EngineDb, now: Date) => strategyAdvice(db, now).find((a) => a.key === KEY && a.kind === "back-to-sim");

test("put Live again after a losing spell: not told to go back to Sim on the old spell's bets", () => {
  const { db, bet, switchedLive } = setup();
  const now = new Date();
  switchedLive(new Date(now.getTime() - 20 * 86_400_000));
  for (let i = 0; i < 31; i++) bet(new Date(now.getTime() - 10 * 86_400_000), "miss"); // the earlier, losing spell
  assert.ok(back(db, now), "while that spell is the current one, it is suggested");
  switchedLive(new Date(now.getTime() - 2 * 86_400_000)); // put Live again two days ago
  bet(new Date(now.getTime() - 86_400_000), "miss");
  bet(new Date(now.getTime() - 3_600_000), "hit");
  assert.equal(back(db, now), undefined, "two bets since going Live again: nothing yet");
  assert.equal(strategyAdvice(db, now).filter((a) => a.key === KEY).length, 0, "no stake change either");
});

test("once it has run SETTLE_BETS bets since the change, a clear loss is suggested again, counted from the change", () => {
  const { db, bet, switchedLive } = setup();
  const now = new Date();
  switchedLive(new Date(now.getTime() - 5 * 86_400_000));
  for (let i = 0; i < SETTLE_BETS - 1; i++) bet(new Date(now.getTime() - 4 * 86_400_000), i % 5 === 0 ? "hit" : "miss");
  assert.equal(back(db, now), undefined, `${SETTLE_BETS - 1} bets: still settling`);
  bet(new Date(now.getTime() - 3 * 86_400_000), "miss");
  const a = back(db, now);
  assert.ok(a, `${SETTLE_BETS} bets: judged`);
  assert.match(a!.reason, /since \d{1,2} [A-Z][a-z]{2}\b/, "the reason says it counts from the change");
});
