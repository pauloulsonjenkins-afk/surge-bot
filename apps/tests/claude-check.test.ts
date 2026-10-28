/**
 * Claude's per-alert second opinion (server/claude-check.ts). The network call itself needs a real API key and isn't
 * exercised here; this covers the parts that don't: reading the tool call's structured input (not re-parsing text,
 * since 27 Oct 2026 - see the file's own comment for why), and remembering the last failure for the admin page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildAlertContext, claudeConfigured, isAmbiguous, lastCheckFailure, parseVerdict, truncateNote } from "../src/server/claude-check";
import { watchSegment } from "../src/server/golden";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";

test("without an API key, claudeConfigured is false", () => {
  // No ANTHROPIC_API_KEY in the test environment: the module's lazily-cached client is never built.
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "this test needs no key set, or it isn't testing the no-key path");
  assert.equal(claudeConfigured(), false);
});

test("parseVerdict reads the tool call's own structured input, not text to re-parse", () => {
  assert.deepEqual(parseVerdict({ verdict: "weaker", confidence: "high", note: "Momentum well below this strategy's usual pattern." }), {
    verdict: "weaker",
    confidence: "high",
    note: "Momentum well below this strategy's usual pattern.",
  });
  // Every field required; an unknown verdict or confidence value; a note that's missing or not a string.
  assert.equal(parseVerdict({ confidence: "high", note: "x" }), null, "no verdict");
  assert.equal(parseVerdict({ verdict: "confident", confidence: "high", note: "x" }), null, "not one of the three allowed");
  assert.equal(parseVerdict({ verdict: "weaker", confidence: "high" }), null, "no note");
  assert.equal(parseVerdict({ verdict: "weaker", confidence: "high", note: 5 }), null, "note isn't text");
  assert.equal(parseVerdict(null), null);
  assert.equal(parseVerdict("not an object"), null);
  // A genuinely runaway note is trimmed rather than rejected, on a word boundary (truncateNote below) - the normal
  // case is a short note that fits well inside the limit and goes through untouched.
  const long = "x".repeat(2500);
  assert.ok(parseVerdict({ verdict: "in_line", confidence: "low", note: long })!.note.endsWith("…"));
});

test("truncateNote never stops mid-word: a real note was once hard-cut to 'Recent strat' (27 Oct 2026, seen on the Live tab)", () => {
  const short = "Momentum favours the home side.";
  assert.equal(truncateNote(short), short, "well under the limit: untouched");
  // "word " is 5 chars; a 103-char cutoff lands mid-word ("...word wo|rd...") unless it backs up to the space.
  const long = `${"word ".repeat(200)}tail`;
  const cut = truncateNote(long, 103);
  assert.equal(cut, `${"word ".repeat(19)}word…`, "backs up to the last whole word before the mark, never a partial one");
  // No space the whole way through the cut: nothing to back up to, so it marks the hard cut rather than return nothing.
  assert.ok(truncateNote("x".repeat(200), 100).endsWith("…"));
});

test("buildAlertContext carries head-to-head alongside everything else, and never throws with no league history loaded", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", "Lens vs Lille", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const pick = db.getLivePickByMessage("chat", 1)!;
  const context = buildAlertContext(db, pick, new Date());
  assert.ok("recentFormAndHeadToHead" in context, "the field is always present, even when null");
  assert.ok("leagueTablePosition" in context, "the field is always present, even when null");
  assert.ok("marketPriceMovementSinceAlert" in context);
  assert.ok("contradictingAlertsOnThisMatch" in context);
  assert.ok("goldenSlicesThisAlertIsIn" in context);
  // No league history file is downloaded in a test run, so both are null here; edge.test.ts and
  // football-data.test.ts exercise edgeCard's and tablePositions' own logic directly with synthetic match rows.
  assert.equal(context.recentFormAndHeadToHead, null);
  assert.equal(context.leagueTablePosition, null);
  // No Betfair price has been read for this pick, so there's nothing to compare the alert's own quote against.
  assert.equal(context.marketPriceMovementSinceAlert, null);
  assert.equal(context.contradictingAlertsOnThisMatch, null, "nothing else on this match");
  assert.equal(context.goldenSlicesThisAlertIsIn, null, "not in any watched slice");
});

test("buildAlertContext reports how Betfair's price has moved since the alert's own quote", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  db.setPickExchange(1, "on", "Home v Away", 1.40); // shortened from the alert's 1.80
  const context = buildAlertContext(db, db.getLivePickByMessage("chat", 1)!, new Date());
  assert.match(context.marketPriceMovementSinceAlert as string, /shortened from 1\.80 to 1\.40/);

  db.setPickExchange(1, "on", "Home v Away", 1.80);
  const same = buildAlertContext(db, db.getLivePickByMessage("chat", 1)!, new Date());
  assert.match(same.marketPriceMovementSinceAlert as string, /broadly agrees/);
});

test("a stale, pre-goal (delayed key) Betfair price is flagged rather than read as real market movement", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  db.setPickExchange(1, "on", "Home v Away", 4.4); // far above the alert's 1.80: pricing.ts's own stale-price ratio
  const context = buildAlertContext(db, db.getLivePickByMessage("chat", 1)!, new Date());
  assert.match(context.marketPriceMovementSinceAlert as string, /stale pre-goal snapshot/);
});

test("buildAlertContext flags a recent alert on the same match whose bet cancels this one out", () => {
  const db = new EngineDb(":memory:", () => {});
  const now = new Date();
  const over = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 55'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  const layOver = ["🔔 LAY next goal · Japan and Brazil", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  const earlier = new Date(now.getTime() - 5 * 60_000).toISOString();
  db.upsertLivePick("chat", 1, over, parseAlert(over), earlier, earlier);
  db.upsertLivePick("lay", 2, layOver, parseAlert(layOver), now.toISOString(), now.toISOString());
  const context = buildAlertContext(db, db.getLivePickByMessage("lay", 2)!, new Date(now.getTime() + 1000));
  const contradicting = context.contradictingAlertsOnThisMatch as string[] | null;
  assert.ok(contradicting, "the earlier Over alert on the same match cancels this LAY");
  assert.match(contradicting![0]!, /5 min ago/);
});

test("buildAlertContext gives a Golden slice its real status and record, not just its name", () => {
  const db = new EngineDb(":memory:", () => {});
  watchSegment(db, "Blistering Momentum", ["score00"]);
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const context = buildAlertContext(db, db.getLivePickByMessage("chat", 1)!, new Date());
  const slices = context.goldenSlicesThisAlertIsIn as Array<{ label: string; status: string; counted: number }>;
  assert.ok(slices, "the alert is in the newly-watched slice");
  assert.equal(slices[0]!.status, "quiet", "nothing settled yet, so it's still quiet");
  assert.equal(slices[0]!.counted, 0);
});

test("buildAlertContext gives the strategy's own record in this one league, but only once there's enough of it", () => {
  const db = new EngineDb(":memory:", () => {});
  const S = "Blistering Momentum";
  const KEY = S.toLowerCase();
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 1 }, strategies: { [KEY]: true }, dailyCap: 1000 });
  const now = new Date();
  let id = 1;
  const alert = (n: number, league: string, result?: "hit" | "miss") =>
    [`🔔 ${S}`, "", `🇫🇷 ${league}`, `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80", ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : [])].join("\n");
  const bet = (league: string, result: "hit" | "miss") => {
    const n = id++;
    const posted = new Date(now.getTime() - (100 - n) * 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n, league), parseAlert(alert(n, league)), posted, posted);
    buildFeed(db, { markSent: true, now: new Date(posted) });
    db.upsertLivePick("chat", n, alert(n, league, result), parseAlert(alert(n, league, result)), posted);
  };
  // France Ligue 1: 9 losses - one short of LEAGUE_RECORD_MIN, so still too thin to show.
  for (let i = 0; i < 9; i++) bet("France Ligue 1", "miss");
  const thin = buildAlertContext(db, db.getLivePickByMessage("chat", 1)!, now);
  assert.equal(thin.thisStrategyInThisLeague, null, "9 picks isn't enough yet");

  // A 10th loss tips it over the threshold.
  bet("France Ligue 1", "miss");
  const ready = buildAlertContext(db, db.getLivePickByMessage("chat", 1)!, now);
  const rec = ready.thisStrategyInThisLeague as { settledPicks: number; roi: number };
  assert.equal(rec.settledPicks, 10);
  assert.ok(rec.roi < 0, "ten straight losses");

  // A different league has nothing recorded for this strategy at all.
  bet("Italy Serie A", "hit");
  const otherLeague = buildAlertContext(db, db.getLivePickByMessage("chat", id - 1)!, now);
  assert.equal(otherLeague.thisStrategyInThisLeague, null, "only one pick in this league so far");
});

test("buildAlertContext carries InPlayGuru's own strike rate, overall and in this league", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00", "",
    "🎯 Strike Rate: 78% overall (1,204 picks) · 71% league (96 picks)",
  ].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const context = buildAlertContext(db, db.getLivePickByMessage("chat", 1)!, new Date());
  assert.equal(context.alertStrikeRate, 78);
  assert.equal(context.alertStrikeRatePicks, 1204);
  assert.equal(context.alertStrikeRateInThisLeague, 71);
  assert.equal(context.alertStrikeRateInThisLeaguePicks, 96);
});

test("buildAlertContext carries Edge's own pre-match value picks for this match, when there's a positive-edge trend", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const pick = db.getLivePickByMessage("chat", 1)!;
  const card = {
    fixture: { div: "F1", league: "Ligue 1", country: "France", kickoff: new Date().toISOString(), home: pick.home, away: pick.away },
    headline: null,
    trends: [
      { kind: "goals", text: "Home have scored over 1.5 in 8 of their last 10", hits: 8, sample: 10, rate: 0.8, strength: 0.6, betfair: { price: 1.5, needed: 67, edge: 5, at: new Date().toISOString() } },
      { kind: "form", text: "Away have won 1 of their last 10", hits: 1, sample: 10, rate: 0.1, strength: 0.05, betfair: { price: 2.0, needed: 50, edge: -10, at: new Date().toISOString() } },
    ],
    homeGames: 10,
    awayGames: 10,
    computedAt: new Date().toISOString(),
  };
  db.replaceEdgeCards([{ key: "f1-home-away", kickoff: card.fixture.kickoff, json: JSON.stringify(card) }], new Date(0).toISOString());
  const context = buildAlertContext(db, pick, new Date());
  assert.deepEqual(context.preMatchEdgeValue, ["Home have scored over 1.5 in 8 of their last 10 - priced at 1.5, needs 67% to break even, this trend's own rate is higher (edge +5pts)"]);
});

test("buildAlertContext's preMatchEdgeValue is null with no stored card, or no positive-edge trend, for this match", () => {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1", "Home vs Away", "", "Timer: 60'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const pick = db.getLivePickByMessage("chat", 1)!;
  assert.equal(buildAlertContext(db, pick, new Date()).preMatchEdgeValue, null, "no stored card at all");
});

test("isAmbiguous: a contradicting alert, or the price drifting against the alert, is ambiguous - nothing else is", () => {
  const base = { contradictingAlertsOnThisMatch: null, marketPriceMovementSinceAlert: null };
  assert.equal(isAmbiguous(base), false, "nothing unusual");
  assert.equal(isAmbiguous({ ...base, contradictingAlertsOnThisMatch: ["Time to fight's alert 5 min ago pointed the opposite way."] }), true);
  assert.equal(isAmbiguous({ ...base, marketPriceMovementSinceAlert: "Betfair's price has drifted from 1.80 to 2.20 (+22.2%) since the alert: the market favours this less than the alert's own price did." }), true);
  // Shortening (the market agrees more), agreeing, or a flagged-stale reading are all NOT ambiguous.
  assert.equal(isAmbiguous({ ...base, marketPriceMovementSinceAlert: "Betfair's price has shortened from 1.80 to 1.40 (-22.2%) since the alert: the market now favours this more than the alert's own price did." }), false);
  assert.equal(isAmbiguous({ ...base, marketPriceMovementSinceAlert: "Betfair's price (1.80) is about the same as the alert's own quote (1.80): the market broadly agrees with the alert." }), false);
  assert.equal(isAmbiguous({ ...base, marketPriceMovementSinceAlert: "Betfair's price looks like a stale pre-goal snapshot (a delayed price reading), not a real current price: not usable as a market-movement signal here." }), false);
});

test("the last per-alert check failure is remembered for the admin page, and cleared once one succeeds", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(lastCheckFailure(db), null, "nothing yet");
  db.setSetting("claude_check_last_failure", JSON.stringify({ reason: "couldn't get a usable verdict from its reply (stop reason: end_turn).", at: "2026-10-27T11:00:00.000Z" }));
  assert.deepEqual(lastCheckFailure(db), { reason: "couldn't get a usable verdict from its reply (stop reason: end_turn).", at: "2026-10-27T11:00:00.000Z" });
  db.setSetting("claude_check_last_failure", "null");
  assert.equal(lastCheckFailure(db), null, "cleared once a later check succeeded");
});

test("the per-alert check is paused by default (29 Oct 2026), and 'in line' verdicts are hidden from Live by default", async () => {
  const { claudeCheckPaused, setClaudeCheckPaused } = await import("../src/server/claude-check");
  const { claudeHideInLine, setClaudeHideInLine, computeClaudeVerdictCheck } = await import("../src/server/claude-verdict-check");
  const db = new EngineDb(":memory:", () => {});
  assert.equal(claudeCheckPaused(db), true);
  assert.equal(claudeHideInLine(db), true);
  setClaudeCheckPaused(db, false);
  setClaudeHideInLine(db, false);
  assert.equal(claudeCheckPaused(db), false);
  assert.equal(claudeHideInLine(db), false);
  const c = computeClaudeVerdictCheck(db);
  assert.equal(c.paused, false);
  assert.equal(c.hideInLine, false);
});
