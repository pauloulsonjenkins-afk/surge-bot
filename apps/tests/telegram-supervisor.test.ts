/**
 * 20 Oct 2026: after a morning of deploys the Telegram listener stayed off (no alerts, so no bets) until a restart. The
 * engine tried to connect once at start-up, and the backup lease's read-then-write could make the NEW container hand
 * over to the outgoing one and switch its own listener off for good. These check the retrying connection, the lease
 * rule that the newest container always keeps it, and that Today says what's wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeadSession, retryDelay, superviseTelegram, type Attempt, type ConnectState, RETRY_STEPS_MS, DEAD_SESSION_RETRY_MS } from "../src/telegram/supervisor";
import { shouldHandOver } from "../src/storage/spaces-sync";
import { telegramProblems } from "../src/server/telegram-watchdog";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the newest container keeps the lease: an outgoing one rewriting it doesn't make the new one hand over", () => {
  const now = 1_000_000;
  const me = { owner: "new", born: 900_000 };
  // The outgoing container (started earlier) wrote its lease just after ours: we keep going, it hands over.
  assert.equal(shouldHandOver({ owner: "old", at: now - 1_000, born: 100_000 }, me, now), false);
  assert.equal(shouldHandOver({ owner: "new", at: now - 1_000, born: 900_000 }, { owner: "old", born: 100_000 }, now), true);
  // A container from before this change has no start time: never treated as newer.
  assert.equal(shouldHandOver({ owner: "legacy", at: now - 1_000, born: 0 }, me, now), false);
  // Our own lease, or one not refreshed for 3 minutes: nothing to hand over to.
  assert.equal(shouldHandOver({ owner: "new", at: now, born: 900_000 }, me, now), false);
  assert.equal(shouldHandOver({ owner: "newer", at: now - 3 * 60_000, born: 950_000 }, me, now), false);
  assert.equal(shouldHandOver(null, me, now), false);
});

test("retries: 30 s, 1, 2, then every 5 minutes; a refused session only every 15 minutes", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => retryDelay(n, "TIMEOUT")), [...RETRY_STEPS_MS, 300_000, 300_000]);
  assert.equal(isDeadSession("406: AUTH_KEY_DUPLICATED"), true);
  assert.equal(isDeadSession("Connection closed"), false);
  assert.equal(retryDelay(1, "401: AUTH_KEY_UNREGISTERED"), DEAD_SESSION_RETRY_MS);
});

test("a failed connection is tried again until it connects, closing each failed client", async () => {
  const states: ConnectState[] = [];
  let tries = 0;
  let closed = 0;
  const sup = superviseTelegram({
    connect: (): Attempt => {
      tries++;
      const ready = tries < 3 ? Promise.reject(new Error("Connection closed")) : Promise.resolve();
      ready.catch(() => {});
      return { ready, close: async () => void closed++ };
    },
    onState: (s) => states.push(s),
    retryAfter: () => 5,
  });
  sup.start();
  await wait(100);
  assert.equal(tries, 3);
  assert.equal(closed, 2, "each failed attempt's client is shut down");
  assert.equal(states[0]?.error, "Connection closed");
  assert.equal(states[0]?.attempts, 1);
  assert.deepEqual(states.at(-1), { error: null, nextTryAt: null, dead: false, attempts: 0 });
  await sup.stop();
  assert.equal(closed, 3, "stopping shuts the connected client down too");
});

test("an attempt that never answers is abandoned after the time limit and its client shut down", async () => {
  const states: ConnectState[] = [];
  let closed = 0;
  const sup = superviseTelegram({
    connect: () => ({ ready: new Promise<void>(() => {}), close: async () => void closed++ }),
    onState: (s) => states.push(s),
    timeoutMs: 20,
    retryAfter: () => 60_000,
  });
  sup.start();
  await wait(60);
  assert.equal(closed, 1);
  assert.match(states[0]?.error ?? "", /no answer from Telegram/);
  await sup.stop();
});

test("no attempt when a listener is already attached (logged in again from the admin site)", async () => {
  let tries = 0;
  const sup = superviseTelegram({
    connect: () => {
      tries++;
      return { ready: Promise.resolve(), close: async () => {} };
    },
    onState: () => {},
    attachedElsewhere: () => true,
  });
  sup.start();
  await wait(10);
  assert.equal(tries, 0);
  await sup.stop();
});

test("Today says why the listener isn't connected, and what to do when Telegram refuses the saved login", () => {
  const started = new Date("2026-10-20T09:00:00Z");
  const now = new Date("2026-10-20T09:30:00Z");
  const base = { watching: null, lastSyncAt: null, lastSyncError: null };
  const retrying = telegramProblems({ now, startedAt: started, configured: true, listener: { ...base, connectError: "Connection closed", nextTryAt: "2026-10-20T09:35:00Z", sessionDead: false }, lastPickAt: null });
  assert.match(retrying[0]!, /last try failed \(Connection closed\)\. Trying again at 10:35\./);
  const dead = telegramProblems({ now, startedAt: started, configured: true, listener: { ...base, connectError: "AUTH_KEY_DUPLICATED", nextTryAt: null, sessionDead: true }, lastPickAt: null });
  assert.match(dead[0]!, /Log in again on Admin > Settings > Telegram/);
});
