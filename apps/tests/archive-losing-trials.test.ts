/** Trial strategies still losing after 200+ pretend bets are archived by the nightly auto-adjust (archive.ts losingTrials). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { losingTrials, type TrialFigures } from "../src/server/archive";
import { trialFiguresFromReport } from "../src/server/auto-adjust";

const row = (key: string, f: Partial<TrialFigures>): TrialFigures => ({ key, label: key, live: false, hasLiveSlice: false, simBets: 300, simProfit: -20, weekSimRoi: -0.1, ...f });

test("only a trial strategy losing over 200+ pretend bets, and not winning lately, is archived", () => {
  const rows = [
    row("losing", {}),
    row("live one", { live: true }),
    row("real slice", { hasLiveSlice: true }),
    row("few bets", { simBets: 150 }),
    row("in profit", { simProfit: 4 }),
    row("good week", { weekSimRoi: 0.3 }),
    row("quiet week", { weekSimRoi: null }),
    row("restored", {}),
    row("already", {}),
    row("og 2 shg", {}),
  ];
  const out = losingTrials(rows, { already: {} }, { restored: "2026-11-20" }, ["og 2 shg"]).map((r) => r.key);
  assert.deepEqual(out, ["losing", "quiet week"]);
});

test("the figures come from the Strategies report, merged rows left out", () => {
  const rows = trialFiguresFromReport(
    {
      strategies: [
        { label: "Blistering Momentum", mode: "sim", returns: { sim: { counted: 257, profit: -24.52 } }, form: { week: { sim: { counted: 33, roi: -0.16 } } } },
        { label: "Telegram: Old", mode: "sim", mergedInto: "Telegram tips", returns: { sim: { counted: 300, profit: -9 } } },
      ],
    },
    new Set(["blistering momentum"]),
  );
  assert.deepEqual(rows, [{ key: "blistering momentum", label: "Blistering Momentum", live: false, hasLiveSlice: true, simBets: 257, simProfit: -24.52, weekSimRoi: -0.16 }]);
});
