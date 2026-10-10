import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { alertOddsOf } from "../src/server/pricing";

const ALERT = [
  "🔔 Away Win Lay",
  "",
  "🏴 Scotland Championship",
  "Raith vs Queen's Park",
  "",
  "⌛ Kickoff: In 1 hour",
  "",
  "1X2 Pre-Match Odds:",
  "1.85 3.60 4.50",
].join("\n");
const settled = (ft: string) => [ALERT, "", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 0-0", `Full-Time Score: ${ft}`, "", "✅ Hit"].join("\n");

test("an Away Win Lay alert is read as a pre-match lay, with no timer or score needed", () => {
  const p = parseAlert(ALERT);
  assert.equal(p.market, "AWAY_WIN_LAY");
  assert.equal(p.selection, "Lay the away side (home or draw)");
  assert.deepEqual(p.flags, []);
  assert.equal(p.kickoffRaw, "In 1 hour");
});

test("it settles from the final score: a home win or draw wins, an away win loses", () => {
  assert.equal(parseAlert(settled("2-1")).result, "hit");
  assert.equal(parseAlert(settled("1-1")).result, "hit");
  assert.equal(parseAlert(settled("0-2")).result, "miss");
});

test("priced as a lay: at 4.50, £1 liability wins £1/3.5, i.e. back odds of 4.5/3.5", () => {
  const odds = alertOddsOf({ market: "AWAY_WIN_LAY", targetLine: null, overLine: null, overOdds: null, favouriteOdds: null, layOdds: 4.5 });
  assert.equal(odds, Math.round((4.5 / 3.5) * 1000) / 1000);
});
