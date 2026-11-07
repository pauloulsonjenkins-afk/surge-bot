/**
 * Backups while changes keep coming: at most one per minimum gap (spaces-sync.ts). Each one snapshots, reads and
 * checksums the whole database on the engine's thread; on 7 Nov 2026 it ran 8 times in 3 minutes. Stopping still
 * uploads the last changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupScheduler } from "../src/storage/spaces-sync";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scheduler(minGapMs: number) {
  let uploads = 0;
  const db = { snapshotTo: async (p: string) => writeFileSync(p, "x") };
  const sync = {
    description: "test",
    liveKey: "live",
    dailyKey: (d: string) => `daily/${d}`,
    readLease: async () => null,
    writeLease: async () => {},
    upload: async (key: string) => {
      if (key === "live") uploads++;
    },
  };
  const s = new BackupScheduler(db as never, sync as never, join(mkdtempSync(join(tmpdir(), "bk-")), "snap.db"), 10, 60_000, "me", () => {}, () => {}, Date.now(), minGapMs);
  return { s, uploads: () => uploads };
}

test("a steady stream of changes uploads once per gap, not after every pause", async () => {
  const { s, uploads } = scheduler(300);
  const end = Date.now() + 1000;
  while (Date.now() < end) {
    s.markDirty();
    await wait(25);
  }
  await wait(400);
  assert.ok(uploads() >= 2 && uploads() <= 5, `uploads: ${uploads()} (about one per 300 ms gap over ~1.4 s)`);
  await s.flush();
});

test("stopping uploads the last change straight away, gap or not", async () => {
  const { s, uploads } = scheduler(60_000);
  s.markDirty();
  await wait(50);
  assert.equal(uploads(), 1, "the first change goes after the debounce");
  s.markDirty();
  await wait(50);
  assert.equal(uploads(), 1, "the next one waits for the gap");
  await s.flush();
  assert.equal(uploads(), 2, "flush uploads it");
});
