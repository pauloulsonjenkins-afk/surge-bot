/** The agents' read-only key: only the configured key opens /api/agent, and the agent route has no way to write. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentKeyValid } from "../src/server/agent-key";

const KEY = "an-agent-key-long-enough-1234567890";

test("only the configured key is accepted, and a missing or short configured key accepts nothing", () => {
  assert.equal(agentKeyValid(KEY, KEY), true);
  assert.equal(agentKeyValid(`${KEY}x`, KEY), false);
  assert.equal(agentKeyValid("", KEY), false);
  assert.equal(agentKeyValid(null, KEY), false);
  assert.equal(agentKeyValid(KEY, undefined), false, "no AGENT_READ_KEY: the agent routes are off");
  assert.equal(agentKeyValid("short", "short"), false, "a configured key under 24 characters is refused");
});

test("the agent route exports GET only, so a POST or PUT with the key gets 405", () => {
  const src = readFileSync(join(__dirname, "../app/api/agent/[view]/route.ts"), "utf8");
  const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  assert.deepEqual(methods, ["GET"]);
  assert.doesNotMatch(src, /\b(save|merge|apply|set|update|delete)[A-Z]\w*\(/, "no engine-client writer is called");
});
