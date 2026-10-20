/**
 * The website's first tests (20 Oct 2026): the money and return helpers every page shares, the Golden badge and labels,
 * the weekly table's slice rows, and the slice stake box's check. Run with `npm test` (and in GitHub's checks).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { gbp, signedPct, toneOf } from "@/lib/format";
import { bestStatus, GoldenBadge, SegmentLabel, sliceName } from "@/components/ui/SegmentLabel";
import { sliceRowName, trendOf } from "@/components/admin/StrategyWeekly";
import { parseStake } from "@/components/admin/SegmentBetting";

test("money: a true minus sign, a plus only when asked, never £-2.00", () => {
  assert.equal(gbp(4), "+£4.00");
  assert.equal(gbp(-2), "−£2.00");
  assert.equal(gbp(0), "£0.00");
  assert.equal(gbp(4, false), "£4.00");
  assert.equal(gbp(-2, false), "−£2.00");
});

test("returns: one decimal, a true minus, and a tiny loss reads 0% (never −0%)", () => {
  assert.equal(signedPct(0.0323), "+3.2%");
  assert.equal(signedPct(-0.015), "−1.5%");
  assert.equal(signedPct(-0.0004), "0%");
  assert.equal(signedPct(null), "–");
  assert.equal(signedPct(Number.NaN), "–");
});

test("colour: green above zero, red below, and what rounds to zero is plain", () => {
  assert.equal(toneOf(0.2), "text-hit");
  assert.equal(toneOf(-0.2), "text-loss");
  assert.equal(toneOf(-0.0004), "text-ink");
  assert.equal(toneOf(null, "text-ink-muted"), "text-ink-muted");
});

test("Golden badge: metal only once proved; a candidate is outlined; not holding up is red", () => {
  assert.match(renderToStaticMarkup(<GoldenBadge status="golden" />), /gold-chip font-semibold[^"]*">.*Golden/);
  const candidate = renderToStaticMarkup(<GoldenBadge status="candidate" candidate="Candidate · 7 of 50" />);
  assert.match(candidate, /gold-chip-outline/);
  assert.match(candidate, /Candidate · 7 of 50/);
  assert.doesNotMatch(candidate, /gold-chip font/);
  assert.match(renderToStaticMarkup(<GoldenBadge status="not holding up" />), /text-loss[^>]*>Not holding up/);
  assert.match(renderToStaticMarkup(<GoldenBadge status={null} />), /Being watched/);
});

test("Golden label: the word is gold only for a proved slice", () => {
  assert.match(renderToStaticMarkup(<SegmentLabel label="Golden: 0-0" status="golden" />), /text-gold/);
  assert.doesNotMatch(renderToStaticMarkup(<SegmentLabel label="Golden: 0-0" status="candidate" />), /text-gold/);
  assert.equal(sliceName("Golden: 2+ goals apart"), "2+ goals apart");
});

test("an alert in several slices shows the best status: Golden, then candidate, then not holding up", () => {
  assert.equal(bestStatus(["candidate", "golden", null]), "golden");
  assert.equal(bestStatus(["not holding up", "candidate"]), "candidate");
  assert.equal(bestStatus([null, null]), null);
});

test("weekly table: each slice row is named by its slice (they all read 'Golden' before)", () => {
  const labels = {
    "time to fight#two-apart": "Golden: 2+ goals apart",
    "time to fight#c1": "Golden: 0-1 goals so far, 45-59'",
  };
  assert.equal(sliceRowName("favourite pressure 2nd half#golden", labels), "Golden");
  assert.equal(sliceRowName("time to fight#two-apart", labels), "2+ goals apart");
  assert.equal(sliceRowName("time to fight#c1", labels), "0-1 goals so far, 45-59'");
  assert.equal(sliceRowName("losing team pushing hard#home-one-down"), "Home team 1 down");
});

test("weekly trend: too few bets says so; turning up, slipping and steady by the last 7 days", () => {
  const t = (counted: number, profit: number) => ({ picks: counted, won: 0, lost: 0, counted, staked: counted, profit });
  assert.equal(trendOf(t(3, 5), t(20, -4)).label, "Too few bets");
  assert.equal(trendOf(t(10, 5), t(20, -4)).label, "Turning up");
  assert.equal(trendOf(t(10, -5), t(20, 4)).label, "Slipping");
  assert.equal(trendOf(t(10, 5), t(20, 4)).label, "Steady +");
});

test("slice stake box: empty is the strategy's stake; 0.1-10% accepted; anything else refused", () => {
  assert.equal(parseStake(""), null);
  assert.equal(parseStake("  "), null);
  assert.equal(parseStake("2"), 2);
  assert.equal(parseStake("2.345"), 2.35);
  assert.equal(parseStake("0.1"), 0.1);
  assert.equal(parseStake("10"), 10);
  assert.equal(parseStake("0"), undefined);
  assert.equal(parseStake("10.5"), undefined);
  assert.equal(parseStake("abc"), undefined);
});
