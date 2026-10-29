/** The half-time entry strategies from the Telegram group (29 Oct 2026): "1 Goal" is the next goal, "2 Goals" is two more goals. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlert } from "../src/inplayguru/parse-alert";

/** The alert carries the Over/Under line for its own bet: goals so far + 0.5 for a next goal, + 1.5 for two more. */
const make = (name: string, goals: string, extra: string[] = []) => {
  const line = /^(?:away super fav 2|og 2)/i.test(name) ? "2.50" : "1.50";
  return [`🔔 ${name}`, "", "🇫🇷 France Ligue 1", "Lyon vs Nantes", "", "Timer: 46'", `Goals: ${goals}`, `Over/Under ${line} Odds:`, "1.60 2.30", ...extra].join("\n");
};
const done = (ft: string) => ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${ft}`, "", "✅ Hit"];

test("the 1 Goal versions are next-goal bets on the line above the score", () => {
  for (const name of ["Away Super Fav 1 Goal", "OG 1 Goal SH"]) {
    const p = parseAlert(make(name, "1 - 0"));
    assert.equal(p.market, "NEXT_GOAL", name);
    assert.equal(p.targetLine, 1.5, "goals so far + 0.5");
    assert.deepEqual(p.flags, []);
  }
});

test("the 2 Goals versions are two-more-goals bets on the line 1.5 above the score", () => {
  for (const name of ["Away Super Fav 2 Goals", "OG 2 SHG"]) {
    const p = parseAlert(make(name, "1 - 0"));
    assert.equal(p.market, "TWO_MORE_GOALS", name);
    assert.equal(p.targetLine, 2.5, "goals so far + 1.5");
  }
  assert.equal(parseAlert(make("OG 2 SHG", "1 - 0", done("2-1"))).result, "hit", "two more goals came");
  assert.equal(parseAlert(make("OG 2 SHG", "1 - 0", done("2-0"))).result, "miss", "only one more");
});
