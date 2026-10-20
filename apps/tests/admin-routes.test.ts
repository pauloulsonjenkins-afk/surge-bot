/**
 * Every /internal route answers only the admin site (it sends the engine's admin key). The routes are read from
 * http.ts itself, so a route added later without the check fails here. 20 Oct 2026: the check was written out 46 times
 * by hand; it is now one function (requireAdmin), and this makes sure none was missed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { EngineDb } from "../src/storage/engine-db";
import { createEngineHttpServer } from "../src/server/http";

/** Every "/internal/..." path named in http.ts (exact paths and the start of path families). */
function internalPaths(): string[] {
  const src = readFileSync(new URL("../src/server/http.ts", import.meta.url), "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/"(\/internal\/[A-Za-z0-9/_-]*)"/g)) found.add(m[1]!.replace(/\/$/, "") || m[1]!);
  return [...found].sort();
}

test("no /internal route answers without the admin key, and none answers a wrong key", async () => {
  const paths = internalPaths();
  assert.ok(paths.length > 50, `found ${paths.length} routes in http.ts`);
  const db = new EngineDb(":memory:", () => {});
  const before = process.env.ADMIN_INTERNAL_KEY;
  process.env.ADMIN_INTERNAL_KEY = "test-key-0123456789abcdef0123456789abcdef";
  const server = createEngineHttpServer({} as never, db, { getStatus: () => ({}) } as never);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const answered: string[] = [];
  try {
    for (const path of paths) {
      for (const method of ["GET", "POST", "PUT"]) {
        for (const auth of [undefined, "Bearer wrong-key"]) {
          const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
            body: method === "GET" ? undefined : "{}",
          });
          await res.arrayBuffer();
          // Turned away (401), or no such route for that method (404 / 405). Anything else answered a stranger.
          if (![401, 404, 405].includes(res.status)) answered.push(`${method} ${path} ${auth ? "(wrong key)" : "(no key)"}: ${res.status}`);
        }
      }
    }
  } finally {
    await new Promise((ok) => server.close(ok));
    if (before === undefined) delete process.env.ADMIN_INTERNAL_KEY;
    else process.env.ADMIN_INTERNAL_KEY = before;
  }
  assert.deepEqual(answered, []);
});
