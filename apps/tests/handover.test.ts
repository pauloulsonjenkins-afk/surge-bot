/** A deploy's hand-over: the new container connects when the outgoing one says it has let go, else after the full wait. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForHandover, type Release } from "../src/telegram/handover";

/** A clock the test moves: sleeping advances it, so nothing really waits. */
function clock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (slept.push(ms), (t += ms)), slept };
}

test("connects as soon as the outgoing container's note names this one", async () => {
  const c = clock();
  let reads = 0;
  const readRelease = async (): Promise<Release | null> => (++reads >= 4 ? { to: "new", at: c.now() } : null);
  assert.equal(await waitForHandover({ readRelease, me: "new", maxMs: 90_000, ...c }), "released");
  assert.equal(reads, 4);
  assert.deepEqual(c.slept, [3000, 3000, 3000], "nine seconds, not ninety");
});

test("a note for another container (an earlier deploy's) is not this one's", async () => {
  const c = clock();
  const readRelease = async (): Promise<Release | null> => ({ to: "someone-else", at: c.now() });
  assert.equal(await waitForHandover({ readRelease, me: "new", maxMs: 9_000, ...c }), "timed out");
});

test("no note at all: the full wait, as before, and never longer", async () => {
  const c = clock();
  const start = c.now();
  assert.equal(await waitForHandover({ readRelease: async () => null, me: "new", maxMs: 90_000, ...c }), "timed out");
  assert.equal(c.now() - start, 90_000);
});

test("a note that can't be read is treated as not there yet, and reading carries on", async () => {
  const c = clock();
  let reads = 0;
  const readRelease = async (): Promise<Release | null> => {
    if (++reads < 3) throw new Error("storage is down");
    return { to: "new", at: c.now() };
  };
  assert.equal(await waitForHandover({ readRelease, me: "new", maxMs: 90_000, ...c }), "released");
  assert.equal(reads, 3);
});

test("the last sleep stops at the limit", async () => {
  const c = clock();
  await waitForHandover({ readRelease: async () => null, me: "new", maxMs: 7_000, ...c });
  assert.deepEqual(c.slept, [3000, 3000, 1000]);
});
