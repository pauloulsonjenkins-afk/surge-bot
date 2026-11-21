/** One name per strategy everywhere: the engine's ADMIN_NAMES and the site's ADMIN_SHORT_NAMES must be the same list. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_NAMES, displayName } from "../src/inplayguru/strategy-names";

test("the engine and the site name every strategy the same way", () => {
  const web = readFileSync(join(__dirname, "../web/src/queries/use-strategy-names.ts"), "utf8");
  const block = web.slice(web.indexOf("export const ADMIN_SHORT_NAMES"), web.indexOf("};", web.indexOf("export const ADMIN_SHORT_NAMES")));
  const site = Object.fromEntries([...block.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(site, ADMIN_NAMES);
});

test("notifications use the owner's names", () => {
  const db = {} as never;
  assert.equal(displayName(db, "og 2 shg"), "OG 2 SHG");
  assert.equal(displayName(db, "away super fav 2 goals"), "Away Super Fav 2G");
  assert.equal(displayName(db, "action-packed"), "Action-Packed", "anything not on the list is title-cased as before");
});
