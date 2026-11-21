/** The Today page from the report worker gets the engine thread's own Betfair, breaker and Telegram state back (21 Nov 2026). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLiveParts } from "../src/server/today";

test("the worker's stale Betfair link and Telegram health are replaced; everything else is kept", () => {
  const fromWorker = {
    at: "x",
    betting: { on: true, liveStrategies: 11, breaker: { open: false }, betfair: { configured: false, missing: [] } },
    alerts: { lastHour: 40, telegram: { ok: false } },
    today: { liveNet: -12.85 },
  };
  const live = { breaker: { open: true, reason: "r" }, betfair: { configured: true, missing: [], lastOkAt: "t" }, telegram: { ok: true } } as never;
  const out = withLiveParts(fromWorker, live) as typeof fromWorker & { betting: Record<string, unknown>; alerts: Record<string, unknown> };
  assert.deepEqual(out.betting.betfair, { configured: true, missing: [], lastOkAt: "t" });
  assert.deepEqual(out.betting.breaker, { open: true, reason: "r" });
  assert.deepEqual(out.alerts.telegram, { ok: true });
  assert.equal(out.betting.liveStrategies, 11);
  assert.equal(out.alerts.lastHour, 40);
  assert.deepEqual(out.today, { liveNet: -12.85 });
});
