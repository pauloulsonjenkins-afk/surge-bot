/**
 * Owner, 8 Nov 2026: "some leagues will perform better than others; build that into the strategies and slices, so we
 * get alerts only on performing Golden slices in green leagues". League form (inplayguru/league-form.ts and
 * server/league-form.ts), the league filter in the bet feed, and the alert filters (golden-notify.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb, type LivePick } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { getSendingSettings, leagueFilterAllows, recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { GREEN_FROM, getStoredLeagueForm, leagueLevel, levelOf, passesLeagueFilter, saveStoredLeagueForm, type StoredLeagueForm } from "../src/inplayguru/league-form";
import { computeLeagueForm, leagueFilterBacktest, leagueFormReport, refreshLeagueForm } from "../src/server/league-form";
import { goldenNotification, setGoldenNotify } from "../src/server/golden-notify";

const S = "Time to fight";
const KEY = S.toLowerCase();
const NOON = new Date("2026-10-20T11:00:00Z");

const LEAGUES = {
  fr: "🇫🇷 France Ligue 1 (3rd vs 9th)",
  de: "🇩🇪 Germany Bundesliga (3rd vs 9th)",
} as const;
const text = (lg: keyof typeof LEAGUES, n: number, ft?: string) =>
  [`🔔 ${S}`, "", LEAGUES[lg], `Home${n} ${n} vs Away${n} ${n}`, "", "Timer: 63'", "Goals: 2 - 0", "Over/Under 2.50 Odds:", "1.80 2.00", ...(ft ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${ft}`, "", ft === "3-0" ? "✅ Hit" : "❌ Miss"] : [])].join("\n");

/** Settled picks, oldest first: each league and whether it won. Returns the db and the next message number. */
function history(results: Array<[keyof typeof LEAGUES, boolean]>) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, dailyCap: 100_000 });
  const start = NOON.getTime() - (results.length + 2) * 3_600_000;
  recordSimBets(db, new Date(start - 60_000));
  results.forEach(([lg, won], i) => {
    const at = new Date(start + i * 3_600_000).toISOString();
    db.upsertLivePick("chat", i + 1, text(lg, i + 1), parseAlert(text(lg, i + 1)), at, at);
    recordSimBets(db, new Date(Date.parse(at) + 1000));
    const ft = won ? "3-0" : "2-0";
    db.upsertLivePick("chat", i + 1, text(lg, i + 1, ft), parseAlert(text(lg, i + 1, ft)), at);
  });
  return db;
}
const repeat = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

/** A fresh alert in a league, posted a minute before noon. */
function fresh(db: EngineDb, lg: keyof typeof LEAGUES, n = 999): LivePick {
  const at = new Date(NOON.getTime() - 60_000).toISOString();
  db.upsertLivePick("chat", n, text(lg, n), parseAlert(text(lg, n)), at, at);
  return db.getLivePickByMessage("chat", n)!;
}

const tally = (n: number, roi: number, spread = 0.9) => {
  // n returns per £1 of roi ± spread, alternating: mean roi, variance about spread².
  let sumR = 0;
  let sumR2 = 0;
  for (let i = 0; i < n; i++) {
    const r = roi + (i % 2 ? spread : -spread);
    sumR += r;
    sumR2 += r * r;
  }
  return { counted: n, staked: n, profit: roi * n, sumR, sumR2 };
};

test("levelOf: grey under 30, green / red after allowing for luck, proven / red on the whole range from 50", () => {
  assert.equal(levelOf(tally(29, 0.5)).level, "grey", "too few, however good");
  assert.equal(levelOf(tally(GREEN_FROM, 0.2)).level, "green", "+20% over 30: shrunk to +7.5%");
  assert.equal(levelOf(tally(GREEN_FROM, 0.04)).level, "grey", "+4% over 30 shrinks to +1.5%: not enough");
  assert.equal(levelOf(tally(GREEN_FROM, -0.2)).level, "red");
  assert.equal(levelOf(tally(200, 0.3, 0.5)).level, "proven", "range well above zero");
  assert.equal(levelOf(tally(200, -0.3, 0.5)).level, "red", "range well below zero");
  assert.equal(levelOf(tally(0, 0)).level, "grey");
});

test("passesLeagueFilter: skip red lets grey through; green only needs green or proven", () => {
  for (const l of ["proven", "green", "grey", "red"] as const) assert.equal(passesLeagueFilter("off", l), true);
  assert.deepEqual((["proven", "green", "grey", "red"] as const).map((l) => passesLeagueFilter("notRed", l)), [true, true, true, false]);
  assert.deepEqual((["proven", "green", "grey", "red"] as const).map((l) => passesLeagueFilter("greenOnly", l)), [true, true, false, false]);
});

// Ligue 1 wins 3 in 4 at 1.80 (+35% per £1); the Bundesliga loses 3 in 4 (−55%).
const MIXED: Array<[keyof typeof LEAGUES, boolean]> = repeat(80, (i) => [i % 2 ? "fr" : "de", i % 2 ? i % 8 !== 1 : i % 8 === 0]);

