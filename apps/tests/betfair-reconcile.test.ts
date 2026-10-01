/**
 * Checks the Betfair reconciliation: reading a bet history export whatever its layout, linking each bet to the pick it
 * was placed for, and comparing real profit, prices and fills with the app's estimates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeReconcile, eventScore, importBetHistory, parseBetHistory, parseCsv, parseMoney, parseUkDateTime } from "../src/betfair/reconcile";

const S = "Blistering Momentum";
const KEY = S.toLowerCase();
const TEAMS = ["Lyon vs Nantes", "Lille vs Brest", "Nice vs Lens"];

function alert(n: number, opts: { result?: "hit" | "miss"; over?: string } = {}): string {
  return [
    `🔔 ${S}`,
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    TEAMS[n - 1],
    "",
    "Timer: 60'",
    "Goals: 0 - 0",
    "Over/Under 0.50 Odds:",
    `${opts.over ?? "2.00"} 1.80`,
    ...(opts.result
      ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${opts.result === "hit" ? "1-0" : "0-0"}`, "", opts.result === "hit" ? "✅ Hit" : "❌ Miss"]
      : []),
  ].join("\n");
}

const ukFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const uk = (iso: string, plusMs = 0) => ukFmt.format(new Date(Date.parse(iso) + plusMs)).replace(",", "");

/** Three picks sent at £2: two hits at 2.00 in the alert, one miss. */
function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [KEY]: 2 }, strategies: { [KEY]: true }, dailyCap: 100 });
  const now = new Date();
  const posted = new Date(now.getTime() - 60_000).toISOString();
  const results: Array<"hit" | "miss"> = ["hit", "hit", "miss"];
  results.forEach((result, i) => {
    const n = i + 1;
    db.upsertLivePick("chat", n, alert(n), parseAlert(alert(n)), posted);
    buildFeed(db, { markSent: true, now });
    db.upsertLivePick("chat", n, alert(n, { result }), parseAlert(alert(n, { result })), posted);
  });
  return { db, sent: db.listSentPicks() };
}

test("CSV: quotes, embedded commas, semicolons and a BOM", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("a;b\n1;2\n"), [["a", "b"], ["1", "2"]]);
});

test("money and UK times are read the way the betting software writes them", () => {
  assert.equal(parseMoney("£1,234.50"), 1234.5);
  assert.equal(parseMoney("(2.00)"), -2);
  assert.equal(parseMoney("-"), null);
  // Summer: 14:03 in London is 13:03 UTC. Winter: the same.
  assert.equal(parseUkDateTime("01/07/2026 14:03:22"), "2026-07-01T13:03:22.000Z");
  assert.equal(parseUkDateTime("01-Dec-26 14:03"), "2026-12-01T14:03:00.000Z");
  assert.equal(parseUkDateTime("2026-12-01 14:03"), "2026-12-01T14:03:00.000Z");
  assert.equal(parseUkDateTime("2026-07-01T13:03:22Z"), "2026-07-01T13:03:22.000Z");
  assert.equal(parseUkDateTime("not a date"), null);
});

test("columns are found by name, the status read from words or the profit's sign, totals rows skipped", () => {
  const csv = [
    "My bets export",
    "Bet Ref,Date Placed,Event,Selection,Status,Avg Price Matched,Size Matched,Profit/Loss",
    "1001,01/07/2026 14:03,Arsenal v Chelsea,Over 0.5 Goals,WON,2.10,2.00,2.20",
    "1002,01/07/2026 15:00,Football / Leeds v Hull / Over/Under 0.5 Goals,Over 0.5 Goals,Lapsed,,0,",
    "1003,01/07/2026 16:00,Wolves v Fulham,Over 0.5 Goals,,1.90,2.00,-2.00",
    "Total,,,,,,,0.20",
  ].join("\n");
  const h = parseBetHistory(csv);
  assert.equal(h.bets.length, 3);
  assert.equal(h.skipped, 1);
  assert.deepEqual(h.bets.map((b) => b.status), ["won", "unmatched", "lost"]);
  assert.equal(h.bets[1]!.event, "Leeds v Hull");
  assert.equal(h.columns.matched, "Size Matched");
  assert.equal(h.columns.odds, "Avg Price Matched");
});

test("a file without a time column is refused with a reason", () => {
  assert.throws(() => parseBetHistory("Event,Profit\nA v B,1\n"), /no date or time column/);
});

test("team names: the same match matches, a different one doesn't", () => {
  assert.equal(eventScore("Manchester City v Arsenal", "Man City v Arsenal FC"), 2);
  assert.equal(eventScore("Manchester United v Arsenal", "Manchester City v Arsenal"), 1);
});

