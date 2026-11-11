/** The return at real Betfair prices only, shown beside a headline that includes quoted and assumed prices. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { OnBetfair } from "@/components/admin/strategies/strategy-parts";

const bf = (counted: number, roi: number | null) => ({ counted, staked: counted, profit: (roi ?? 0) * counted, units: 0, roi });

test("shown when some picks were priced from a quote, with how many it covers", () => {
  const html = renderToStaticMarkup(<OnBetfair m={{ counted: 400, roi: 0.06, onBetfair: bf(250, -0.02) }} />);
  assert.match(html, /At real Betfair prices only/);
  assert.match(html, /−2%/);
  assert.match(html, /250 of 400|250<!-- --> of <!-- -->400/);
  assert.match(html, /flattered by quoted prices/, "the headline is 8 points better than what Betfair offered");
});

test("no warning when the two agree, and no colour on under 100 picks", () => {
  const html = renderToStaticMarkup(<OnBetfair m={{ counted: 400, roi: 0.06, onBetfair: bf(80, 0.05) }} />);
  assert.ok(!html.includes("flattered"));
  assert.ok(!html.includes("text-hit"));
});

test("nothing when every priced pick already had a Betfair price, or none did", () => {
  assert.equal(renderToStaticMarkup(<OnBetfair m={{ counted: 120, roi: 0.06, onBetfair: bf(120, 0.06) }} />), "");
  assert.equal(renderToStaticMarkup(<OnBetfair m={{ counted: 120, roi: 0.06, onBetfair: null }} />), "");
  assert.equal(renderToStaticMarkup(<OnBetfair m={{ counted: 120, roi: 0.06 }} />), "");
});
