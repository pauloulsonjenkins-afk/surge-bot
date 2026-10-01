/**
 * The engine's HTTP interface. Routes:
 *
 *   GET  /health                               DigitalOcean's health check
 *   POST /webhooks/inplayguru/<path token>     InPlayGuru picks
 *   GET  /internal/picks                        recent captured picks (admin site only)
 *   GET  /internal/live[?hours=N|?date=D]       parsed alerts for the Live tab and Results page, optionally for a window (admin site only)
 *   GET  /internal/live/days                    UK days that have picks, with counts, for the Results page (admin site only)
 *   GET  /internal/stats?days=N[&strategy=X]    hit-rate figures for Dashboard / Strategies, optionally for one strategy (admin site only)
 *   GET  /internal/schedule?date=YYYY-MM-DD     the day's matches from API-Football, for the Schedule tab (admin site only)
 *   GET/POST /internal/fresh-start              count all figures from now (or undo it); nothing is deleted (admin site only)
 *   GET  /internal/leagues                      every league seen, with its hide / reset / country / tier settings (admin site only)
 *   POST /internal/leagues/update               hide, reset or re-label one league; never deletes picks (admin site only)
 *   GET  /internal/performance?days=N           totals by league, strategy and alert minute, for the Dashboard's breakdown (admin site only)
 *   GET  /internal/sending                      sending options, preview and status (admin site only)
 *   PUT  /internal/sending                      change the sending options (admin site only)
 *   GET/PUT /internal/winloss                   estimated profit and loss, and its options (admin site only)
 *   GET/PUT /internal/access                    whether the public pages may be seen signed-out (admin site only)
 *   /internal/users/*                           website user sign-up, sign-in and page access (admin site only; see users-routes.ts)
 *   GET  /internal/strategies                   every strategy with its counts, switch, stake and merge (admin site only)
 *   GET  /internal/strategies/equity?label=X    one strategy's running profit pick by pick, with drawdown and losing runs (admin site only)
 *   POST /internal/strategies/ignore            stop or start ignoring a strategy's new alerts (admin site only)
 *   POST /internal/strategies/merge             report one strategy under another's name, or undo that (admin site only)
 *   POST /internal/strategies/remove            delete a strategy's stored picks (admin site only)
 *   POST /internal/picks/result                 amend (or reset) one pick's result (admin site only)
 *   POST /internal/picks/exclude                 mark (or unmark) a pick as "didn't actually bet" (admin site only)
 *   GET  /feeds/bets/<feed token>.csv           the bet feed the betting software polls
 *   POST /imports/betfair/<import token>        the betting software's bet history export (CSV body), posted by tools/bf-import.ps1
 *   POST /internal/betfair/import               the same, uploaded on the admin Reconcile page (admin site only)
 *   GET  /internal/betfair/reconcile            real bets against the app's estimates, per strategy (admin site only)
 *   GET  /internal/betfair/placements           whether each recently sent pick was placed and matched on Betfair (admin site only)
 *   POST /internal/betfair/acknowledge          mark unlinked bets as known (not from the feed), or put them back (admin site only)
 *   POST /internal/telegram/login/start         begin Telegram user-session login
 *   POST /internal/telegram/login/code          submit the SMS/app login code
 *   POST /internal/telegram/login/password      submit the 2FA password, if any
 *   GET  /internal/telegram/login/status        poll login progress
 *   GET  /internal/telegram/login/chats         list chats once logged in
 *   POST /internal/telegram/login/watch         pick which chat to watch and start listening
 *
 * The webhook and feed URLs contain a secret path token, so those URLs are never logged.
 * /internal/* routes are protected separately by ADMIN_INTERNAL_KEY, checked
 * as a Bearer token — they're meant to be called server-to-server by the
 * admin site, not opened directly in a browser.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TelegramClient } from "telegram";
import { parsePickMode, type EngineDb } from "../storage/engine-db";
import type { BackupScheduler } from "../storage/spaces-sync";
import type { ServerEnv } from "./server-env";
import { verifyHmacSignature, verifyPathToken } from "../inplayguru/verify";
import { handleVerifiedPick } from "../inplayguru/receiver";
import { createTelegramClient } from "../telegram/client";
import { loginFlow } from "../telegram/session-flow";
import { getListenerStatus, startTelegramListener } from "../telegram/listener";
import { computeStopLoss, forgetStopLoss, saveStopLossRule } from "../inplayguru/stop-loss";
import { buildFeed, getLastFeedFetchAt, getLastFeedFetcher, getSendingSettings, noteFeedFetched, saveSendingSettings } from "../inplayguru/bet-feed";
import { getPublicView, setPublicView } from "./access-settings";
import { handleUsersRoute } from "./users-routes";
import { computeHitRateContext, computePickProfits, computeStrategyEquity, computeStrategyReturns, computeWinLoss, getWinLossSettings, saveWinLossSettings } from "./winloss";
import { log } from "./log";
import { computeReconcile, decodeCsv, importBetHistory, matchBets, zoneFromName } from "../betfair/reconcile";
import { getBetfairLinkStatus, pickPlacements } from "../betfair/exchange";
import { isUkDate, ukDayBounds } from "./uk-time";
import { addDays, readPullStatus, ukDateOf } from "../fixtures/daily-pull";

const MAX_BODY_BYTES = 64 * 1024;
const WEBHOOK_PREFIX = "/webhooks/inplayguru/";
const FEED_PREFIX = "/feeds/bets/";
const BETFAIR_IMPORT_PREFIX = "/imports/betfair/";
/** A bet history export can run to thousands of rows. */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

