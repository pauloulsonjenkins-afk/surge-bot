/**
 * Owner, 8 Nov 2026: a stake changed by hand starts a strategy's wait afresh, like a Live switch; and a suggestion can be
 * ignored for 24 hours.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { SNOOZE_HOURS, snoozeAdvice, snoozedAdvice, strategyAdvice, visibleAdvice } from "../src/server/strategy-advice";

const S = "Favourite pressure level";
const KEY = S.toLowerCase();
const alert = (n: number, result?: "hit" | "miss") =>
  [`🔔 ${S}`, "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80", ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : [])].join("\n");

/** A Live strategy switched on 20 days ago with 40 clearly losing bets 10 days ago: "back to Sim" is due. */
function losing() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 10_000 });
  const long = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const raw = JSON.parse(db.getSetting("sending")!) as Record<string, unknown>;
  db.setSetting("sending", JSON.stringify({ ...raw, modeSince: { [KEY]: long }, stakeSince: { [KEY]: long } }));
  for (let n = 1; n <= 40; n++) {
    const at = new Date(Date.now() - 10 * 86_400_000);
    const posted = new Date(at.getTime() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted, posted);
    buildFeed(db, { markSent: true, now: at });
    const r = n % 5 === 0 ? "hit" : "miss";
    db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), posted);
  }
  return db;
}
const back = (db: EngineDb, now = new Date()) => strategyAdvice(db, now).find((a) => a.key === KEY && a.kind === "back-to-sim");

test("a stake changed by hand is dated, and the strategy waits for new bets before being judged again", () => {
  const db = losing();
  assert.ok(back(db), "due before the change");
  saveSendingSettings(db, { stakes: { [KEY]: 0.5 } });
  assert.ok(getSendingSettings(db).stakeSince[KEY], "the change is dated");
  assert.equal(back(db), undefined, "after a stake change by hand: waits for bets at the new stake");
});

test("a suggestion ignored for 24 hours is hidden, listed as ignored, and back once the time is up or on request", () => {
  const db = losing();
  const now = new Date();
  assert.ok(visibleAdvice(db, now).some((a) => a.key === KEY && a.kind === "back-to-sim"));
  const until = snoozeAdvice(db, { key: KEY, kind: "back-to-sim" }, SNOOZE_HOURS, now);
  assert.equal(until, new Date(now.getTime() + 24 * 3_600_000).toISOString());
  assert.equal(visibleAdvice(db, now).some((a) => a.key === KEY && a.kind === "back-to-sim"), false, "hidden");
  assert.equal(snoozedAdvice(db, now)[0]?.key, KEY, "listed as ignored");
  assert.ok(visibleAdvice(db, new Date(now.getTime() + 25 * 3_600_000)).some((a) => a.key === KEY && a.kind === "back-to-sim"), "back after 24 hours");
  snoozeAdvice(db, { key: KEY, kind: "back-to-sim" }, 0, now);
  assert.ok(visibleAdvice(db, now).some((a) => a.key === KEY && a.kind === "back-to-sim"), "brought back by hand");
});
