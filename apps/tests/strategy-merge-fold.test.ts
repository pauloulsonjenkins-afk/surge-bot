/** Strategies page: a merged strategy's counts are added into the one it is merged into (http.ts foldMergedCounts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldMergedCounts } from "../src/server/http";

const row = (label: string, mergedInto: string | null, n: number, last: string) => ({
  label, mergedInto, alerts: n, alertsSince: n, hits: n - 1, misses: 1, liveHits: 0, liveMisses: 0, simHits: n - 1, simMisses: 1, sent: 0, lastAlertAt: last,
});

test("merged strategies' counts go into their target; their own rows keep theirs", () => {
  const list = [row("Telegram tips", null, 10, "2026-11-16T17:00:00Z"), row("Telegram: CVPICKS", "Telegram tips", 7, "2026-11-14T08:00:00Z"), row("Telegram: PRIME", "Telegram tips", 5, "2026-11-16T18:00:00Z"), row("Other", null, 3, "2026-11-01T00:00:00Z")];
  const out = foldMergedCounts(list);
  const tips = out.find((x) => x.label === "Telegram tips")!;
  assert.equal(tips.alerts, 22);
  assert.equal(tips.hits, 9 + 6 + 4);
  assert.equal(tips.misses, 3);
  assert.equal(tips.lastAlertAt, "2026-11-16T18:00:00Z");
  assert.equal(out.find((x) => x.label === "Telegram: CVPICKS")!.alerts, 7);
  assert.equal(out.find((x) => x.label === "Other")!.alerts, 3);
  assert.equal(list[0]!.alerts, 10, "the rows given are not changed");
});
