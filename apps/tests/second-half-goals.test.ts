import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlert } from "../src/inplayguru/parse-alert";

const alert = (result: string[] = []) =>
  ["🔔 2nd half goals last 10 matches 2", "", "🇩🇪 Germany 2. Bundesliga (3rd vs 9th)", "Bochum vs Bielefeld", "", "Timer: 78'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.85 1.95", ...result].join("\n");

test("'2nd half goals last 10 matches 2' is a next-goal bet: Over the goals so far + 0.5, graded from the score", () => {
  const p = parseAlert(alert());
  assert.equal(p.market, "NEXT_GOAL");
  assert.equal(p.targetLine, 1.5);
  assert.equal(p.sendable, true, p.flags.join("; "));
  const won = parseAlert(alert(["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", "Full-Time Score: 2-0", "", "❌ Miss"]));
  assert.equal(won.result, "hit", "a goal after the alert wins, whatever the alert's tick says");
  const lost = parseAlert(alert(["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", "Full-Time Score: 1-0", "", "✅ Hit"]));
  assert.equal(lost.result, "miss");
});
