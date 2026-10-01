/**
 * Bets that don't link because Betfair spells a team differently: the Reconcile page suggests the Match names line
 * ("alert name = Betfair name"), adding it saves it on the Sending page, and the bet links straight away (the pick was
 * sent under the old spelling, so matching also tries the alert's teams under today's Match names).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { addMatchName, buildFeed, exchangeNamer, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { computeReconcile, explainUnlinked, importBetHistory, matchBets } from "../src/betfair/reconcile";

const S = "Blistering Momentum";
const alert = (teams: string) =>
  [`🔔 ${S}`, "", "🏴 England Premier League", teams, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80"].join("\n");

const ukFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const uk = (iso: string, plusMs: number) => ukFmt.format(new Date(Date.parse(iso) + plusMs)).replace(",", "");

function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { [S.toLowerCase()]: 2 }, strategies: { [S.toLowerCase()]: true }, dailyCap: 100 });
  const now = new Date();
  db.upsertLivePick("chat", 1, alert("Spurs vs Arsenal"), parseAlert(alert("Spurs vs Arsenal")), new Date(now.getTime() - 60_000).toISOString());
  buildFeed(db, { markSent: true, now });
  const sent = db.listSentPicks()[0]!;
  importBetHistory(
    db,
    ["Bet ID,Placed,Event,Selection,Status,Avg Price Matched,Matched,Profit/Loss", `T1,${uk(sent.sentAt, 30_000)},Tottenham v Arsenal,Over 0.5 Goals,Won,2.00,2.00,2.00`].join("\n"),
    "t.csv",
  );
  return { db, sent };
}

test("a bet whose team Betfair spells differently gets a suggested Match names line", () => {
  const { db } = setup();
  const r = computeReconcile(db);
  assert.equal(r.unlinkedCount, 1);
  assert.deepEqual(r.unlinked[0]!.suggestion, { from: "Spurs", to: "Tottenham" });
  assert.match(r.unlinked[0]!.reason, /Betfair writes “Tottenham” for the alert’s “Spurs”/);
});

test("adding it saves the line and links the bet on the pick sent under the old spelling", () => {
  const { db, sent } = setup();
  const line = addMatchName(db, "Spurs", "Tottenham");
  assert.equal(line, "Spurs = Tottenham");
  assert.equal(getSendingSettings(db).aliases, "Spurs = Tottenham");
  assert.equal(matchBets(db), 1);
  assert.equal(db.listBetfairBets()[0]!.pickId, sent.id);
  // Future picks are sent under Betfair's spelling.
  assert.equal(exchangeNamer(db)("Spurs"), "Tottenham");
});

test("adding replaces an older line for the same team, keeps the others, and refuses nonsense", () => {
  const { db } = setup();
  saveSendingSettings(db, { aliases: "Wolves = Wolverhampton\nSpurs = Tottenham Hotspur" });
  addMatchName(db, "spurs", "Tottenham");
  assert.equal(getSendingSettings(db).aliases, "Wolves = Wolverhampton\nspurs = Tottenham");
  assert.throws(() => addMatchName(db, "A = B", "C"), /without = signs/);
  assert.throws(() => addMatchName(db, "Lyon", "lyon"), /same/);
});

test("no suggestion when both teams differ or nothing was sent then", () => {
  const { db } = setup();
  const picks = db.listSentPicks();
  const at = picks[0]!.sentAt;
  assert.equal(explainUnlinked({ placedAt: at, settledAt: null, event: "Lyon v Nantes" }, picks, exchangeNamer(db)).suggestion, null);
  assert.equal(explainUnlinked({ placedAt: "2020-01-01T00:00:00.000Z", settledAt: null, event: "Tottenham v Arsenal" }, picks).suggestion, null);
});
