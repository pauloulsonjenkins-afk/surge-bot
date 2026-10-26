/**
 * Golden: statuses, watching a finder suggestion (it becomes a slice from today), and the finder itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { autoWatchGoldenFinds, CANDIDATE_FROM, findGolden, FULL_FROM, goldenReport, loadCustomSegments, TRIAL_FROM, unwatchSegment, watchSegment } from "../src/server/golden";
import { segmentsOf, setCustomSegments } from "../src/server/segments";

const alert = (n: number, goals: string, result: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", `Goals: ${goals}`,
    `Over/Under ${goals === "0 - 0" ? "0.50" : "1.50"} Odds:`, "2.00 1.80", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "9-9" : goals.replace(" - ", "-")}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");

test("watching a suggestion adds a slice from today; stopping removes it; built-in ones can't be stopped", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  loadCustomSegments(db);
  watchSegment(db, "Blistering Momentum", ["score00"]);
  assert.ok(segmentsOf("blistering momentum").some((s) => s.label === "Golden: 0-0" && s.custom));
  assert.ok(goldenReport(db, new Date(), { skipFinder: true }).slices.some((s) => s.strategyKey === "blistering momentum" && s.id === "f-score00"), "shows straight away, before anything settles");
  assert.throws(() => watchSegment(db, "blistering momentum", ["score00"]), /already/);
  unwatchSegment(db, "blistering momentum", "f-score00");
  assert.equal(segmentsOf("blistering momentum").length, 0);
  assert.throws(() => unwatchSegment(db, "favourite pressure 2nd half", "golden"), /Only slices added/);
  assert.ok(goldenReport(db).suggestions);
});

test("the finder suggests a slice that beat the rest in both halves of the record, and not when it doesn't", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 1 }, dailyCap: 1000 });
  recordSimBets(db, new Date(Date.now() - 120_000)); // Sim recording starts before the alerts
  // 0-0 alerts win 80%, the rest 35%, all at evens: 0-0 is clearly better, in both halves.
  for (let n = 1; n <= 200; n++) {
    const zero = n % 2 === 0;
    const win = zero ? n % 10 !== 0 && n % 10 !== 6 : n % 20 < 7;
    const goals = zero ? "0 - 0" : "1 - 0";
    const at = new Date(Date.now() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n, goals, win ? "hit" : "miss").split("\n\n⸻")[0]!, parseAlert(alert(n, goals, win ? "hit" : "miss").split("\n\n⸻")[0]!), at);
    recordSimBets(db);
    db.upsertLivePick("chat", n, alert(n, goals, win ? "hit" : "miss"), parseAlert(alert(n, goals, win ? "hit" : "miss")), at);
  }
  const found = findGolden(db);
  assert.ok(found.some((g) => g.strategyKey === "blistering momentum" && g.rule.includes("score00")), JSON.stringify(found.map((g) => g.label)));
  assert.ok(!found.some((g) => g.rule.length === 1 && g.rule[0] === "apart1"), "the losing slice isn't suggested");
});

test("the finder's own ideas are watched at once, quietly, in their own section until they reach the candidate threshold", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 1 }, dailyCap: 1000 });
  recordSimBets(db, new Date(Date.now() - 120_000));
  for (let n = 1; n <= 200; n++) {
    const zero = n % 2 === 0;
    const win = zero ? n % 10 !== 0 && n % 10 !== 6 : n % 20 < 7;
    const goals = zero ? "0 - 0" : "1 - 0";
    const at = new Date(Date.now() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n, goals, win ? "hit" : "miss").split("\n\n⸻")[0]!, parseAlert(alert(n, goals, win ? "hit" : "miss").split("\n\n⸻")[0]!), at);
    recordSimBets(db);
    db.upsertLivePick("chat", n, alert(n, goals, win ? "hit" : "miss"), parseAlert(alert(n, goals, win ? "hit" : "miss")), at);
  }
  const added = autoWatchGoldenFinds(db);
  assert.ok(added.some((c) => c.strategyKey === "blistering momentum" && c.auto === true), "a finder idea is watched straight away, marked as the finder's own");
  const report = goldenReport(db, new Date(), { skipFinder: true });
  const slice = report.slices.find((s) => s.strategyKey === "blistering momentum" && s.auto);
  assert.ok(slice, "shows on the report");
  assert.equal(slice!.quiet, true, "nothing settled since today, so it's still in the quiet section");
  // Running the finder again doesn't re-suggest (and so doesn't re-watch) the same idea.
  assert.equal(autoWatchGoldenFinds(db).length, 0);
});

test("a slice built from mixed-case features (favDa2x, favLevel, notJapanBrazil) keeps a lower-case id, so its own betting setting is found", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  const c = watchSegment(db, "Favourite Pressure 2nd Half", ["favDa2x", "favLevel", "notJapanBrazil"]);
  assert.equal(c.id, "f-favda2x+favlevel+notjapanbrazil");
  saveSendingSettings(db, { segmentBets: { "favourite pressure 2nd half#f-favDa2x+favLevel+notJapanBrazil": { live: true, stakePct: 2 } } });
  const slice = goldenReport(db, new Date(), { skipFinder: true }).slices.find((s) => s.strategyKey === "favourite pressure 2nd half" && s.id === c.id);
  assert.ok(slice, "the watched slice shows on the report");
  assert.equal(slice!.bet?.live, true, "its own betting setting is found despite the mixed-case id it was set with");
  assert.equal(slice!.bet?.stakePct, 2);
});

test("a watched slice's stages: quiet, then candidate at 50, trial at 150 (both halves in profit), full at 300 (its Live trial also in profit)", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "time to fight": 1 }, strategies: { "time to fight": false }, dailyCap: 1000 });
  // Bet it Live on its own from the start, so its Live trial record is the same as its overall one.
  saveSendingSettings(db, { segmentBets: { "time to fight#two-apart": { live: true } } });
  const alert = (n: number, result?: "hit" | "miss") =>
    [
      "🔔 Time to fight", "", "🇫🇷 France Ligue 1", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 2 - 0", "Over/Under 2.50 Odds:", "2.00 1.80",
      ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 1-0", `Full-Time Score: ${result === "hit" ? "3-0" : "2-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
    ].join("\n");
  const status = () => goldenReport(db, new Date(), { skipFinder: true }).slices.find((s) => s.id === "two-apart")!;
  let n = 0;
  // Two wins in three at 2.00: comfortably in profit, the same pattern throughout (so both halves hold up too).
  const add = (count: number) =>
    Array.from({ length: count }, (_, i) => (i % 3 === 2 ? "miss" : "hit") as const).forEach((r) => {
      n++;
      const at = new Date(Date.now() + n * 1000).toISOString();
      db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), at);
      buildFeed(db, { markSent: true });
      db.upsertLivePick("chat", n, alert(n, r), parseAlert(alert(n, r)), at);
    });
  add(CANDIDATE_FROM - 10);
  assert.equal(status().status, "quiet");
  add(10);
  assert.equal(status().status, "candidate");
  add(TRIAL_FROM - CANDIDATE_FROM);
  assert.equal(status().status, "trial");
  add(FULL_FROM - TRIAL_FROM);
  assert.equal(status().status, "full");
});
