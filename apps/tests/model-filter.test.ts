import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { notifyAdvice, strategyAdvice } from "../src/server/strategy-advice";

const NOW = new Date();
const alert = (home: string) =>
  ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `${home} vs Lille`, "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");

/** A model that just repeats the market's chance, plus `bias` on the log-odds scale. */
function useModel(db: EngineDb, bias: number) {
  db.setSetting(
    "goal_model_active",
    JSON.stringify({ weights: [1, 0, 0, 0, 0, 0, 0, 0], bias, mu: [0, 0, 0, 0, 0, 0, 0, 0], sd: [1, 1, 1, 1, 1, 1, 1, 1], n: 500, trainedAt: NOW.toISOString(), version: "v1 (test)" }),
  );
}

function setup(filter: boolean) {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 2 }, strategies: { "blistering momentum": true }, modelFilter: { "blistering momentum": filter } });
  db.upsertLivePick("chat", 1, alert("Lens"), parseAlert(alert("Lens")), new Date(NOW.getTime() - 60_000).toISOString());
  return db;
}

test("with the model filter on, a pick the model sees no edge in is held back, with the reason", () => {
  const db = setup(true);
  useModel(db, 0); // the market's own chance: below what 1.80 needs after commission
  const feed = buildFeed(db, { markSent: true, now: NOW });
  assert.equal(feed.newlySent, 0);
  assert.ok(feed.skipped.some((s) => s.reason.startsWith("Model sees no edge")));
});

test("with the filter on, a pick the model rates well goes ahead", () => {
  const db = setup(true);
  useModel(db, 1.5);
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).newlySent, 1);
});

test("with the filter off (the default), the model changes nothing", () => {
  const db = setup(false);
  useModel(db, 0);
  assert.equal(buildFeed(db, { markSent: true, now: NOW }).newlySent, 1);
});

test("strategy suggestions: nothing to say on an empty database, and nothing is sent", async () => {
  const db = new EngineDb(":memory:", () => {});
  assert.deepEqual(strategyAdvice(db), []);
  assert.equal(await notifyAdvice(db), 0);
});
