/**
 * The report worker: works the admin's heavy reports out on its own thread (site review A1, 12 Nov 2026), so the
 * engine's thread stays free to read alerts and place bets while a page loads.
 *
 * It opens its own connection to the same database file (SQLite in WAL mode lets it read while the engine writes) and
 * answers one request at a time: { id, name, args, resultsVersion } in, { id, ok, body | error } out. It never places a
 * bet, sends a notification or talks to Telegram or Betfair: it only runs the functions listed in reports.ts.
 *
 * Two things the engine keeps in memory have to be brought up to date here before each report, because this thread has
 * its own copies:
 *   - the kept settled picks (EngineDb): told to read again whenever the engine's resultsVersion has moved on;
 *   - the Golden slices added from the finder (segments.ts): read again from the settings every time.
 *
 * Started and watched by report-client.ts. If this thread fails, the engine works reports out itself as before.
 */
import "../telegram/use-new-layer";
import { parentPort, workerData } from "node:worker_threads";
import { EngineDb } from "../storage/engine-db";
import { loadCustomSegments } from "./golden";
import { isReportName, runReport } from "./reports";

export interface ReportRequest {
  id: number;
  name: string;
  args: unknown[];
  resultsVersion: number;
}
export type ReportReply = { id: number; ok: true; body: Record<string, unknown>; ms: number } | { id: number; ok: false; error: string };

if (parentPort) {
  const port = parentPort;
  const { dbPath } = workerData as { dbPath: string };
  let db: EngineDb | null = null;
  let seen = -1;
  port.on("message", (req: ReportRequest) => {
    const started = Date.now();
    try {
      if (!isReportName(req.name)) throw new Error(`No report called "${req.name}".`);
      // Opened on the first request, so the engine has finished creating its tables.
      db ??= new EngineDb(dbPath, () => {});
      if (req.resultsVersion !== seen) {
        db.resultsChangedElsewhere();
        seen = req.resultsVersion;
      }
      loadCustomSegments(db);
      const body = runReport(db, req.name, req.args);
      port.postMessage({ id: req.id, ok: true, body, ms: Date.now() - started } satisfies ReportReply);
    } catch (err) {
      port.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ReportReply);
    }
  });
}
