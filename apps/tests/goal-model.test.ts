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
