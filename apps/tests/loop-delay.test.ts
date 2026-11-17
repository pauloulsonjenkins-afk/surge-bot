/** Naming whatever holds the engine's thread (loop-delay.ts timed). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SLOW_TASK_MS, timed } from "../src/server/loop-delay";

function capture(fn: () => void): string[] {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (msg: string) => void seen.push(msg);
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

test("a quick task passes its result through and logs nothing", () => {
  let got = 0;
  const seen = capture(() => (got = timed("quick", () => 42)));
  assert.equal(got, 42);
  assert.deepEqual(seen, []);
});

test("a slow task is named in the log, even when it throws", () => {
  const busy = () => {
    const end = Date.now() + SLOW_TASK_MS + 20;
    while (Date.now() < end) {
      // hold the thread
    }
  };
  const seen = capture(() => {
    assert.throws(() =>
      timed("slow job", () => {
        busy();
        throw new Error("boom");
      }),
    );
  });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /"slow job" held it for \d+ ms/);
});
