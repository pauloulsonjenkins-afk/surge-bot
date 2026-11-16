/** Horse tip results (server/horse-bsp.ts): tipped horses looked up in Betfair's starting-price files. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { findRunner, parseBsp, settleHorseTips, tipPoints } from "../src/server/horse-bsp";

const HEAD = "event_id,menu_hint,event_name,event_dt,selection_id,selection_name,win_lose,bsp,ppwap,morningwap";
const WIN = [
  HEAD,
  '1,Newmarket 14th Nov,7f Hcap,14-11-2026 14:30,11,Gorgeous Mr George,1,5.00,5,5',
  '1,Newmarket 14th Nov,7f Hcap,14-11-2026 14:30,12,Highland Frost,0,18.00,15,15',
  '2,Ascot 14th Nov,2m Hrd,14-11-2026 13:50,21,"Mr Rafiki (IRE)",0,20.00,21,17',
].join("\n");
const PLACE = [
  HEAD,
  '3,Newmarket 14th Nov,7f Hcap Place,14-11-2026 14:30,11,Gorgeous Mr George,1,1.80,2,2',
  '3,Newmarket 14th Nov,7f Hcap Place,14-11-2026 14:30,12,Highland Frost,1,4.00,4,4',
].join("\n");

test("a BSP file is read, and a runner found by name", () => {
  const rows = parseBsp(WIN);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.won, true);
  assert.equal(rows[2]!.horse, "Mr Rafiki (IRE)");
  assert.equal(findRunner(rows, { horse: "mr rafiki", course: null, raceTime: null })?.bsp, 20);
  assert.equal(findRunner(rows, { horse: "Nobody", course: null, raceTime: null }), null);
  assert.deepEqual(parseBsp("not,the,right,columns\n1,2,3,4"), []);
});

test("a tipster's spelling slip still finds the runner, only at the tipped course", () => {
  const rows = parseBsp(WIN);
  assert.equal(findRunner(rows, { horse: "Gorgous Mr Gorge", course: "Newmarket", raceTime: null })?.horse, "Gorgeous Mr George");
  assert.equal(findRunner(rows, { horse: "Gorgous Mr Gorge", course: "Ascot", raceTime: null }), null);
  assert.equal(findRunner(rows, { horse: "Gorgous Mr Gorge", course: null, raceTime: null }), null);
  assert.equal(findRunner(rows, { horse: "Highland Frosty Morn", course: "Newmarket", raceTime: null }), null);
});

test("level-stakes points: win and each-way, 2% commission on winnings", () => {
  assert.ok(Math.abs(tipPoints({ betType: "win", result: "won", bsp: 5, placed: null, placeBsp: null })!.profit - 3.92) < 1e-9);
  assert.equal(tipPoints({ betType: "win", result: "lost", bsp: 5, placed: null, placeBsp: null })!.profit, -1);
  // Each way: wins and places = 3.92 + 0.784; lost but placed = -1 + 0.94; neither = -2.
  assert.ok(Math.abs(tipPoints({ betType: "ew", result: "won", bsp: 5, placed: true, placeBsp: 1.8 })!.profit - 4.704) < 1e-9);
  assert.ok(Math.abs(tipPoints({ betType: "ew", result: "lost", bsp: 18, placed: true, placeBsp: 4 })!.profit - (-1 + 3 * 0.98)) < 1e-9);
  assert.equal(tipPoints({ betType: "ew", result: "lost", bsp: 18, placed: false, placeBsp: 4 })!.profit, -2);
  assert.equal(tipPoints({ betType: "ew", result: "won", bsp: 5, placed: null, placeBsp: null }), null, "no place file, no each-way figure");
  assert.equal(tipPoints({ betType: "win", result: "not found", bsp: null, placed: null, placeBsp: null }), null);
});

test("an earlier day's tips are looked up once its files are out, and not before", async () => {
  const db = new EngineDb(":memory:", () => {});
  db.replaceHorseSuggestions("2026-11-14", [
    { rank: 1, horse: "Gorgeous Mr George", course: "Newmarket", raceTime: "14:30", oddsText: "4/1", betType: "ew", ewPlaces: 3, points: "1", source: "t" },
    { rank: 2, horse: "Unlisted Horse", course: "Ayr", raceTime: "15:00", oddsText: "2/1", betType: "win", ewPlaces: null, points: "1", source: "t" },
  ] as never, "2026-11-14T08:00:00Z");
  const now = new Date("2026-11-15T09:00:00Z");

  // Files not published yet: nothing recorded, tried again next pass.
  assert.equal(await settleHorseTips(db, async () => null, now), 0);
  assert.equal(db.listHorseTipResults().length, 0);

  const files: Record<string, string> = { dwbfpricesukwin15112026: WIN, dwbfpricesukplace15112026: PLACE };
  const fetchText = async (url: string) => files[url.split("/").pop()!.replace(".csv", "")] ?? null;
  assert.equal(await settleHorseTips(db, fetchText, now), 2);
  const [first, second] = db.listHorseTipResults();
  assert.deepEqual([first!.result, first!.bsp, first!.placed, first!.placeBsp], ["won", 5, true, 1.8]);
  assert.equal(second!.result, "not found");
  // The found one is done; the unfound one is tried again once a day, however old the tip.
  assert.equal(await settleHorseTips(db, fetchText, now), 0);
  assert.equal(await settleHorseTips(db, fetchText, new Date("2026-11-16T10:00:00Z")), 1);
  assert.equal(await settleHorseTips(db, fetchText, new Date("2026-12-30T10:00:00Z")), 1);
  assert.equal(db.listHorseTipResults().filter((x) => x.result === "won").length, 1);
});
