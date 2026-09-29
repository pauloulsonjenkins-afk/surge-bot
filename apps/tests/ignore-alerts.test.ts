/**
 * Checks that the Telegram listener drops alerts for an ignored strategy, both live and in the catch-up
 * sync, while normal alerts still come through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { startTelegramListener } from "../src/telegram/listener";

const KEEP = "Blistering Momentum / Action-packed";
const OJ = "Blistering Momentum / Action-packed OJ";
const CHAT = "7777";

const alert = (strategy: string, n: number) =>
  [`🔔 ${strategy}`, "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "3.00 1.40"].join("\n");

test("an ignored strategy's alerts are not stored, live or by the catch-up sync; others are", async () => {
  const db = new EngineDb(":memory:", () => {});
  db.setStrategyIgnored(OJ, true);
  const now = Math.floor(Date.now() / 1000);

  const handlers: Array<(e: unknown) => Promise<void>> = [];
  const history = [
    { id: 1, date: now - 60, message: alert(OJ, 1) },     // ignored, only visible to the sync
    { id: 2, date: now - 50, message: alert(KEEP, 2) },   // normal
  ];
  const fakeClient: any = {
    connected: true,
    addEventHandler: (cb: (e: unknown) => Promise<void>) => handlers.push(cb),
    getMessages: async () => [...history].reverse(),
    getDialogs: async () => [],
    connect: async () => {},
  };
  await startTelegramListener(fakeClient, db, CHAT);
  await new Promise((r) => setTimeout(r, 50));

  // sync: the normal alert is caught up, the ignored one is not
  assert.deepEqual(db.listLivePicks(10).map((p) => p.messageId), [2]);

  // live: a new ignored alert and a new normal one arrive
  const live = (id: number, text: string) => ({ message: { chatId: 7777, id, date: now, message: text, getSender: async () => ({ username: "alerts" }) } });
  await handlers[0]!(live(3, alert(OJ, 3)));
  await handlers[0]!(live(4, alert(KEEP, 4)));
  assert.deepEqual(db.listLivePicks(10).map((p) => p.messageId).sort(), [2, 4]);

  // the ignored alert was dropped before anything was stored (not even the raw log)
  assert.equal(db.getLivePickText(CHAT, 3), null);
  assert.equal(db.getLivePickText(CHAT, 1), null);
});
