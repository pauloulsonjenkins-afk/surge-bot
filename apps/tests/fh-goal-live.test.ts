/** The "FH Goal" strategies (29 Oct 2026): an in-play first-half goal, Over 0.5 first-half goals from 0-0. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

const make = (name: string, timer: string, goals: string, extra: string[] = []) =>
  [`🔔 ${name}`, "", "🇫🇷 France Ligue 1", "Lyon vs Nantes", "", `Timer: ${timer}`, `Goals: ${goals}`, "Corners: 2 - 3", "", ...extra].join("\n");
const done = (ht: string) => ["⸻⸻ Match Summary ⸻⸻", "", `Half-Time Score: ${ht}`, "Full-Time Score: 2-1", "", "✅ Hit"];

test("both FH Goal strategies are in-play first-half goal bets, and are not read as the pre-match one", () => {
  for (const name of ["FH Goal xG Game State", "FH Goal 15-30 Spin"]) {
    const p = parseAlert(make(name, "24'", "0 - 0"));
    assert.equal(p.market, "FIRST_HALF_GOAL_LIVE", name);
    assert.equal(p.targetLine, 0.5);
    assert.equal(p.selection, "Over 0.5 first-half goals");
    assert.deepEqual(p.flags, []);
    assert.equal(p.sendable, true);
  }
});

test("it is flagged once a goal is in or the first half is over", () => {
  assert.ok(parseAlert(make("FH Goal xG Game State", "24'", "1 - 0")).flags.some((f) => /already decided/.test(f)));
  assert.ok(parseAlert(make("FH Goal xG Game State", "47'", "0 - 0")).flags.some((f) => /first half is over/.test(f)));
});

test("it settles on the half-time score, not the full-time one", () => {
  assert.equal(parseAlert(make("FH Goal 15-30 Spin", "24'", "0 - 0", done("1-0"))).result, "hit");
  assert.equal(parseAlert(make("FH Goal 15-30 Spin", "24'", "0 - 0", done("0-0"))).result, "miss", "goals after half-time do not count");
});

test("it is handed to the betting software as the first-half goals market", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, strategies: { "fh goal 15-30 spin": true }, stakes: { "fh goal 15-30 spin": 1 } });
  const text = make("FH Goal 15-30 Spin", "24'", "0 - 0");
  db.upsertLivePick("c", 1, text, parseAlert(text), new Date().toISOString(), new Date().toISOString());
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows.length, 1);
  assert.equal(feed.rows[0]?.marketType, "FIRST_HALF_GOALS_05");
});
