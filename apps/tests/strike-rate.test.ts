/**
 * Strike Rate parsing (parse-alert.ts): InPlayGuru's own line, "Strike Rate: 78% overall (1,204 picks) · 71%
 * league (96 picks)". The league half is a second, independent figure fed to Claude's per-alert check alongside
 * GoalBrew's own thisStrategyInThisLeague (claude-check.ts) - added 28 Oct 2026.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlert } from "../src/inplayguru/parse-alert";

const alert = (strikeLine: string) =>
  ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00", "", `🎯 ${strikeLine}`].join("\n");

test("the full line gives the overall and league figures, with their sample sizes", () => {
  const p = parseAlert(alert("Strike Rate: 78% overall (1,204 picks) · 71% league (96 picks)"));
  assert.equal(p.strikeRate, 78);
  assert.equal(p.strikeRatePicks, 1204);
  assert.equal(p.strikeRateLeague, 71);
  assert.equal(p.strikeRateLeaguePicks, 96);
});

test("a decimal rate, and a bullet in place of the middle dot, both still parse", () => {
  const p = parseAlert(alert("Strike Rate: 78.5% overall (1,204 picks) • 71.2% league (96 picks)"));
  assert.equal(p.strikeRate, 78.5);
  assert.equal(p.strikeRateLeague, 71.2);
});

test("no league half yet: the overall figure still parses, the league one is null", () => {
  const p = parseAlert(alert("Strike Rate: 78% overall (1,204 picks)"));
  assert.equal(p.strikeRate, 78);
  assert.equal(p.strikeRatePicks, 1204);
  assert.equal(p.strikeRateLeague, null);
  assert.equal(p.strikeRateLeaguePicks, null);
});

test("the old plain format (no 'overall', no sample counts) still gives the overall % as before", () => {
  const p = parseAlert(alert("Strike Rate: 60%"));
  assert.equal(p.strikeRate, 60);
  assert.equal(p.strikeRatePicks, null);
  assert.equal(p.strikeRateLeague, null);
});

test("no Strike Rate line at all: every field is null, not an error", () => {
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  const p = parseAlert(text);
  assert.equal(p.strikeRate, null);
  assert.equal(p.strikeRateLeague, null);
});
