/**
 * The names the app shows for strategies: GoalBrew's coffee names by default, InPlayGuru's own for anything without
 * one, and the admin's edits on top (an empty edit goes back to the default). InPlayGuru's name stays the key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { displayName, listStrategyNames, memberName, saveStrategyName, strategyKey } from "../src/inplayguru/strategy-names";

test("defaults: the coffee names, found from InPlayGuru's name with or without its bracketed note", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(memberName(db, "Time to fight"), "Wake-up Call");
  assert.equal(memberName(db, "Both Teams to Score (fav conceded first)"), "Mixed Blend");
  assert.equal(memberName(db, "Over 1.5 Goals / Early Goal"), "Espresso");
  assert.equal(memberName(db, "Pass Master 1st half"), "Filter Coffee");
  assert.equal(memberName(db, "French Press"), "French Press");
  assert.equal(memberName(db, "Some New Strategy (v2)"), "Some New Strategy");
  // The admin side shows InPlayGuru's own name (27 Oct 2026).
  assert.equal(displayName(db, "Time to fight"), "Time to fight");
  assert.equal(displayName(db, "blistering momentum"), "Blistering Momentum");
  assert.equal(displayName(db, "Both Teams to Score (fav conceded first)"), "Both Teams to Score");
  assert.equal(strategyKey("Underdog taking charge"), "underdog taking charge");
  const all = listStrategyNames(db);
  assert.equal(Object.keys(all).length, 21); // 17 coffee names + 4 LAY groups (lay-groups.ts)
  assert.ok(Object.values(all).every((s) => s.description && s.trigger && s.bet && !s.custom));
});

test("the admin can rename and describe a strategy, and clearing it goes back to the default", () => {
  const db = new EngineDb(":memory:", () => {});
  saveStrategyName(db, "Time to fight", "Flat White", "Underdog ahead: next goal.");
  let s = listStrategyNames(db)["time to fight"]!;
  assert.equal(s.name, "Flat White");
  assert.equal(s.description, "Underdog ahead: next goal.");
  assert.equal(s.custom, true);
  assert.equal(memberName(db, "Time to fight"), "Flat White");
  assert.equal(displayName(db, "Time to fight"), "Time to fight", "the admin side keeps InPlayGuru's name");

  saveStrategyName(db, "Time to fight", "", "");
  s = listStrategyNames(db)["time to fight"]!;
  assert.equal(s.name, "Wake-up Call");
  assert.equal(s.custom, false);

  // A strategy with no default can be named too.
  saveStrategyName(db, "Some New Strategy", "Cortado", "");
  assert.equal(memberName(db, "Some New Strategy"), "Cortado");
  assert.throws(() => saveStrategyName(db, "Time to fight", "x".repeat(41), ""), /at most 40/);
});
