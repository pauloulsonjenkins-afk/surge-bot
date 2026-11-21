/** Suggestions worked out on the report worker, finished on the engine's thread (strategy-advice.ts adviceFromComputed). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { adviceFromComputed, snoozeAdvice, type Advice } from "../src/server/strategy-advice";

const a = (key: string, kind: Advice["kind"]): Advice => ({ key, kind, reason: "r", action: "x" });

test("snoozed suggestions are set aside, and stake steps are hidden while automatic stakes are on", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { ladderAuto: true });
  const now = new Date("2026-11-21T16:00:00Z");
  snoozeAdvice(db, { key: "b", kind: "back-to-sim" }, 24, now);
  const out = adviceFromComputed(db, [a("a", "back-to-sim"), a("b", "back-to-sim"), a("c", "stake-down")], now);
  assert.deepEqual(out.advice.map((x) => x.key), ["a"]);
  assert.deepEqual(out.snoozed.map((x) => x.key), ["b"]);
  assert.ok(out.snoozed[0]!.until > now.toISOString());
});
