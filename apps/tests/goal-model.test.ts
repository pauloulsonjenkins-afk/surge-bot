import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { featuresOf, fit, modelReport, predict } from "../src/model/goal-model";

const alert = ["🔔 Time to fight", "", "🇫🇷 France Ligue 1", "Lens vs Lille", "", "Timer: 60'", "Goals: 1 - 0", "Momentum: 70 - 30", "Dangerous Attacks: 40 - 20", "Shots On Target: 5 - 2", "Over/Under 1.50 Odds:", "1.60 2.30"].join("\n");

test("a next-goal alert gives the model's features, with the market's chance from its prices", () => {
  const f = featuresOf(parseAlert(alert));
  assert.ok(f);
  // 1/1.60 and 1/2.30, overround removed: 0.625 / (0.625 + 0.4348)
  assert.ok(Math.abs(f.pMarket - 0.5897) < 0.001);
  assert.equal(f.x.length, 8);
});

test("the regression learns a feature that really predicts the outcome", () => {
  const rows = Array.from({ length: 400 }, (_, i) => {
    const signal = (i % 10) / 10;
    return { x: [signal, 0, 0, 0, 0, 0, 0, 0], y: signal > 0.5 ? 1 : 0 };
  });
  const m = fit(rows);
  assert.ok(predict(m, [0.9, 0, 0, 0, 0, 0, 0, 0]) > 0.8);
  assert.ok(predict(m, [0.1, 0, 0, 0, 0, 0, 0, 0]) < 0.2);
});

test("with too few settled picks the report says so instead of guessing", () => {
  const r = modelReport(new EngineDb(":memory:", () => {}));
  assert.equal(r.enough, false);
  assert.equal(r.test, null);
});

import { breakEven, notifyIfProved, scorePick, shadowReport, shadowTick, type ActiveModel } from "../src/model/goal-model";

const flat: ActiveModel = { weights: [1, 0, 0, 0, 0, 0, 0, 0], bias: 0, mu: [0, 0, 0, 0, 0, 0, 0, 0], sd: [1, 1, 1, 1, 1, 1, 1, 1], n: 500, trainedAt: new Date().toISOString(), version: "v1 (test)" };

test("shadow scoring waits for Betfair's price, then judges against what that price needs after commission", () => {
  const detail = parseAlert(alert);
  const fresh = { detail, exchange: null, exchangeOdds: null, firstSeenAt: new Date().toISOString() };
  assert.equal(scorePick(flat, fresh), null);
  const s = scorePick(flat, { ...fresh, exchange: "on", exchangeOdds: 1.8 });
  assert.ok(s);
  assert.equal(s.priceFrom, "betfair");
  assert.equal(s.price, 1.8);
  assert.ok(Math.abs(s.pNeeded - breakEven(1.8)) < 1e-9);
  // Not checked on Betfair after 2 minutes: the alert's own price is used.
  const old = scorePick(flat, { ...fresh, firstSeenAt: new Date(Date.now() - 3 * 60_000).toISOString() });
  assert.equal(old?.priceFrom, "alert");
});

test("without enough settled picks there's no model, so nothing is scored", () => {
  assert.equal(shadowTick(new EngineDb(":memory:", () => {})), 0);
});

test("the 'proved' notification fires once when the would-bet picks clearly beat the skipped ones, in both halves", async () => {
  const db = new EngineDb(":memory:", () => {});
  const base = Date.parse("2026-10-01T12:00:00Z");
  for (let i = 0; i < 320; i++) {
    const bet = i % 2 === 0;
    // Would-bet picks win 70% at 1.8; skipped ones win 45% at 1.8.
    const hit = bet ? i % 10 < 7 : i % 20 < 9;
    const text = alert.replace("Lens vs Lille", `Home${i} vs Away${i}`) + ["", "⸻⸻ Match Summary ⸻⸻", "", "Half-Time Score: 1-0", `Full-Time Score: ${hit ? "2-0" : "1-0"}`, "", hit ? "✅ Hit" : "❌ Miss"].join("\n");
    db.upsertLivePick("chat", i + 1, text, parseAlert(text), new Date(base + i * 60_000).toISOString());
    db.saveModelScore({ pickId: i + 1, version: "v1", pModel: bet ? 0.7 : 0.5, pMarket: 0.55, price: 1.8, priceFrom: "betfair", pNeeded: breakEven(1.8), edge: bet ? 0.12 : -0.06, at: new Date(base + i * 60_000).toISOString() });
  }
  const r = shadowReport(db);
  assert.equal(r.ready.met, true, r.ready.reasons.join("; "));
  assert.equal(await notifyIfProved(db), true);
  assert.equal(await notifyIfProved(db), false);
});