test("league form: Ligue 1 green or proven, Bundesliga red, stored for the bet feed and notifications", () => {
  const db = history(MIXED);
  const form = computeLeagueForm(db);
  const fr = Object.entries(form.strategies[KEY] ?? {}).find(([k]) => form.names[k]?.league.includes("Ligue 1"));
  const de = Object.entries(form.strategies[KEY] ?? {}).find(([k]) => form.names[k]?.league.includes("Bundesliga"));
  assert.ok(fr && de, JSON.stringify(form));
  assert.equal(fr[1].n, 40);
  assert.ok(fr[1].level === "green" || fr[1].level === "proven", `Ligue 1: ${JSON.stringify(fr[1])}`);
  assert.equal(de[1].level, "red", `Bundesliga: ${JSON.stringify(de[1])}`);
  assert.equal(getStoredLeagueForm(db), null, "nothing stored until refreshed");
  refreshLeagueForm(db, NOON);
  assert.equal(leagueLevel(getStoredLeagueForm(db), S, fr[0])?.level, fr[1].level);
  const report = leagueFormReport(db);
  assert.ok(report.strategies[KEY]!.backtest, "the backtest is stored with the form");
  assert.notEqual(report.strategies[KEY]!.leagues[0]!.level, "red", "best first");
});

test("backtest is walk-forward: a league's first 30 picks are never in 'green only'", () => {
  const db = history(MIXED);
  const bt = leagueFilterBacktest(db)[KEY]!;
  assert.equal(bt.off.n, 80);
  // Each league is grey for its first 30 picks, so green only can have at most Ligue 1's last 10.
  assert.ok(bt.greenOnly.n <= 10, `green only: ${JSON.stringify(bt.greenOnly)}`);
  // Skip red keeps everything until the Bundesliga turns red at 30, then drops its last 10.
  assert.ok(bt.notRed.n >= 70 && bt.notRed.n < 80, `skip red: ${JSON.stringify(bt.notRed)}`);
  assert.ok(bt.notRed.roi! > bt.off.roi!, "skipping the losing league helped here");
});

test("bet feed league filter: strategy setting, a slice's own, and a slice's own 'all leagues'", () => {
  const db = history(MIXED);
  refreshLeagueForm(db, NOON);
  const form = getStoredLeagueForm(db);
  const de = fresh(db, "de", 900);
  const fr = fresh(db, "fr", 901);
  const seg = { key: KEY, id: "two-apart" };
  let s = getSendingSettings(db);
  assert.deepEqual(s.leagueFilter, {}, "off by default");
  assert.equal(leagueFilterAllows(s, form, de, null).ok, true);
  s = saveSendingSettings(db, { leagueFilter: { [KEY]: "notRed" } });
  assert.equal(leagueFilterAllows(s, form, de, null).ok, false, "red league skipped");
  assert.equal(leagueFilterAllows(s, form, fr, null).ok, true);
  assert.equal(leagueFilterAllows(s, form, de, seg).ok, false, "a slice follows its strategy");
  s = saveSendingSettings(db, { leagueFilter: { [`${KEY}#two-apart`]: "off" } });
  assert.equal(leagueFilterAllows(s, form, de, seg).ok, true, "the slice's own 'all leagues' wins");
  assert.equal(leagueFilterAllows(s, form, de, null).ok, false, "the strategy keeps its filter");
  s = saveSendingSettings(db, { leagueFilter: { [KEY]: "off", [`${KEY}#two-apart`]: null } });
  assert.deepEqual(s.leagueFilter, {}, "cleared");
  assert.equal(leagueFilterAllows(s, null, de, null).ok, true, "no form stored: nothing is filtered");
});

test("alerts: green leagues only, with a league line; only slices still holding up", () => {
  const db = history(MIXED);
  refreshLeagueForm(db, NOON);
  const slice = { id: "two-apart", label: "Golden: 2+ goals apart" };
  setGoldenNotify(db, { allSlices: true });
  const de = fresh(db, "de", 900);
  const fr = fresh(db, "fr", 901);
  const m = goldenNotification(db, de, [slice], NOON);
  assert.ok(m, "any league by default");
  assert.match(m!.body, /Bundesliga: red for this strategy, −[\d.]+% per £1 over 40/);
  setGoldenNotify(db, { leagues: "greenOnly" });
  assert.equal(goldenNotification(db, de, [slice], NOON), null, "red league: no alert");
  assert.ok(goldenNotification(db, fr, [slice], NOON), "green league: alert");
  setGoldenNotify(db, { holdingOnly: true });
  assert.equal(goldenNotification(db, fr, [slice], NOON), null, "slice not holding a stage");
  db.setSetting("golden_badges", JSON.stringify({ [`${KEY}#two-apart`]: { stage: "golden" } }));
  assert.ok(goldenNotification(db, fr, [slice], NOON), "holding: alert");
  db.setSetting("golden_badges", JSON.stringify({ [`${KEY}#two-apart`]: { stage: "golden", lostAt: NOON.toISOString() } }));
  assert.equal(goldenNotification(db, fr, [slice], NOON), null, "slipped: no alert");
});

test("a stored form with a strategy that has never played a league counts it grey", () => {
  const db = new EngineDb(":memory:", () => {});
  const form: StoredLeagueForm = { at: NOON.toISOString(), strategies: { [KEY]: {} }, names: {} };
  saveStoredLeagueForm(db, form);
  const p = fresh(db, "fr");
  const s = saveSendingSettings(db, { leagueFilter: { [KEY]: "greenOnly" } });
  assert.equal(leagueFilterAllows(s, getStoredLeagueForm(db), p, null).ok, false);
  assert.equal(leagueFilterAllows(saveSendingSettings(db, { leagueFilter: { [KEY]: "notRed" } }), getStoredLeagueForm(db), p, null).ok, true);
});
