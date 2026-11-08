/** Engine text tidied for showing: a true minus before figures, dates in words, hyphens in words left alone. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, tidyText } from "../src/lib/format";

test("minus signs, dates and words", () => {
  assert.equal(tidyText("-100% per £1 over its last 31 Live bets since 2026-11-08, -38.3% adjusted (-3 units)."), "−100% per £1 over its last 31 Live bets since 8 Nov, −38.3% adjusted (−3 units).");
  assert.equal(tidyText("break-even 0-0 at half-time, -£4.50"), "break-even 0-0 at half-time, −£4.50");
  assert.equal(formatCurrency(-2), "−£2.00");
});
