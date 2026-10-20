/**
 * Automatic stakes on: a raise happens by itself, and the NEXT step is not offered as a suggestion straight after
 * (17 Oct 2026: "Stake raised to 1.5%" and "worth a bigger stake (raise to 2%)" arrived in the same minute).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { autoApplyStakes, autoStakeQueue, AUTO_GAP_MS, strategyAdvice, visibleAdvice } from "../src/server/strategy-advice";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();
const alert = (n: number, result?: "hit" | "miss") =>
  [
    `🔔 ${S}`,
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `Home ${n} vs Away ${n}`,
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

function winner() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 1000 });
  for (let n = 1; n <= 60; n++) {
    const posted = new Date(Date.now() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted);
    buildFeed(db, { markSent: true });
    const r = n % 4 === 0 ? "miss" : "hit";
    db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), posted);
  }
  return db;
}

test("without automatic stakes, a raise is a suggestion", () => {
  const db = winner();
  assert.ok(visibleAdvice(db).some((a) => a.kind === "stake-up"));
  assert.deepEqual(autoStakeQueue(db), []);
});

test("the suggestions shown are reused for two minutes, and worked out again when a setting changes or time is up", () => {
  const db = winner();
  const now = new Date();
  const first = visibleAdvice(db, now);
  assert.ok(first.some((a) => a.kind === "stake-up"));
  assert.equal(visibleAdvice(db, new Date(now.getTime() + 60_000)).length, first.length, "same answer a minute later");
  // A setting it depends on: the stake. The raise from £1 now goes to the step after £2.
  saveSendingSettings(db, { stakes: { [KEY]: 2 } });
  const after = visibleAdvice(db, new Date(now.getTime() + 61_000)).find((a) => a.kind === "stake-up");
  assert.equal(after?.action, "Raise to £3", "worked out again after the stake changed");
  // Two minutes on with nothing changed: worked out again (the same here, as no results changed).
  assert.ok(visibleAdvice(db, new Date(now.getTime() + 3 * 60_000)).some((a) => a.kind === "stake-up"));
});

test("with automatic stakes, the raise happens, and the next step waits a week as a note, not a suggestion", () => {
  const db = winner();
  saveSendingSettings(db, { ladderAuto: true });
  const now = new Date();
  assert.equal(autoApplyStakes(db, now).length, 1);
  assert.equal(getSendingSettings(db).stakes[KEY], 2);
  assert.ok(strategyAdvice(db, now).some((a) => a.kind === "stake-up"), "the ladder still sees the next step");
  assert.equal(visibleAdvice(db, now).filter((a) => a.kind === "stake-up" || a.kind === "stake-down").length, 0, "but it isn't suggested");
  const q = autoStakeQueue(db, now);
  assert.equal(q.length, 1);
  assert.equal(Date.parse(q[0]!.due), now.getTime() + AUTO_GAP_MS);
  assert.equal(autoApplyStakes(db, new Date(now.getTime() + 3_600_000)).length, 0, "nothing more within the week");
});
