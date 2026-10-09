import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { planFor, readTips, tipsTick } from "../src/server/daily-tips";
import { getHorseImportStatus } from "../src/server/horses";

const PAGE = `<div><p>Thursday Tips&nbsp;-&nbsp;<strong>SINGLE STAKES</strong></p>
<p>NAP- 5.13 Ayr- Aighear- 1/1 (1.5 Points Win)</p>
<p>NB- 5.25 Bath- Courageous Sioux- 11/4 (1 Point Win)</p>
<p>Extra- 2.05 Bath- Go Go Girl- 3/1 (1 Point Win)</p>
<p>Extra- 4.38 Ayr- Blufferonthebus- 11/2 (0.5 Points Each-Way) *4 Places*</p>
<p>-----</p></div>`;

test("the tips page's four lines are read in order, with afternoon race times", () => {
  const t = readTips(PAGE);
  assert.deepEqual(
    t.map((x) => [x.horse, x.course, x.raceTime, x.odds, x.betType, x.ewPlaces]),
    [
      ["Aighear", "Ayr", "17:13", "1/1", "win", null],
      ["Courageous Sioux", "Bath", "17:25", "11/4", "win", null],
      ["Go Go Girl", "Bath", "14:05", "3/1", "win", null],
      ["Blufferonthebus", "Ayr", "16:38", "11/2", "ew", 4],
    ],
  );
});

test("today's moment falls between 10:00 and 14:00 UK, or straight away after the window", () => {
  const day = "2026-10-09"; // BST: 10:00 UK = 09:00 UTC
  for (const r of [0, 0.5, 0.999]) {
    const at = Date.parse(planFor(day, new Date("2026-10-09T05:00:00Z"), () => r).at);
    assert.ok(at >= Date.parse("2026-10-09T09:00:00Z") && at < Date.parse("2026-10-09T13:00:00Z"));
  }
  const late = new Date("2026-10-09T15:00:00Z");
  assert.equal(planFor(day, late).at, late.toISOString());
});

test("a run stores the tips once; later ticks the same day do nothing", async () => {
  const db = new EngineDb(":memory:", () => {});
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return readTips(PAGE);
  };
  const after = new Date("2026-10-09T14:30:00Z"); // past the window, so it runs at once
  await tipsTick(db, after, fetcher);
  await tipsTick(db, new Date(after.getTime() + 60_000), fetcher);
  assert.equal(calls, 1);
  assert.equal(db.listHorseSuggestions().length, 4);
  assert.equal(getHorseImportStatus(db)?.ok, true);
});

test("a failure is retried, and only reported after the last try", async () => {
  const db = new EngineDb(":memory:", () => {});
  const fail = async () => {
    throw new Error("Sign-in failed");
  };
  let t = new Date("2026-10-09T14:30:00Z").getTime();
  for (let i = 0; i < 3; i++) {
    await tipsTick(db, new Date(t), fail);
    if (i < 2) assert.equal(getHorseImportStatus(db), null);
    t += 21 * 60_000;
  }
  assert.equal(getHorseImportStatus(db)?.ok, false);
});