class BodyTooLarge extends Error {}

function send(res: ServerResponse, status: number, body: Record<string, unknown>, closeConnection = false): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...(closeConnection ? { Connection: "close" } : {}),
  });
  res.end(json);
}

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Stop buffering and discard the rest, so the 413 reply can still be sent.
        req.removeAllListeners("data");
        req.resume();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const raw = await readBody(req, maxBytes);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Minutes ahead of UTC for an imported file's times (-720 to 840), or null to read them as UK time. */
function parseUtcOffset(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= -720 && n <= 840 ? n : null;
}

function isAdminAuthorized(req: IncomingMessage): boolean {
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!internalKey) return false;
  const authHeader = req.headers["authorization"];
  const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const provided = authValue?.startsWith("Bearer ") ? authValue.slice(7) : "";
  return verifyPathToken(provided, internalKey);
}

// Holds the client across the multi-step login handshake, and afterwards as
// the live listener connection for the rest of this process's lifetime.
let activeTelegramClient: TelegramClient | null = null;

export function createEngineHttpServer(env: ServerEnv, db: EngineDb, backups: BackupScheduler): Server {
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error(`Unhandled error in request handler: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, { error: "internal_error" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? "/";
    const path = rawUrl.split("?")[0] ?? "/";

    if (req.method === "GET" && path === "/health") {
      // Stays 200 even if backups are failing: a failed health check makes
      // DigitalOcean restart the container, which would lose un-backed-up data.
      // Always 200: a failing health check makes DigitalOcean restart the container. Problems are reported, not enforced.
      send(res, 200, {
        ok: true,
        webhooksStored: db.countWebhooks(),
        livePicks: db.countLivePicks(),
        backup: backups.getStatus(),
        telegram: getListenerStatus(),
        feedLastFetchedAt: getLastFeedFetchAt(),
      });
      return;
    }

    if (req.method === "GET" && path === "/internal/picks") {
      const internalKey = process.env.ADMIN_INTERNAL_KEY;
      if (!internalKey) {
        log.warn("GET /internal/picks called but ADMIN_INTERNAL_KEY is not set on the engine.");
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(rawUrl, "http://internal");
      const limitParam = Number(url.searchParams.get("limit"));
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
      send(res, 200, { picks: db.listRecentWebhooks(limit) });
      return;
    }

    if (req.method === "GET" && path === "/internal/live") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        log.warn("GET /internal/live called but ADMIN_INTERNAL_KEY is not set on the engine.");
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(rawUrl, "http://internal");
      const limitParam = Number(url.searchParams.get("limit"));
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
      // Optional window: ?hours=24 (the last 24 hours) or ?date=YYYY-MM-DD (one UK day). Without either, the latest picks.
      const hoursParam = Number(url.searchParams.get("hours"));
      const dateParam = url.searchParams.get("date") ?? "";
      let range: { from: string; to: string } | undefined;
      if (isUkDate(dateParam)) {
        range = ukDayBounds(dateParam);
      } else if (Number.isFinite(hoursParam) && hoursParam > 0) {
        const now = Date.now();
        range = { from: new Date(now - Math.min(hoursParam, 24 * 31) * 3_600_000).toISOString(), to: new Date(now + 60_000).toISOString() };
      }
      const picks = db.listLivePicks(limit, range);
      // Profit per settled pick, for the admin's Trade Log. Worked out exactly as Win/Loss does.
      const oldest = picks.reduce<string | null>((min, p) => (min === null || p.firstSeenAt < min ? p.firstSeenAt : min), null);
      const profits = oldest ? computePickProfits(db, oldest) : {};
      send(res, 200, { picks: picks.map((p) => ({ ...p, pnl: profits[p.id] ?? null })) });
      return;
    }

    if (req.method === "GET" && path === "/internal/live/days") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      send(res, 200, { days: db.listPickDays() });
      return;
    }

    if (req.method === "GET" && path === "/internal/stats") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        log.warn("GET /internal/stats called but ADMIN_INTERNAL_KEY is not set on the engine.");
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(rawUrl, "http://internal");
      const daysParam = Number(url.searchParams.get("days"));
      const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;
      const strategy = url.searchParams.get("strategy")?.trim().slice(0, 120) || null;
      const mode = parsePickMode(url.searchParams.get("mode"));
      const since = days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      send(res, 200, {
        ...db.hitRateStats(days, strategy, mode),
        // The odds, break-even hit rate, range and return that the headline hit rate needs beside it.
        context: computeHitRateContext(db, db.statsSettledIds(days, strategy, mode), since),
      });
      return;
    }

    if (req.method === "GET" && path === "/internal/performance") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        log.warn("GET /internal/performance called but ADMIN_INTERNAL_KEY is not set on the engine.");
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(rawUrl, "http://internal");
      const daysParam = Number(url.searchParams.get("days"));
      const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 3650) : null;
      send(res, 200, { cells: db.performanceCells(days, parsePickMode(url.searchParams.get("mode"))) });
      return;
    }

    if (req.method === "GET" && path === "/internal/schedule") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(rawUrl, "http://internal");
      const today = ukDateOf(new Date());
      const asked = url.searchParams.get("date") ?? "";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;
      const day = db.getScheduleDay(date);
      const status = readPullStatus(db);
      send(res, 200, {
        date,
        today,
        tomorrow: addDays(today, 1),
        pulledAt: day.pulledAt,
        fixtures: day.fixtures,
        pull: {
          configured: Boolean(process.env.API_FOOTBALL_KEY),
          lastSuccessAt: status.lastSuccessAt,
          lastError: status.lastError,
        },
      });
      return;
    }

    if (path === "/internal/fresh-start" && (req.method === "GET" || req.method === "POST")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (typeof body.start !== "boolean") {
          send(res, 400, { error: "start_must_be_true_or_false" });
          return;
        }
        db.setFreshStart(body.start ? new Date().toISOString() : null);
        log.info(body.start ? "Fresh start: figures now count from this moment." : "Fresh start undone: all figures count again.");
      }
      send(res, 200, { at: db.getFreshStart() });
      return;
    }

    if (req.method === "GET" && path === "/internal/leagues") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      send(res, 200, { leagues: db.listLeaguesForAdmin() });
      return;
    }

    if (req.method === "POST" && path === "/internal/leagues/update") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const key = typeof body.key === "string" ? body.key.trim() : "";
      if (!key || key.length > 200) {
        send(res, 400, { error: "key_required" });
        return;
      }
      const patch: { hidden?: boolean; reset?: boolean; country?: string | null; tier?: number | null; noSend?: boolean } = {};
      if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
      if (typeof body.reset === "boolean") patch.reset = body.reset;
      if (typeof body.country === "string" || body.country === null) patch.country = body.country;
      if (typeof body.tier === "number" || body.tier === null) patch.tier = body.tier;
      if (typeof body.noSend === "boolean") patch.noSend = body.noSend;
      db.updateLeague(key, patch);
      log.info(`League "${key}" updated from the admin Leagues page (${Object.keys(patch).join(", ") || "no changes"}).`);
      send(res, 200, { ok: true });
      return;
    }

    // The automatic import: a script beside the betting software posts its bet history export here (see tools/bf-import.ps1).
    if (req.method === "POST" && path.startsWith(BETFAIR_IMPORT_PREFIX)) {
      const importToken = process.env.BETFAIR_IMPORT_TOKEN;
      const provided = path.slice(BETFAIR_IMPORT_PREFIX.length);
      if (!importToken || !verifyPathToken(provided, importToken)) {
        send(res, 404, { error: "not_found" });
        return;
      }
      let csv: string;
      try {
        csv = decodeCsv(await readBody(req, MAX_IMPORT_BYTES));
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          send(res, 413, { error: "too_large", message: "The file is over 8 MB. Export a shorter date range." }, true);
          return;
        }
        throw err;
      }
      try {
        const params = new URL(rawUrl, "http://internal").searchParams;
        const name = params.get("name")?.slice(0, 120) || "automatic import";
        // The PC's zone name handles clock changes; its current offset is the fallback for a zone not recognised.
        const basis = zoneFromName(params.get("tz")) ?? parseUtcOffset(params.get("utcOffset"));
        const summary = importBetHistory(db, csv, name, new Date(), basis);
        log.info(`Betfair import (${name}): ${summary.added} new, ${summary.updated} updated, ${summary.linked} linked to picks.`);
        send(res, 200, { ...summary });
      } catch (err) {
        send(res, 422, { error: "unreadable", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (path === "/internal/betfair/import" && req.method === "POST") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req, MAX_IMPORT_BYTES);
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          send(res, 413, { error: "too_large", message: "The file is over 8 MB. Export a shorter date range." }, true);
          return;
        }
        throw err;
      }
      if (typeof body.csv !== "string" || body.csv.trim() === "") {
        send(res, 400, { error: "csv_required", message: "The file is empty." });
        return;
      }
      try {
        const name = typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 120) : "upload";
        const basis = zoneFromName(typeof body.timeZone === "string" ? body.timeZone : null) ?? parseUtcOffset(body.utcOffset);
        const summary = importBetHistory(db, body.csv, name, new Date(), basis);
        log.info(`Betfair import (${name}) from the admin page: ${summary.added} new, ${summary.updated} updated, ${summary.linked} linked to picks.`);
        send(res, 200, { ...summary });
      } catch (err) {
        send(res, 422, { error: "unreadable", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (path === "/internal/betfair/acknowledge" && req.method === "POST") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const ids = Array.isArray(body.betIds) ? body.betIds.filter((x): x is string => typeof x === "string").slice(0, 5000) : [];
      if (ids.length === 0 || typeof body.acknowledged !== "boolean") {
        send(res, 400, { error: "betIds and acknowledged are required" });
        return;
      }
      const changed = db.acknowledgeBetfairBets(ids, body.acknowledged ? new Date().toISOString() : null);
      // A restored bet gets another chance to link.
      if (!body.acknowledged) matchBets(db);
      log.info(`Reconcile: ${changed} unlinked bet(s) ${body.acknowledged ? "acknowledged" : "restored"} from the admin page.`);
      send(res, 200, { changed });
      return;
    }

    if (path === "/internal/betfair/placements" && req.method === "GET") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const link = getBetfairLinkStatus();
      send(res, 200, { link, picks: link.configured ? pickPlacements(db, link) : {} });
      return;
    }

    if (path === "/internal/betfair/reconcile" && req.method === "GET") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      send(res, 200, { ...computeReconcile(db), importTokenConfigured: Boolean(process.env.BETFAIR_IMPORT_TOKEN), betfairLink: getBetfairLinkStatus() });
      return;
    }

    if (req.method === "GET" && path.startsWith(FEED_PREFIX)) {
      const feedToken = process.env.BET_FEED_TOKEN;
      const provided = path.slice(FEED_PREFIX.length).replace(/\.csv$/i, "");
      // Same answer for "not configured" and "wrong token", so the link can't be probed.
      if (!feedToken || !verifyPathToken(provided, feedToken)) {
        send(res, 404, { error: "not_found" });
        return;
      }
      const ua = req.headers["user-agent"];
      noteFeedFetched(Array.isArray(ua) ? ua[0] : ua);
      const feed = buildFeed(db, { markSent: true });
      if (feed.newlySent > 0) {
        log.info(`Bet feed: ${feed.newlySent} new pick(s) handed over (${feed.rows.length} row(s) served).`);
      }
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Length": Buffer.byteLength(feed.csv),
        "Cache-Control": "no-store",
      });
      res.end(feed.csv);
      return;
    }

    if (path === "/internal/winloss" && (req.method === "GET" || req.method === "PUT")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "PUT") {
        const before = getWinLossSettings(db);
        const after = saveWinLossSettings(db, await readJsonBody(req));
        if (before.expenditure.enabled !== after.expenditure.enabled) {
          log.info(`Expenditure was switched ${after.expenditure.enabled ? "ON" : "OFF"} on the Win/Loss page.`);
        }
      }
      const winLossMode = parsePickMode(new URL(rawUrl, "http://internal").searchParams.get("mode"));
      send(res, 200, { ...computeWinLoss(db, new Date(), winLossMode) });
      return;
    }

    if (path === "/internal/users" || path.startsWith("/internal/users/")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      await handleUsersRoute({
        method: req.method ?? "GET",
        path,
        url: new URL(rawUrl, "http://internal"),
        db,
        res,
        send,
        readJsonBody: () => readJsonBody(req),
      });
      return;
    }

    if (path === "/internal/access" && (req.method === "GET" || req.method === "PUT")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "PUT") {
        const body = await readJsonBody(req);
        if (typeof body.publicView !== "boolean") {
          send(res, 400, { error: "publicView_must_be_true_or_false" });
          return;
        }
        setPublicView(db, body.publicView);
        log.info(`Public view was switched ${body.publicView ? "ON" : "OFF"} from the admin page.`);
      }
      send(res, 200, { publicView: getPublicView(db) });
      return;
    }

    if (req.method === "POST" && path === "/internal/picks/result") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : null;
      const result = body.result === "hit" || body.result === "miss" ? body.result : body.result === null ? null : undefined;
      if (id === null || result === undefined) {
        send(res, 400, { error: "id_and_result_required" });
        return;
      }
      if (!db.setResultOverride(id, result)) {
        send(res, 404, { error: "no_such_pick" });
        return;
      }
      log.info(`Pick ${id} result ${result === null ? "reset to the alert's own result" : `set by hand to ${result}`} from the admin page.`);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && path === "/internal/picks/exclude") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : null;
      if (id === null || typeof body.excluded !== "boolean") {
        send(res, 400, { error: "id_and_excluded_required" });
        return;
      }
      if (!db.setPickExcluded(id, body.excluded)) {
        send(res, 404, { error: "no_such_pick" });
        return;
      }
      log.info(`Pick ${id} ${body.excluded ? "excluded (didn't actually bet)" : "restored"} from the admin page.`);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && path === "/internal/strategies") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const settings = getSendingSettings(db);
      const returns = computeStrategyReturns(db);
      send(res, 200, {
        ignored: Object.values(db.getIgnoredStrategies()).sort(),
        strategies: db.listStrategiesForAdmin().map((x) => ({
          ...x,
          returns: returns[x.label.toLowerCase()] ?? null,
          sendingOn: settings.strategies[x.label.toLowerCase()] === true,
          // Live only when both this strategy's switch and the master switch are on; otherwise its picks are simulated.
          mode: settings.enabled && settings.strategies[x.label.toLowerCase()] === true ? "live" : "sim",
          stake: settings.stakes[x.label.toLowerCase()] ?? null,
        })),
      });
      return;
    }

    if (req.method === "GET" && path === "/internal/strategies/equity") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(rawUrl, "http://internal");
      const label = url.searchParams.get("label")?.trim().slice(0, 120) ?? "";
      if (!label) {
        send(res, 400, { error: "label_required" });
        return;
      }
      send(res, 200, { label, ...computeStrategyEquity(db, label, parsePickMode(url.searchParams.get("mode"))) });
      return;
    }

    if (req.method === "POST" && path === "/internal/strategies/ignore") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!label || typeof body.ignored !== "boolean") {
        send(res, 400, { error: "label_and_ignored_required" });
        return;
      }
      db.setStrategyIgnored(label, body.ignored);
      log.info(`Strategy "${label}": new alerts are now ${body.ignored ? "ignored" : "accepted again"}.`);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && path === "/internal/strategies/merge") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const from = typeof body.from === "string" ? body.from.trim() : "";
      const into = typeof body.into === "string" ? body.into.trim() : null;
      if (!from || (body.into !== null && body.into !== undefined && !into)) {
        send(res, 400, { error: "from_and_into_required" });
        return;
      }
      const result = db.setStrategyMerge(from, into || null);
      if (!result.ok) {
        send(res, 409, { error: result.error });
        return;
      }
      log.info(into ? `Strategy "${from}" is now reported under "${into}".` : `Strategy "${from}" is no longer merged.`);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && path === "/internal/strategies/remove") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!label) {
        send(res, 400, { error: "label_required" });
        return;
      }
      // A strategy that is still switched on for sending can't be deleted: switch it off first.
      if (getSendingSettings(db).strategies[label.toLowerCase()] === true) {
        send(res, 409, { error: "Switch this strategy off on the Sending page before deleting it." });
        return;
      }
      const result = db.removeStrategyPicks(label);
      // With includeSent, picks sent to bet before today (and over 2 hours ago) are deleted for good too, so the
      // strategy disappears completely. Ones sent today still count towards the daily limit, so they stay until tomorrow.
      let sentRecordsDeleted = 0;
      if (body.includeSent === true) {
        const twoHoursAgo = Date.now() - 2 * 3_600_000;
        const startOfToday = Date.parse(ukDayBounds(ukDateOf(new Date())).from);
        sentRecordsDeleted = db.removeSentRecords(label, new Date(Math.min(twoHoursAgo, startOfToday)).toISOString());
      }
      // Sent picks still kept are taken out of every result and figure once they are over 2 hours old, so a
      // deleted strategy can't keep skewing the Dashboard and Win/Loss.
      const hiddenFromResults = db.excludeSentPicks(label, new Date(Date.now() - 2 * 3_600_000).toISOString());
      const ignoreFuture = body.ignoreFuture === true;
      if (ignoreFuture) db.setStrategyIgnored(label, true);
      db.forgetStrategyMerges(label);
      forgetStopLoss(db, label);
      const key = label.toLowerCase();
      saveSendingSettings(db, { strategies: { [key]: false }, stakes: { [key]: null }, minOdds: { [key]: null } });
      log.info(
        `Strategy "${label}" removed from the admin page: ${result.removed} pick(s) deleted, ` +
          `${result.keptBecauseSent - sentRecordsDeleted} sent pick(s) kept (${hiddenFromResults} taken out of results), ` +
          `${sentRecordsDeleted} sent record(s) deleted${ignoreFuture ? ", new alerts ignored" : ""}.`,
      );
      send(res, 200, {
        ...result,
        keptBecauseSent: result.keptBecauseSent - sentRecordsDeleted,
        sentRecordsDeleted,
        hiddenFromResults,
        ignoring: ignoreFuture,
      });
      return;
    }

    if (path === "/internal/sending" && (req.method === "GET" || req.method === "PUT")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "PUT") {
        try {
          const before = getSendingSettings(db);
          const body = await readJsonBody(req);
          const after = saveSendingSettings(db, body);
          // Stop loss limits ride along: { stopLoss: { "strategy name": { dailyLoss, lossRun, resume } } }
          if (body.stopLoss && typeof body.stopLoss === "object") {
            for (const [k, v] of Object.entries(body.stopLoss as Record<string, unknown>)) {
              if (v && typeof v === "object") {
                saveStopLossRule(db, k, v as Record<string, unknown>);
                log.info(`Stop loss for "${k}" changed from the admin page (${Object.keys(v as object).join(", ")}).`);
              }
            }
          }
          if (before.enabled !== after.enabled) {
            log.info(`Sending was switched ${after.enabled ? "ON" : "OFF"} from the admin page.`);
          }
        } catch (err) {
          if (err instanceof BodyTooLarge) {
            send(res, 413, { error: "body_too_large" });
            return;
          }
          throw err;
        }
      }
      const settings = getSendingSettings(db);
      const preview = buildFeed(db, { markSent: false });
      // Every strategy seen so far, so each one gets a switch even before it is turned on.
      const stops = computeStopLoss(db);
      // The same limits run on each strategy's simulated bets: "would have stopped" for Sim strategies.
      const simStops = computeStopLoss(db, new Date(), "sim");
      const counts = new Map(db.listStrategiesForAdmin().map((x) => [x.label.toLowerCase(), x]));
      const seen = new Map<
        string,
        {
          label: string;
          market: string | null;
          enabled: boolean;
          stake: number | null;
          minOdds: number | null;
          alerts: number;
          sent: number;
          stopLoss: ReturnType<typeof computeStopLoss> extends Map<string, infer V> ? V | null : never;
          simStopLoss: ReturnType<typeof computeStopLoss> extends Map<string, infer V> ? V | null : never;
        }
      >();
      // Every strategy ever seen, whatever the Leagues page hides, so a switch can always be turned off.
      for (const st of db.listStrategiesSeen()) {
        const key = st.label.toLowerCase();
        seen.set(key, {
          label: st.label,
          market: st.market,
          enabled: settings.strategies[key] === true,
          stake: settings.stakes[key] ?? null,
          minOdds: settings.minOdds[key] ?? null,
          alerts: counts.get(key)?.alerts ?? 0,
          sent: counts.get(key)?.sent ?? 0,
          stopLoss: stops.get(key) ?? null,
          simStopLoss: simStops.get(key) ?? null,
        });
      }
      send(res, 200, {
        settings,
        strategies: [...seen.values()],
        feedTokenConfigured: Boolean(process.env.BET_FEED_TOKEN),
        lastFeedFetchAt: getLastFeedFetchAt(),
        lastFeedFetcher: getLastFeedFetcher(),
        preview: { rows: preview.rows, skipped: preview.skipped.slice(-20), csv: preview.csv, blockedReason: preview.blockedReason },
      });
      return;
    }

    if (path.startsWith("/internal/telegram/")) {
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      await handleTelegramAdmin(req, res, path, db);
      return;
    }

    if (path.startsWith(WEBHOOK_PREFIX)) {
      const token = path.slice(WEBHOOK_PREFIX.length);
      if (!verifyPathToken(token, env.webhookPathToken)) {
        send(res, 404, { error: "not_found" });
        return;
      }
      if (req.method !== "POST") {
        send(res, 405, { error: "method_not_allowed" });
        return;
      }

      let body: Buffer;
      try {
        body = await readBody(req);
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          send(res, 413, { error: "payload_too_large" }, true);
          return;
        }
        throw err;
      }

      let signatureVerified = false;
      if (env.signingSecret && env.signatureHeader) {
        const header = req.headers[env.signatureHeader];
        const value = Array.isArray(header) ? header[0] : header;
        if (!verifyHmacSignature(body, value, env.signingSecret)) {
          log.warn("Rejected an InPlayGuru webhook with a missing or invalid signature.");
          send(res, 401, { error: "invalid_signature" });
          return;
        }
        signatureVerified = true;
      }

      const outcome = handleVerifiedPick(db, body, req.headers["content-type"] ?? null, signatureVerified);
      send(res, 200, { status: outcome });
      return;
    }

    send(res, 404, { error: "not_found" });
  }

  async function handleTelegramAdmin(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    dbRef: EngineDb,
  ): Promise<void> {
    if (req.method === "POST" && path === "/internal/telegram/login/start") {
      log.info("Received POST /internal/telegram/login/start.");
      const apiIdRaw = process.env.TELEGRAM_API_ID;
      const apiHash = process.env.TELEGRAM_API_HASH;
      if (!apiIdRaw || !apiHash) {
        send(res, 500, { error: "TELEGRAM_API_ID and TELEGRAM_API_HASH must be set on the engine first." });
        return;
      }
      const apiId = Number(apiIdRaw);
      const body = await readJsonBody(req);
      log.info("Parsed request body for Telegram login start.");
      const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
      if (!phoneNumber) {
        send(res, 400, { error: "phoneNumber is required." });
        return;
      }
      if (loginFlow.status === "connecting" || loginFlow.status === "awaiting_code" || loginFlow.status === "awaiting_password") {
        send(res, 409, { error: "A login is already in progress.", status: loginFlow.status });
        return;
      }

      loginFlow.reset();
      loginFlow.status = "connecting";
      log.info("About to send 'started' response for Telegram login.");
      // Reply immediately, before touching GramJS: client.start() does real
      // synchronous crypto/key-exchange work the instant it's called, which
      // was delaying this response long enough for DigitalOcean's own proxy
      // to time it out with a 504 before Node ever got to send anything.
      // Deferring to the next tick guarantees this response goes out first.
      send(res, 200, { status: "started" });

      setImmediate(() => {
        const client = createTelegramClient(apiId, apiHash);
        activeTelegramClient = client;

        client
          .start({
            phoneNumber: async () => phoneNumber,
            phoneCode: async () => loginFlow.waitForCode(),
            password: async () => loginFlow.waitForPassword(),
            onError: (err) => log.error(`Telegram login error: ${err.message}`),
          })
          .then(() => {
            const sessionString = client.session.save() as unknown as string;
            loginFlow.succeed(sessionString);
            log.info("Telegram login succeeded; session string ready to save as TELEGRAM_SESSION.");
          })
          .catch((err) => {
            loginFlow.fail(err instanceof Error ? err.message : String(err));
            activeTelegramClient = null;
          });
      });
      return;
    }

    if (req.method === "POST" && path === "/internal/telegram/login/code") {
      const body = await readJsonBody(req);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!code) {
        send(res, 400, { error: "code is required." });
        return;
      }
      const ok = loginFlow.submitCode(code);
      send(res, ok ? 200 : 409, { status: loginFlow.status, accepted: ok });
      return;
    }

    if (req.method === "POST" && path === "/internal/telegram/login/password") {
      const body = await readJsonBody(req);
      const password = typeof body.password === "string" ? body.password : "";
      if (!password) {
        send(res, 400, { error: "password is required." });
        return;
      }
      const ok = loginFlow.submitPassword(password);
      send(res, ok ? 200 : 409, { status: loginFlow.status, accepted: ok });
      return;
    }

    if (req.method === "GET" && path === "/internal/telegram/login/status") {
      send(res, 200, {
        status: loginFlow.status,
        error: loginFlow.error,
        sessionString: loginFlow.sessionString,
      });
      return;
    }

    if (req.method === "GET" && path === "/internal/telegram/login/chats") {
      if (!activeTelegramClient || loginFlow.status !== "logged_in") {
        send(res, 409, { error: "Not logged in yet." });
        return;
      }
      try {
        const dialogs = await activeTelegramClient.getDialogs({ limit: 80 });
        // No group/channel filter: InPlayGuru can deliver as a group post OR
        // as a DM from a personal alerts bot (a "bot" dialog looks like a
        // private chat, not a group/channel) — list everything and let the
        // admin pick the right one.
        const chats = dialogs.map((d) => {
          const entity = d.entity as { bot?: boolean; username?: string } | undefined;
          const kind = d.isChannel ? "channel" : d.isGroup ? "group" : entity?.bot ? "bot" : "person";
          const title = d.title || (entity?.username ? `@${entity.username}` : "(untitled)");
          return { id: d.id?.toString() ?? "", title, kind };
        });
        send(res, 200, { chats });
      } catch (err) {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === "POST" && path === "/internal/telegram/login/watch") {
      if (!activeTelegramClient || loginFlow.status !== "logged_in") {
        send(res, 409, { error: "Not logged in yet." });
        return;
      }
      const body = await readJsonBody(req);
      const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
      if (!chatId) {
        send(res, 400, { error: "chatId is required." });
        return;
      }
      try {
        await startTelegramListener(activeTelegramClient, dbRef, chatId);
        send(res, 200, {
          status: "watching",
          chatId,
          sessionString: loginFlow.sessionString,
          note: "Save TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION and TELEGRAM_SOURCE_CHAT_ID (this chat id) as env vars so this survives a redeploy.",
        });
      } catch (err) {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    send(res, 404, { error: "not_found" });
  }
}