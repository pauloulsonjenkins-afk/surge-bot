/**
 * Website users: sign-up starts with no access, sign-in checks the password, the admin's page choices
 * are stored, and disabling / resetting / signing out everywhere ends existing sign-ins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { getSignupsOpen, hashPassword, listUsers, logIn, sessionUser, setSignupsOpen, signUp, updateUser, verifyPassword } from "../src/server/users";

const PW = "correct horse battery";

test("passwords are stored as salted hashes and only the right one verifies", async () => {
  const a = await hashPassword(PW);
  const b = await hashPassword(PW);
  assert.notEqual(a, b, "each hash has its own salt");
  assert.ok(!a.includes(PW));
  assert.equal(await verifyPassword(PW, a), true);
  assert.equal(await verifyPassword("wrong password!", a), false);
  assert.equal(await verifyPassword(PW, "not-a-hash"), false);
});

test("a new sign-up has no page access, and a repeat email is answered the same way", async () => {
  const db = new EngineDb(":memory:", () => {});
  assert.deepEqual(await signUp(db, { email: "  Sam@Example.com ", name: "Sam", password: PW }), { ok: true });
  const [u] = listUsers(db);
  assert.equal(u?.email, "sam@example.com");
  assert.deepEqual(u?.pages, []);
  assert.equal(u?.active, true);

  assert.deepEqual(await signUp(db, { email: "SAM@example.com", name: "Other", password: "another password!" }), { ok: true });
  assert.equal(listUsers(db).length, 1, "no duplicate created");
  const ok = await logIn(db, { email: "sam@example.com", password: PW });
  assert.equal(ok.ok, true, "the original password still works");
});

test("sign-up rejects bad emails and short passwords, and can be closed", async () => {
  const db = new EngineDb(":memory:", () => {});
  assert.deepEqual(await signUp(db, { email: "nope", name: "", password: PW }), { ok: false, error: "invalid_email" });
  assert.deepEqual(await signUp(db, { email: "a@b.co", name: "", password: "short" }), { ok: false, error: "weak_password" });
  setSignupsOpen(db, false);
  assert.equal(getSignupsOpen(db), false);
  assert.deepEqual(await signUp(db, { email: "a@b.co", name: "", password: PW }), { ok: false, error: "signups_closed" });
  assert.equal(listUsers(db).length, 0);
});

test("sign-in: wrong password and unknown email look the same; a disabled account can't sign in", async () => {
  const db = new EngineDb(":memory:", () => {});
  await signUp(db, { email: "a@b.co", name: "A", password: PW });
  assert.deepEqual(await logIn(db, { email: "a@b.co", password: "wrong wrong wrong" }), { ok: false, error: "invalid_credentials" });
  assert.deepEqual(await logIn(db, { email: "nobody@b.co", password: PW }), { ok: false, error: "invalid_credentials" });
  const good = await logIn(db, { email: "A@B.co", password: PW });
  assert.equal(good.ok, true);

  const id = listUsers(db)[0]!.id;
  await updateUser(db, id, { active: false });
  assert.deepEqual(await logIn(db, { email: "a@b.co", password: PW }), { ok: false, error: "disabled" });
});

test("page access: only known pages are kept, and they show up in the session", async () => {
  const db = new EngineDb(":memory:", () => {});
  await signUp(db, { email: "a@b.co", name: "A", password: PW });
  const id = listUsers(db)[0]!.id;
  const r = await updateUser(db, id, { pages: ["live", "dashboard", "admin", "live"] });
  assert.equal(r.ok, true);
  assert.deepEqual(listUsers(db)[0]!.pages, ["dashboard", "live"]);
  const sv = listUsers(db)[0]!.sessionVersion;
  assert.deepEqual(sessionUser(db, id, sv)?.pages, ["dashboard", "live"]);
  assert.deepEqual(await updateUser(db, id, { pages: "live" }), { ok: false, error: "bad_request" });
});

test("disabling, a password reset or 'sign out everywhere' ends existing sign-ins; deleting removes the user", async () => {
  const db = new EngineDb(":memory:", () => {});
  await signUp(db, { email: "a@b.co", name: "A", password: PW });
  const id = listUsers(db)[0]!.id;
  let sv = listUsers(db)[0]!.sessionVersion;
  assert.ok(sessionUser(db, id, sv));

  await updateUser(db, id, { signOutEverywhere: true });
  assert.equal(sessionUser(db, id, sv), null);
  sv = listUsers(db)[0]!.sessionVersion;

  await updateUser(db, id, { password: "a brand new password" });
  assert.equal(sessionUser(db, id, sv), null);
  assert.equal((await logIn(db, { email: "a@b.co", password: PW })).ok, false);
  assert.equal((await logIn(db, { email: "a@b.co", password: "a brand new password" })).ok, true);
  sv = listUsers(db)[0]!.sessionVersion;

  await updateUser(db, id, { active: false });
  assert.equal(sessionUser(db, id, sv), null);

  assert.equal(db.deleteAppUser(id), true);
  assert.equal(listUsers(db).length, 0);
  assert.deepEqual(await updateUser(db, id, { name: "x" }), { ok: false, error: "not_found" });
});
