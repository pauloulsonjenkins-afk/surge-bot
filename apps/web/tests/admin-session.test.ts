/** The admin session: renewed on use (so it doesn't run out under you), and a renewed one keeps its length. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_SESSION_SECRET = "a-long-enough-secret-for-the-tests-1234567890";
process.env.ADMIN_PASSWORD = "pw";

test("a good session is renewed for as long as it was issued for; a bad or missing one is not", async () => {
  const { createSessionToken, renewedSession, verifySessionToken } = await import("../src/server/auth");
  const short = await createSessionToken(false);
  const a = await renewedSession(short);
  assert.equal(a?.maxAge, 60 * 60 * 8, "an 8-hour session is renewed for 8 hours");
  assert.equal(await verifySessionToken(a!.value), true);
  const long = await createSessionToken(true);
  assert.equal((await renewedSession(long))?.maxAge, 60 * 60 * 24 * 30, "a remembered one for 30 days");
  assert.equal(await renewedSession(undefined), null);
  assert.equal(await renewedSession("123.abc"), null);
  assert.equal(await renewedSession(`${Math.floor(Date.now() / 1000) - 5}.${short.split(".")[1]}`), null, "an expired one");
});
