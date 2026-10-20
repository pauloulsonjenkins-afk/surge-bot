/**
 * Team-name learning (name-learning.ts): a Match names line is learned only when Betfair's event can only be the alert's
 * match (one team the same, the other a close name, the only candidate, kicking off when the alert says), never over
 * the admin's own line, and Undo takes it out again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { addMatchName, getSendingSettings } from "../src/inplayguru/bet-feed";
import { learnableName } from "../src/betfair/reconcile";
import { kickoffOf, learnedNames, learnedNotification, learnName, nameToLearn, undoLearnedName } from "../src/betfair/name-learning";

test("learnableName: one team the same, the other plainly the same club", () => {
  assert.deepEqual(learnableName("Celta Vigo B v Tenerife", "Celta Fortuna v Tenerife"), { from: "Celta Fortuna", to: "Celta Vigo B" });
  assert.deepEqual(learnableName("Rapid Bucharest v FC Hunedoara", "Rapid Bucuresti v CS Corvinul Hunedoara"), { from: "Rapid Bucuresti", to: "Rapid Bucharest" });
});

test("learnableName: nothing less sure", () => {
  // A reserve side is never the first team.
  assert.equal(learnableName("Celta Vigo v Tenerife B", "Celta Fortuna v Tenerife"), null);
  // Teams the other way round.
  assert.equal(learnableName("Tenerife v Celta Vigo B", "Celta Fortuna v Tenerife"), null);
  // Different clubs.
  assert.equal(learnableName("Portugal v Norway", "Portugalete v Alaves B"), null);
  // Both the same: nothing to learn.
  assert.equal(learnableName("Celta Fortuna v Tenerife", "Celta Fortuna v Tenerife"), null);
  // Women's side.
  assert.equal(learnableName("Celta Vigo (W) v Tenerife (W)", "Celta Fortuna v Tenerife"), null);
});

const POSTED = new Date("2026-10-20T14:00:00Z");
function pick(home: string, away: string, minute = 63) {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Time to fight", "", "🇪🇸 Spain Segunda Division RFEF Group 1", `${home} vs ${away}`, "", `Timer: ${minute}'`, "Goals: 1 - 0", "Over/Under 2.50 Odds:", "1.80 2.00"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), POSTED.toISOString(), POSTED.toISOString());
  return { db, p: db.getLivePickByMessage("chat", 1)! };
}
// 63' at 14:00: kicked off about 12:42 (63 minutes and 15 of half-time before).
const KICKOFF = "2026-10-20T12:45:00.000Z";
const event = { id: "E1", name: "Celta Vigo B v Tenerife", openDate: KICKOFF };
const judged = { result: "nameDiffers", event: event.name, eventId: event.id };

test("kickoffOf: alert time less the minute and half-time", () => {
  const { p } = pick("Celta Fortuna", "Tenerife");
  assert.equal(new Date(kickoffOf(p)!).toISOString(), "2026-10-20T12:42:00.000Z");
});

test("nameToLearn: learns only the sure case", () => {
  const { p } = pick("Celta Fortuna", "Tenerife");
  assert.deepEqual(nameToLearn(p, "Celta Fortuna", "Tenerife", judged, [event]), { from: "Celta Fortuna", to: "Celta Vigo B" });
  // Not when the check found both teams or neither.
  assert.equal(nameToLearn(p, "Celta Fortuna", "Tenerife", { ...judged, result: "on" }, [event]), null);
  // Not when another event could be this match too.
  assert.equal(nameToLearn(p, "Celta Fortuna", "Tenerife", judged, [event, { id: "E2", name: "Celta Fortuna B v Tenerife", openDate: KICKOFF }]), null);
  // Not when Betfair's match kicks off at another time (another Tenerife game), or its time isn't known.
  assert.equal(nameToLearn(p, "Celta Fortuna", "Tenerife", judged, [{ ...event, openDate: "2026-10-21T18:00:00Z" }]), null);
  assert.equal(nameToLearn(p, "Celta Fortuna", "Tenerife", judged, [{ id: "E1", name: event.name }]), null);
});

test("nameToLearn: never replaces the admin's own Match names line", () => {
  const { p } = pick("Celta Fortuna", "Tenerife");
  // The alert's "Celta Fortuna" already has a line ("= Celta Fortuna SAD"), and Betfair still differs: leave it to the admin.
  assert.equal(nameToLearn(p, "Celta Fortuna SAD", "Tenerife", { ...judged, event: "Celta Vigo B v Tenerife" }, [event]), null);
});

test("learnName saves the line and lists it; Undo takes it out again, and only once", () => {
  const { db, p } = pick("Celta Fortuna", "Tenerife");
  addMatchName(db, "OHiggins", "O'Higgins");
  const e = learnName(db, p, { from: "Celta Fortuna", to: "Celta Vigo B" }, event.name, POSTED);
  assert.ok(e);
  assert.match(getSendingSettings(db).aliases, /^OHiggins = O'Higgins\nCelta Fortuna = Celta Vigo B$/);
  assert.equal(learnedNames(db).length, 1);
  const n = learnedNotification(db, e!);
  assert.equal(n.title, "Learned: Celta Fortuna = Celta Vigo B");
  assert.deepEqual(n.undoName, { from: "Celta Fortuna", to: "Celta Vigo B" });

  assert.match(undoLearnedName(db, "Celta Fortuna", "Celta Vigo B"), /Taken out/);
  assert.equal(getSendingSettings(db).aliases, "OHiggins = O'Higgins", "the admin's own line stays");
  assert.ok(learnedNames(db)[0]!.undoneAt);
  assert.throws(() => undoLearnedName(db, "Celta Fortuna", "Celta Vigo B"), /isn't there/);
});

test("Undo leaves a line the admin has since changed", () => {
  const { db, p } = pick("Celta Fortuna", "Tenerife");
  learnName(db, p, { from: "Celta Fortuna", to: "Celta Vigo B" }, event.name, POSTED);
  addMatchName(db, "Celta Fortuna", "RC Celta B");
  undoLearnedName(db, "Celta Fortuna", "Celta Vigo B");
  assert.equal(getSendingSettings(db).aliases, "Celta Fortuna = RC Celta B");
});