test("bets link to their picks and the report compares real with estimated", () => {
  const { db, sent } = setup();
  assert.equal(sent.length, 3);
  const ev = (i: number) => sent[i]!.sentRow!.eventName!;
  const csv = [
    "Bet ID,Placed,Event,Selection,Status,Avg Price Matched,Matched,Profit/Loss",
    `A1,${uk(sent[0]!.sentAt, 30_000)},${ev(0)},Over 0.5 Goals,Won,1.90,2.00,1.80`, // got 1.90, alert said 2.00
    `A2,${uk(sent[1]!.sentAt, 30_000)},${ev(1)},Over 0.5 Goals,Lapsed,,0,`, // never matched
    `A3,${uk(sent[2]!.sentAt, 30_000)},${ev(2)},Over 0.5 Goals,Lost,2.00,2.00,-2.00`,
    `A4,${uk(sent[2]!.sentAt, 60_000)},Somebody v Else,Over 0.5 Goals,Lost,2.00,2.00,-2.00`, // not one of ours
  ].join("\n");
  const s = importBetHistory(db, csv, "test.csv");
  assert.equal(s.added, 4);
  assert.equal(s.linked, 3);

  const r = computeReconcile(db);
  const row = r.strategies.find((x) => x.label === S)!;
  assert.equal(row.sent, 3);
  assert.equal(row.matched, 2);
  assert.equal(row.unmatchedRate, 0.333);
  assert.equal(row.compared, 2);
  assert.equal(row.estimatedProfit, 0); // +£2 at 2.00, -£2
  assert.equal(row.actualProfit, -0.2); // +£1.80, -£2
  assert.equal(row.slippage, -0.025); // (1.90/2.00 - 1 + 0) / 2
  assert.equal(row.resultMismatches, 0);
  assert.deepEqual(r.unlinked.map((b) => b.betId), ["A4"]);

  // Importing the same file again changes nothing.
  const again = importBetHistory(db, csv, "test.csv");
  assert.equal(again.added, 0);
  assert.equal(again.updated, 4);
  assert.equal(computeReconcile(db).strategies[0]!.matched, 2);
});

test("BF Bot Manager's bet history export: backslash descriptions, £ amounts, the PC's own time zone", () => {
  const csv = [
    "Description,Selection,Bet Id,Bet type,Matched amount,Loss rec. amount,Avg. price matched,Status,P/L,Strategy,Short description,Tipster,Placed date,Matched date,Settled date",
    "20:00 FK Loznica v FK Spartak\\Over/Under 2.5 Goals\\Over 2.5 Goals,Over 2.5 Goals,100000000001,BACK,£1.00,£0.00,1.84,SETTLED,-£1.00,Momentum Next Goal - Live,Score at time of bet: 2 - 0,blistering momentum / action-packed,2026-09-28 21:29:31,2026-09-28 21:29:36,2026-09-28 21:52:53",
    "21:00 Guadeloupe v Barbados\\Over/Under 3.5 Goals\\Over 3.5 Goals,Over 3.5 Goals,100000000002,BACK,£5.00,£0.00,2.28,SETTLED,£6.40,Momentum Next Goal - Live,,underdog taking charge action,2026-09-28 22:38:59,2026-09-28 22:39:11,2026-09-28 22:48:42",
  ].join("\n");
  const uk = parseBetHistory(csv);
  assert.equal(uk.bets.length, 2);
  const [a, b] = uk.bets;
  assert.equal(a!.event, "FK Loznica v FK Spartak");
  assert.equal(a!.selection, "Over 2.5 Goals");
  assert.equal(a!.betId, "100000000001");
  assert.equal(a!.side, "back");
  assert.equal(a!.status, "lost");
  assert.equal(a!.matched, 1);
  assert.equal(a!.odds, 1.84);
  assert.equal(a!.profit, -1);
  assert.equal(a!.provider, "blistering momentum / action-packed");
  assert.equal(b!.status, "won");
  assert.equal(b!.profit, 6.4);
  assert.equal(uk.columns.event, "Description");
  assert.equal(uk.columns.profit, "P/L");
  // Read as UK summer time by default; with the PC's offset sent (UTC here), the same text is an hour later in UTC.
  assert.equal(a!.placedAt, "2026-09-28T20:29:31.000Z");
  assert.equal(parseBetHistory(csv, 0).bets[0]!.placedAt, "2026-09-28T21:29:31.000Z");
});

test("BF Bot Manager's market results file is refused with a reason that says what it is", () => {
  assert.throws(
    () => parseBetHistory("Country code,Start time,Market name,Winners,Winners prices,Total matched\n,2026-09-30 09:00:00,A v B\\Both teams to Score?,Yes,1.68,158.37\n"),
    /market results file/,
  );
});
