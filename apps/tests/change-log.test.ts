/** The changes log (inplayguru/change-log.ts): every switch and stake change, with who made it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";
import { listChanges, withChangeSource } from "../src/inplayguru/change-log";

test("each change is logged once, in words, with who made it", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { strategies: { "og 2 shg": true }, stakes: { "og 2 shg": 1.5 } });
  withChangeSource("Auto-adjust", () => saveSendingSettings(db, { strategies: { "og 2 shg": false } }));
  saveSendingSettings(db, { segmentBets: { "time to fight#s1": { live: true, stakePct: 1.5 } }, changedBy: "Claude check" });
  saveSendingSettings(db, { stakes: { "og 2 shg": 1.5 } }); // no change: nothing logged
  const log = listChanges(db);
  assert.deepEqual(
    log.map((c) => [c.by, c.key, c.change]),
    [
      ["Claude check", "time to fight#s1", "Trial → Real money"],
      ["Auto-adjust", "og 2 shg", "Real money → Trial"],
      ["You", "og 2 shg", "Trial → Real money"],
      ["You", "og 2 shg", "default → £1.5"],
    ],
  );
});

test("a source applies only inside its own call", () => {
  const db = new EngineDb(":memory:", () => {});
  withChangeSource("Golden safety", () => saveSendingSettings(db, { stakePct: { "early pressure with low score": 2 } }));
  saveSendingSettings(db, { stakePct: { "early pressure with low score": 3 } });
  assert.deepEqual(listChanges(db).map((c) => [c.by, c.change]), [["You", "2% → 3%"], ["Golden safety", "default → 2%"]]);
});
