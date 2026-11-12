/**
 * The engine's side of the report worker (report-worker.ts): starts it, hands it requests, and restarts it if it stops.
 *
 * OFF unless REPORT_WORKER=1 is set on the engine (12 Nov 2026): the worker is a second copy of the report code and of
 * the settled picks in memory, and the container's memory hasn't been measured with it running. With it off, or
 * whenever it fails, is slow or isn't ready, reports are worked out on the engine's own thread exactly as before
 * (report-cache.ts does the falling back), so the worst case is today's behaviour.
 */
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { log } from "./log";
import type { ReportName } from "./reports";
import type { ReportReply, ReportRequest } from "./report-worker";

/** A report that takes longer than this on the worker is given up on (the engine then works it out itself). */
const TIMEOUT_MS = 30_000;
/** After this many failures to start in a row the worker is left off until the engine restarts. */
const MAX_RESTARTS = 5;

let worker: Worker | null = null;
let dbPathUsed: string | null = null;
let nextId = 1;
let restarts = 0;
let givenUp = false;
const waiting = new Map<number, { resolve: (b: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
const stats = { done: 0, failed: 0, lastMs: null as number | null, lastError: null as string | null };

function failAll(why: string): void {
  for (const [id, w] of waiting) {
    clearTimeout(w.timer);
    w.reject(new Error(why));
    waiting.delete(id);
  }
}

function spawn(dbPath: string): void {
  // The built engine runs report-worker.js from the same folder; under tsx (tests) the .ts file needs tsx loaded too.
  const ts = __filename.endsWith(".ts");
  const file = join(__dirname, ts ? "report-worker.ts" : "report-worker.js");
  const w = new Worker(file, { workerData: { dbPath }, ...(ts ? { execArgv: ["--import", "tsx"] } : {}) });
  worker = w;
  w.on("message", (reply: ReportReply) => {
    const wait = waiting.get(reply.id);
    if (!wait) return;
    waiting.delete(reply.id);
    clearTimeout(wait.timer);
    if (reply.ok) {
      restarts = 0;
      stats.done++;
      stats.lastMs = reply.ms;
      wait.resolve(reply.body);
    } else {
      stats.failed++;
      stats.lastError = reply.error;
      wait.reject(new Error(reply.error));
    }
  });
  w.on("error", (err) => {
    stats.lastError = err.message;
    log.error(`The report worker failed: ${err.stack ?? err.message}`);
  });
  w.on("exit", (code) => {
    if (worker !== w) return;
    worker = null;
    failAll("The report worker stopped.");
    if (dbPathUsed === null) return; // stopped on purpose
    restarts++;
    if (restarts > MAX_RESTARTS) {
      givenUp = true;
      log.error(`The report worker stopped ${restarts} times in a row (last code ${code}); reports stay on the engine's own thread until it restarts.`);
      return;
    }
    log.warn(`The report worker stopped (code ${code}); starting it again. Reports are worked out on the engine's own thread meanwhile.`);
    setTimeout(() => {
      if (dbPathUsed !== null && !worker) spawn(dbPathUsed);
    }, 2_000 * restarts).unref?.();
  });
  w.unref();
}

/** Starts the worker for this database file. Does nothing unless REPORT_WORKER=1 (or `force`, for tests). */
export function startReportWorker(dbPath: string, force = false): boolean {
  if (worker || dbPath === ":memory:") return worker !== null;
  if (!force && process.env.REPORT_WORKER !== "1") return false;
  dbPathUsed = dbPath;
  givenUp = false;
  restarts = 0;
  try {
    spawn(dbPath);
    log.info("Report worker started: the admin's reports are worked out off the engine's main thread.");
    return true;
  } catch (err) {
    log.error(`The report worker could not start, so reports stay on the engine's own thread: ${err instanceof Error ? err.message : String(err)}`);
    worker = null;
    return false;
  }
}

export async function stopReportWorker(): Promise<void> {
  const w = worker;
  dbPathUsed = null;
  worker = null;
  failAll("The report worker was stopped.");
  if (w) await w.terminate().catch(() => {});
}

/** Whether a report can be handed to the worker right now. */
export function reportWorkerReady(): boolean {
  return worker !== null && !givenUp;
}

/** Asks the worker for a report. Rejects if it isn't running, fails or takes too long: the caller then works it out itself. */
export function workerReport(name: ReportName, args: unknown[], resultsVersion: number): Promise<Record<string, unknown>> {
  const w = worker;
  if (!w || givenUp) return Promise.reject(new Error("The report worker is not running."));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      stats.failed++;
      stats.lastError = `"${name}" took over ${TIMEOUT_MS / 1000} s`;
      reject(new Error(stats.lastError));
    }, TIMEOUT_MS);
    timer.unref?.();
    waiting.set(id, { resolve, reject, timer });
    w.postMessage({ id, name, args, resultsVersion } satisfies ReportRequest);
  });
}

/** For the health page: is it on, how many reports it has done, and the last one's time. */
export function reportWorkerStatus(): { on: boolean; done: number; failed: number; lastMs: number | null; lastError: string | null } {
  return { on: reportWorkerReady(), ...stats };
}
