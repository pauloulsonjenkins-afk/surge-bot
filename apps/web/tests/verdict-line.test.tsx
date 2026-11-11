/** The verdict under a return figure: what the bets can say, how many there are, and the likely range of the return. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { VerdictLine } from "@/components/admin/strategies/strategy-parts";
import { roiRangeText } from "@/lib/hit-rate";

test("under 100 bets it says too early, with the count, and no range to read into", () => {
  const html = renderToStaticMarkup(<VerdictLine m={{ verdict: "too early", counted: 19, roiRange: { low: -0.4, high: 0.3 } }} />);
  assert.match(html, /Too early to say/);
  assert.match(html, /19 bets<!-- --> of 100|19 bets of 100/);
  assert.ok(!html.includes("likely"));
});

test("with enough bets it gives the verdict, the count and the likely range of the return", () => {
  const html = renderToStaticMarkup(<VerdictLine m={{ verdict: "no clear edge", counted: 212, roiRange: { low: -0.077, high: 0.2 } }} />);
  assert.match(html, /No clear edge/);
  assert.match(html, /212 bets/);
  assert.match(html, /likely −7\.7% to \+20%/);
  assert.match(renderToStaticMarkup(<VerdictLine m={{ verdict: "probably winning", counted: 400, roiRange: null }} />), /text-hit[^>]*>Probably winning/);
  assert.match(renderToStaticMarkup(<VerdictLine m={{ verdict: "probably losing", counted: 400, roiRange: null }} />), /text-loss[^>]*>Probably losing/);
});

test("nothing with no bets, or with an older engine that sends no verdict", () => {
  assert.equal(renderToStaticMarkup(<VerdictLine m={{ verdict: "too early", counted: 0, roiRange: null }} />), "");
  assert.equal(renderToStaticMarkup(<VerdictLine m={{ counted: 50 }} />), "");
  assert.equal(renderToStaticMarkup(<VerdictLine m={null} />), "");
  assert.equal(roiRangeText(null), null);
});
