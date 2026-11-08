/**
 * Owner, 8 Nov 2026: alerts on games where the strategy is doing well that day, and on any Golden slice without
 * switching each one on (golden-notify.ts). One notification per alert, saying why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { goldenNotification, HOT_MIN_SETTLED, setGoldenNotify, todayForm } from "../src/server/golden-notify";

const S = "Time to fight";
const KEY = S.toLowerCase();
const NOON = new Date("2026-10-20T11:00:00Z"); // 12:00 UK
const text = (n: number, ft?: string) =>
  [`🔔 ${S}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Lyon ${n} vs Nice ${n}`, "", "Timer: 63'", "Goals: 2 - 0", "Over/Under 2.50 Odds:", "1.80 2.00", ...(ft ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${ft}`, "", ft === "3-0" ? "✅ Hit" : "❌ Miss"] : [])].join("\n");

/** Earlier today's results for the strategy (each "won" or "lost"), then a new alert just in. */
function day(results: Array<"won" | "lost">) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, dailyCap: 10_000 });
  recordSimBets(db, new Date(NOON.getTime() - 4 * 3_600_000));
  results.forEach((r, i) => {
    const at = new Date(NOON.getTime() - (3 - i * 0.2) * 3_600_000).toISOString();
    db.upsertLivePick("chat", i + 1, text(i + 1), parseAlert(text(i + 1)), at, at);
    recordSimBets(db, new Date(Date.parse(at) + 1000));
    const ft = r === "won" ? "3-0" : "2-0";
    db.upsertLivePick("chat", i + 1, text(i + 1, ft), parseAlert(text(i + 1, ft)), at);
  });
  const at = new Date(NOON.getTime() - 60_000).toISOString();
  db.upsertLivePick("chat", 99, text(99), parseAlert(text(99)), at, at);
  return { db, p: db.getLivePickByMessage("chat", 99)! };
}

test("doing well today: 3+ settled, up and above break-even; notified once it's switched on", () => {
  const { db, p } = day(["won", "won", "lost", "won"]);
  const f = todayForm(db, KEY, NOON);
  assert.ok(f && f.settled === 4 && f.won === 3 && f.hot, `form: ${JSON.stringify(f)}`);
  assert.equal(goldenNotification(db, p, [], NOON), null, "off by default");
  setGoldenNotify(db, { hotToday: true });
  const m = goldenNotification(db, p, [], NOON);
  assert.ok(m);
  assert.match(m!.title, /^Doing well today · /);
  assert.match(m!.body, /Today: 3 of 4 won · \+[\d.]+u/);
  assert.equal(m!.muteSlice, undefined, "not a slice, so no slice mute");
});

test("not doing well: losing today, or too few settled yet", () => {
  const losing = day(["lost", "won", "lost", "lost"]);
  setGoldenNotify(losing.db, { hotToday: true });
  assert.equal(goldenNotification(losing.db, losing.p, [], NOON), null, "losing today");
  const few = day(["won", "won"]);
  setGoldenNotify(few.db, { hotToday: true });
  assert.ok(HOT_MIN_SETTLED > 2);
  assert.equal(goldenNotification(few.db, few.p, [], NOON), null, "only two settled");
});

test("every Golden slice: any watched slice counts without its own switch; both reasons in one notification", () => {
  const { db, p } = day(["won", "won", "won"]);
  const slice = { id: "two-apart", label: "Golden: 2+ goals apart" };
  assert.equal(goldenNotification(db, p, [slice], NOON), null);
  setGoldenNotify(db, { allSlices: true });
  const m = goldenNotification(db, p, [slice], NOON)!;
  assert.match(m.title, /^Golden alert · /);
  assert.doesNotMatch(m.body, /Today:/, "doing-well switch still off");
  setGoldenNotify(db, { hotToday: true });
  const both = goldenNotification(db, p, [slice], NOON)!;
  assert.match(both.body, /2\+ goals apart\nToday: 3 of 3 won/);
});
