/** The clash chooser's Sim record (server/clash-choices.ts): a held-back pick gets the side the chooser would place. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { fillClashChoices, recordsFromReport } from "../src/server/clash-choices";

const ALERT = (name: string) => [`🔔 ${name}`, "", "🇫🇷 France Ligue 1", "Lyon vs Nantes", "", "Timer: 46'", "Goals: 1 - 0", "Over/Under 1.50 Odds:", "1.80 2.00"].join("\n");

test("each held-back pick is judged once, from both strategies' records", () => {
  const db = new EngineDb(":memory:", () => {});
  const at = "2026-11-16T15:00:00Z";
  db.upsertLivePick("chat", 1, ALERT("Back One"), parseAlert(ALERT("Back One")), at, at);
  db.upsertLivePick("chat", 2, ALERT("Lay Two"), parseAlert(ALERT("Lay Two")), at, at);
  const back = db.getLivePickByMessage("chat", 1)!.id;
  const lay = db.getLivePickByMessage("chat", 2)!.id;
  db.noteClash(lay, back, "lay", new Date(at));
  db.noteClash(lay, back, "lay", new Date(at)); // seen again on the next poll: still one
  const records = recordsFromReport({
    strategies: [
      { label: "Back One", returns: { all: { counted: 80, roi: -0.06 } } },
      { label: "Lay Two", returns: { all: { counted: 50, roi: 0.03 } } },
    ],
  });
  assert.equal(fillClashChoices(db, records), 1);
  const [c] = db.listClashChoices();
  assert.equal(c!.side, "lay");
  assert.match(c!.reason!, /LAY record 3\.0% beats back -6\.0%/);
  assert.equal(fillClashChoices(db, records), 0, "judged once");
});
