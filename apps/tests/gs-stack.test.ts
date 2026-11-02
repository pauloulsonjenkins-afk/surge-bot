/** The "GS" strategies (the Match Odds Stack, 2 Nov 2026): a favourite to win, and Over 1.5 from 0-0 and from 1-0. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlert } from "../src/inplayguru/parse-alert";

const make = (name: string, timer: string, goals: string, live1x2: string, extra: string[] = []) =>
  [`🔔 ${name}`, "", "🏴 England Premier League (2nd vs 9th)", "Arsenal vs Fulham", "", `Timer: ${timer}`, `Goals: ${goals}`, "1X2 Live Odds:", live1x2, "Over/Under 1.50 Odds:", "1.70 2.10", ...extra].join("\n");
const done = (ft: string) => ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${ft}`, "", "✅ Hit"];

test("GS Match Odds Fave is the favourite to win, graded on the score: a draw or the underdog winning loses", () => {
  const home = parseAlert(make("GS Match Odds Fave", "24'", "0 - 0", "1.80 3.60 4.50"));
  assert.equal(home.market, "FAVOURITE_TO_WIN");
  assert.equal(home.favourite, "home");
  const away = parseAlert(make("GS Match Odds Fave", "24'", "0 - 0", "4.50 3.60 1.80"));
  assert.equal(away.favourite, "away", "the shorter live price is the favourite, home or away");
  assert.equal(parseAlert(make("GS Match Odds Fave", "24'", "0 - 0", "1.80 3.60 4.50", done("2-1"))).result, "hit");
  assert.equal(parseAlert(make("GS Match Odds Fave", "24'", "0 - 0", "1.80 3.60 4.50", done("1-1"))).result, "miss");
  assert.equal(parseAlert(make("GS Match Odds Fave", "24'", "0 - 0", "4.50 3.60 1.80", done("0-2"))).result, "hit");
});

test("GS Over 1.5 at 0-0 and at 1-0 both back Over 1.5 goals in the match", () => {
  for (const [name, goals] of [["GS Over 1.5 at 0-0", "0 - 0"], ["GS Over 1.5 at 1-0", "1 - 0"]] as const) {
    const p = parseAlert(make(name, "35'", goals, "1.60 3.80 5.50"));
    assert.equal(p.market, "OVER_1_5", name);
    assert.equal(p.targetLine, 1.5);
    assert.deepEqual(p.flags.filter((f) => /already decided/.test(f)), [], `${name} at ${goals} is still open`);
  }
  assert.equal(parseAlert(make("GS Over 1.5 at 0-0", "35'", "0 - 0", "1.60 3.80 5.50", done("1-1"))).result, "hit");
  assert.equal(parseAlert(make("GS Over 1.5 at 1-0", "35'", "1 - 0", "1.60 3.80 5.50", done("1-0"))).result, "miss", "no second goal");
});

test("a GS alert is flagged once Over 1.5 is already decided", () => {
  assert.ok(parseAlert(make("GS Over 1.5 at 1-0", "35'", "2 - 0", "1.60 3.80 5.50")).flags.some((f) => /already decided/.test(f)));
});
