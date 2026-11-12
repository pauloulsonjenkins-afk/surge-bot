/** The report worker: the same reports, worked out on a second thread from its own connection to the database file. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { setCustomSegments } from "../src/server/segments";
import { runReport, isReportName } from "../src/server/reports";
import { reportWorkerReady, reportWorkerStatus, startReportWorker, stopReportWorker, workerReport } from "../src/server/report-client";
import { cachedReportVia, clearReportCache } from "../src/server/report-cache";

const dir = mkdtempSync(join(tmpdir(), "goalbrew-worker-"));
const dbPath = join(dir, "engine.db");

const alert = (n: number, goals: string, result: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", `Goals: ${goals}`,
    `Over/Under ${goals === "0 - 0" ? "0.50" : "1.50"} Odds:`, "2.00 1.80", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "9-9" : goals.replace(" - ", "-")}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");

function settle(db: EngineDb, from: number, to: number): void {
  for (let n = from; n <= to; n++) {
    const goals = n % 2 === 0 ? "0 - 0" : "1 - 0";
    const win = n % 3 !== 0;
    const at = new Date(Date.now() - 60_000).toISOString();
    const open = alert(n, goals, win ? "hit" : "miss").split("\n\n⸻")[0]!;
    db.upsertLivePick("chat", n, open, parseAlert(open), at);
    recordSimBets(db);
    db.upsertLivePick("chat", n, alert(n, goals, win ? "hit" : "miss"), parseAlert(alert(n, goals, win ? "hit" : "miss")), at);
  }
}

/** A report without the parts that differ from one run to the next (how long it took, and when). */
const steady = (body: Record<string, unknown>) => {
  const { timings: _t, at: _a, ...rest } = body;
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
};

setCustomSegments([]);
const db = new EngineDb(dbPath, () => {});
saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 1 }, dailyCap: 1000 });
recordSimBets(db, new Date(Date.now() - 120_000));
settle(db, 1, 40);

after(async () => {
  await stopReportWorker();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("only the listed reports can be asked for", () => {
  assert.ok(isReportName("strategies") && isReportName("winloss") && isReportName("today") && isReportName("golden") && isReportName("strategy-weeks"));
  assert.ok(!isReportName("constructor") && !isReportName("toString") && !isReportName(""));
});

test("it is off unless asked for, and then reports are worked out on the calling thread as before", async () => {
  assert.equal(startReportWorker(dbPath), false, "REPORT_WORKER is not set");
  assert.equal(reportWorkerReady(), false);
  await assert.rejects(workerReport("strategies", [null], db.resultsVersion()), /not running/);
  const body = await cachedReportVia(db, "strategies:null", "strategies", [null]);
  assert.deepEqual(steady(body).strategies, steady(runReport(db, "strategies", [null])).strategies);
  clearReportCache(db);
});

test("the worker gives the same reports as the engine's own thread", async () => {
  assert.equal(startReportWorker(dbPath, true), true);
  for (const [name, args] of [["strategies", [null]], ["winloss", ["all"]], ["strategy-weeks", []]] as const) {
    const fromWorker = await workerReport(name, [...args], db.resultsVersion());
    assert.deepEqual(steady(fromWorker), steady(runReport(db, name, [...args])), name);
  }
  const s = reportWorkerStatus();
  assert.equal(s.on, true);
  assert.equal(s.done, 3);
  assert.equal(s.failed, 0);
});

test("results settled after the worker started show in its next report", async () => {
  const before = (await workerReport("strategies", [null], db.resultsVersion())).strategies as Array<{ settled?: number; hits?: number; misses?: number }>;
  settle(db, 41, 60);
  const fresh = await workerReport("strategies", [null], db.resultsVersion());
  assert.deepEqual(steady(fresh), steady(runReport(db, "strategies", [null])));
  assert.notDeepEqual(fresh.strategies, before);
});

test("a report the worker can't do is refused, and the page still gets its report from the engine's thread", async () => {
  await assert.rejects(workerReport("nope" as never, [], db.resultsVersion()), /No report called/);
  clearReportCache(db);
  const body = await cachedReportVia(db, "winloss:all", "winloss", ["all"]);
  assert.deepEqual(steady(body), steady(runReport(db, "winloss", ["all"])));
});

test("stopped: reports carry on from the engine's own thread", async () => {
  await stopReportWorker();
  assert.equal(reportWorkerReady(), false);
  clearReportCache(db);
  const body = await cachedReportVia(db, "strategies:null", "strategies", [null]);
  assert.deepEqual(steady(body).strategies, steady(runReport(db, "strategies", [null])).strategies);
});
