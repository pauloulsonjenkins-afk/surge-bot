/**
 * The admin's heavy reports, by name (site review A1, 12 Nov 2026).
 *
 * One list, used two ways: the engine's own thread calls a report directly (as it always has), and the report worker
 * (report-worker.ts) calls the same function on its own thread with its own connection to the database. Both get the
 * same answer because it is the same code; nothing here may depend on anything but the database and its arguments,
 * which must be plain values (they cross to the worker as a message).
 */
import type { EngineDb } from "../storage/engine-db";
import { parsePickMode } from "../storage/engine-db";
import { reportTimings } from "./report-timings";
import { todaySnapshot } from "./today";
import { goldenReport } from "./golden";
import { computeWinLoss } from "./winloss";
import { computeStrategyWeeks } from "./strategy-weeks";
import { buildStrategiesReport } from "./http";

export const REPORTS = {
  today: (db: EngineDb): Record<string, unknown> => todaySnapshot(db) as unknown as Record<string, unknown>,
  strategies: (db: EngineDb, since: string | null): Record<string, unknown> => buildStrategiesReport(db, since),
  golden: (db: EngineDb): Record<string, unknown> => {
    const { timed, done } = reportTimings("Golden page data");
    const report = timed("golden", () => goldenReport(db));
    return { ...report, timings: done(), at: new Date().toISOString() };
  },
  winloss: (db: EngineDb, mode: string): Record<string, unknown> => {
    const { timed, done } = reportTimings("Profit page data");
    const state = timed("winloss", () => computeWinLoss(db, new Date(), parsePickMode(mode)));
    return { ...state, timings: done(), at: new Date().toISOString() };
  },
  "strategy-weeks": (db: EngineDb): Record<string, unknown> => {
    const { timed, done } = reportTimings("Strategies weekly data");
    const weeks = timed("weeks", () => computeStrategyWeeks(db));
    return { ...weeks, timings: done(), at: new Date().toISOString() };
  },
} as const;

export type ReportName = keyof typeof REPORTS;
export const isReportName = (v: unknown): v is ReportName => typeof v === "string" && Object.prototype.hasOwnProperty.call(REPORTS, v);

/** Works a report out on the calling thread. */
export function runReport(db: EngineDb, name: ReportName, args: unknown[]): Record<string, unknown> {
  return (REPORTS[name] as (db: EngineDb, ...a: unknown[]) => Record<string, unknown>)(db, ...args);
}
