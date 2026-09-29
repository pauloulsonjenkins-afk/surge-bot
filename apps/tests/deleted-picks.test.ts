/**
 * Checks that a deleted strategy stays deleted: the Telegram catch-up sync and full-time edits must not
 * bring its alerts back, while genuinely new alerts still come in normally.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { startTelegramListener } from "../src/telegram/listener";

const OJ = "Blistering Momentum / Action-packed OJ";
const KEEP = "Blistering Momentum / Action-packed";
const CHAT = "7777";

const alert = (strategy: string, n: number, settled = false) =>
  [
    `🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "3.00 1.40",
    ...(settled ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", "Full-Time Score: 1-0", "", "✅ Hit"] : []),
  ].join("\n");

test("a deleted strategy stays deleted after the catch-up sync and after full-time edits", async () => {
  const db = new EngineDb(":memory:", () => {});
  const now = Math.floor(Date.now() / 1000);
  const put = (strategy: string, id: number) => db.upsertLivePick(CHAT, id, alert(strategy, id), parseAlert(alert(strategy, id)), new Date().toISOString());

  // these alerts were stored, then the strategy was deleted from the Strategies page
  put(OJ, 1); put(OJ, 2); put(OJ, 3); put(KEEP, 4);
  assert.equal(db.removeStrategyPicks(OJ).removed, 3);
  assert.deepEqual(db.listLivePicks(10).map((p) => p.messageId), [4]);

  // Telegram still has those messages in its recent history
  const history = [1, 2, 3].map((id) => ({ id, date: now - 600 + id, message: alert(OJ, id) })).concat([{ id: 4, date: now - 500, message: alert(KEEP, 4) }]);
  const handlers: Array<(e: unknown) => Promise<void>> = [];
  const fakeClient: any = {
    connected: true,
    addEventHandler: (cb: (e: unknown) => Promise<void>) => handlers.push(cb),
    getMessages: async () => [...history].reverse(),
    getDialogs: async () => [],
    connect: async () => {},
  };
  await startTelegramListener(fakeClient, db, CHAT);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(db.listLivePicks(10).map((p) => p.messageId), [4], "the sync must not bring the deleted alerts back");

  // hours later the full-time edit of a deleted alert arrives
  const edit = { message: { chatId: 7777, id: 2, date: now, message: alert(OJ, 2, true), getSender: async () => ({ username: "alerts" }) } };
  await handlers[1]!(edit);
  assert.deepEqual(db.listLivePicks(10).map((p) => p.messageId), [4], "a full-time edit must not bring a deleted alert back");

  // a genuinely new alert with the same strategy name is still accepted (unless the strategy is ignored)
  const fresh = { message: { chatId: 7777, id: 9, date: now, message: alert(OJ, 9), getSender: async () => ({ username: "alerts" }) } };
  await handlers[0]!(fresh);
  assert.deepEqual(db.listLivePicks(10).map((p) => p.messageId).sort((a, b) => a - b), [4, 9]);
});
