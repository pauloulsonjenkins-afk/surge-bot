/**
 * The engine's HTTP interface. Routes:
 *
 *   GET  /health                               DigitalOcean's health check
 *   POST /webhooks/inplayguru/<path token>     InPlayGuru picks
 *   GET  /internal/picks                        recent captured picks (admin site only)
 *   GET  /internal/live[?hours=N|?date=D]       parsed alerts for the Live tab and Results page, optionally for a window (admin site only)
 *   GET  /internal/live/days                    UK days that have picks, with counts, for the Results page (admin site only)
 *   GET  /internal/stats?days=N|since=ISO[&strategy=X]  hit-rate figures for Dashboard / Strategies, optionally for one strategy (admin site only)
 *   GET  /internal/schedule?date=YYYY-MM-DD     the day's matches from API-Football, for the Schedule tab (admin site only)
 *   GET/POST /internal/fresh-start              count all figures from now (or undo it); nothing is deleted (admin site only)
 *   GET  /internal/leagues                      every league seen, with its hide / reset / country / tier settings (admin site only)
 *   POST /internal/leagues/update               hide, reset or re-label one league; never deletes picks (admin site only)
 *   GET  /internal/performance?days=N|since=ISO  totals by league, strategy and alert minute, for the Dashboard's breakdown (admin site only)
 *   GET  /internal/sending                      sending options, preview and status (admin site only)
 *   PUT  /internal/sending                      change the sending options (admin site only)
 *   GET/PUT /internal/winloss                   estimated profit and loss, and its options (admin site only)
 *   GET/PUT /internal/access                    whether the public pages may be seen signed-out (admin site only)
 *   /internal/users/*                           website user sign-up, sign-in and page access (admin site only; see users-routes.ts)
 *   GET  /internal/strategies[?since=ISO]       every strategy with its counts, switch, stake and merge, counted from `since` (admin site only)
 *   GET  /internal/strategies/equity?label=X    one strategy's running profit pick by pick, with drawdown and losing runs (admin site only)
 *   POST /internal/strategies/ignore            stop or start ignoring a strategy's new alerts (admin site only)
 *   POST /internal/strategies/merge             report one strategy under another's name, or undo that (admin site only)
 *   POST /internal/strategies/remove            delete a strategy's stored picks (admin site only)
 *   POST /internal/picks/result                 amend (or reset) one pick's result (admin site only)
 *   POST /internal/picks/exclude                 mark (or unmark) a pick as "didn't actually bet" (admin site only)
 *   POST /internal/picks/clear-waiting           clear (or put back) a pick on Live's "Waiting for a result": { id, cleared } (admin site only)
 *   GET  /internal/horses                       the admin's daily horse racing bets (admin site only)
 *   PUT  /internal/horses/day                   save one day's NAP / Next best / 3rd / 4th choice and EW Yankee (admin site only)
 *   POST /internal/horses/result                mark one horse bet won, lost, void or pending (admin site only)
 *   GET  /feeds/bets/<feed token>.csv           the bet feed the betting software polls
 *   POST /imports/betfair/<import token>        the betting software's bet history export (CSV body), posted by tools/bf-import.ps1
 *   POST /internal/betfair/import               the same, uploaded on the admin Reconcile page (admin site only)
 *   GET  /internal/betfair/reconcile            real bets against the app's estimates, per strategy (admin site only)
 *   GET  /internal/betfair/placements           whether each recently sent pick was placed and matched on Betfair (admin site only)
 *   POST /internal/picks/manual-bet             log (or clear) a bet the admin placed by hand on a pick (admin site only)
 *   GET  /internal/betfair/unplaced             sent picks with no Betfair bet 3 minutes on, last 24 hours (admin site only)
 *   POST /internal/betfair/unplaced/clear       clear reviewed picks from that list: { ids } (admin site only)
 *   POST /internal/betfair/unplaced/fix         add Betfair's team spelling to Match names and re-send the pick: { id } (admin site only)
 *   GET  /internal/strategy-names               the names and descriptions the app shows for strategies (admin site only)
 *   POST /internal/strategy-names               change one: { key, name, description }; empty goes back to the default (admin site only)
 *   GET  /internal/push                         the push key and how many devices get notifications (admin site only)
 *   POST /internal/push/subscribe|unsubscribe|test  add or remove a device, or send it a test (admin site only)
 *   GET  /internal/picks/discrepancies          results the alert's own tick disagrees with, still to review (admin site only)
 *   POST /internal/picks/review                 accept a reviewed result (admin site only)
 *   GET/POST /internal/betfair/coverage         which leagues are on Betfair: those your alerts came from, or a pasted list (admin site only)
 *   POST /internal/betfair/match-name           add an "alert name = Betfair name" Match names line and re-link bets (admin site only)
 *   POST /internal/betfair/use-match            a pick not found on Betfair: use one of the events offered: { id, event } (admin site only)
 *   POST /internal/betfair/coverage/override    which Betfair competition a league is: { league, competition | "none" | null } (admin site only)
 *   GET/PUT /internal/direct                    direct betting: mode, limits, readiness, recent bets and webhooks (admin site only)
 *   GET  /internal/direct/export                every direct betting record as CSV, for Excel (admin site only)
 *   GET  /internal/picks/export                 every pick ever received, with stats, prices, results and money, as CSV for Excel (admin site only)
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
import { fixAndResend, listUnplaced, UNPLACED_AFTER_MS, chooseBetfairMatch } from "../betfair/unplaced";
import { listStrategyNames, saveStrategyName } from "../inplayguru/strategy-names";
import { parseSubscription, pushPublicKey, sendPush, subscribePush } from "./push";
import { buildDailySummary } from "./daily-summary";
import { picksExportCsv } from "./picks-export";
import type { BackupScheduler } from "../storage/spaces-sync";
import type { ServerEnv } from "./server-env";
import { sha256Hex, verifyHmacSignature, verifyPathToken } from "../inplayguru/verify";
import { parseAlert } from "../inplayguru/parse-alert";
import { alertTextFrom, handleVerifiedPick, useWebhookAlert } from "../inplayguru/receiver";
import { directExportCsv, directIsLive, directReadiness, effectiveMode, getDirectSettings, saveDirectSettings, stakedToday, wake as wakeDirect } from "../betfair/direct";
import { createTelegramClient } from "../telegram/client";
import { loginFlow } from "../telegram/session-flow";
import { getListenerStatus, startTelegramListener } from "../telegram/listener";
import { telegramHealth } from "./telegram-watchdog";
import { computeStopLoss, forgetStopLoss, saveStopLossRule } from "../inplayguru/stop-loss";
import { currentStake, getBank } from "../inplayguru/stake";
import { addMatchName, buildFeed, EXCHANGE_HOLD_MS, getLastFeedFetchAt, getLastFeedFetcher, getSendingSettings, noteFeedFetched, recordSimBets, saveSendingSettings, toCsv } from "../inplayguru/bet-feed";
import { getPublicView, setPublicView } from "./access-settings";
import { handleUsersRoute } from "./users-routes";
import { computeHitRateContext, computePickProfits, computeStrategyEquity, computeStrategyReturns, computeWinLoss, getWinLossSettings, saveWinLossSettings } from "./winloss";
import { log } from "./log";
import { listHorseBets, listHorseCourses, listHorseDays, parseOdds, RACECOURSES, saveHorseDay, setHorseResult } from "./horses";
import { computeReconcile, decodeCsv, importBetHistory, matchBets, zoneFromName } from "../betfair/reconcile";
import { cornerMarketsSeen, getBetfairLinkStatus, pickPlacements, requestExchangeCheck, teamMarketsSeen } from "../betfair/exchange";
import { checkLeague, coverageOfAlertLeagues, fixtureLeagueChecker, saveLeagueList, savedListCoverage, setLeagueOverride } from "../betfair/competitions";
import { isUkDate, ukDayBounds } from "./uk-time";
import { addDays, readPullStatus, ukDateOf } from "../fixtures/daily-pull";
import { handleMembersRoute } from "../members/routes";
import { membersLiveDeps, wakeMembers } from "../members/runner";
import { stripeWebhook } from "../members/stripe";

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

/**
 * The last answer to the same request, reused while nothing in the database has changed (and for at most a minute,
 * so figures that move with the clock still roll on). The Dashboard, Strategies and Win/Loss poll every 15-30 seconds,
 * and each answer re-reads every settled pick: between alerts and results the data is the same, so is the answer.
 */
const responseMemo = new WeakMap<EngineDb, Map<string, { version: number; at: number; body: Record<string, unknown> }>>();
const MEMO_MAX_AGE_MS = 60_000;

function memoized(db: EngineDb, key: string, compute: () => Record<string, unknown>): Record<string, unknown> {
  let byKey = responseMemo.get(db);
  if (!byKey) responseMemo.set(db, (byKey = new Map()));
  const version = db.changeCount();
  const hit = byKey.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < MEMO_MAX_AGE_MS) return hit.body;
  const body = compute();
  byKey.set(key, { version, at: Date.now(), body });
  // Oldest first out, so a run of different requests can't grow it without limit.
  if (byKey.size > 100) byKey.delete(byKey.keys().next().value as string);
  return body;
}

/** A "since" query value as an ISO time, or null when missing or not a date. */
function sinceParam(url: URL): string | null {
  const raw = url.searchParams.get("since");
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Now minus `days`, to the whole minute, so the same window asked twice within a minute is the same question. */
function daysBack(days: number): string {
  return new Date(Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 60_000) * 60_000).toISOString();
}

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

    // For an outside uptime monitor: 503 while Telegram alerts aren't arriving (see telegram-watchdog.ts). Not used as
    // DigitalOcean's health check, which must stay on /health.
    if (req.method === "GET" && path === "/health/telegram") {
      const h = telegramHealth(db);
      send(res, h.ok ? 200 : 503, h);
      return;
    }

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
      const window = range ? `${range.from.slice(0, 16)}:${range.to.slice(0, 16)}` : "latest";
      send(
        res,
        200,
        memoized(db, `live:${limit}:${window}`, () => {
          const picks = db.listLivePicks(limit, range);
          // Profit per settled pick, for the admin's Trade Log. Worked out exactly as Win/Loss does.
          const oldest = picks.reduce<string | null>((min, p) => (min === null || p.firstSeenAt < min ? p.firstSeenAt : min), null);
          const profits = oldest ? computePickProfits(db, oldest) : {};
          return { picks: picks.map((p) => ({ ...p, pnl: profits[p.id] ?? null })) };
        }),
      );
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
      const since = sinceParam(url) ?? (days === null ? null : daysBack(days));
      send(
        res,
        200,
        memoized(db, `stats:${since}:${strategy ?? ""}:${mode}`, () => ({
          ...db.hitRateStats(days, strategy, mode, since),
          // The odds, break-even hit rate, range, return and profit that the headline figures need beside them.
          context: computeHitRateContext(db, db.statsSettledIds(days, strategy, mode, since), since),
        })),
      );
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
      const mode = parsePickMode(url.searchParams.get("mode"));
      const since = sinceParam(url) ?? (days === null ? null : daysBack(days));
      send(res, 200, memoized(db, `performance:${since}:${mode}`, () => ({ cells: db.performanceCells(days, mode, since) })));
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
      // Only games that can be bet: fixtures in leagues not on Betfair (as the Leagues page judges them) are left out.
      const onBetfair = fixtureLeagueChecker(db);
      const fixtures = onBetfair ? day.fixtures.filter((f) => onBetfair(f.league, f.country) !== "not") : day.fixtures;
      send(res, 200, {
        date,
        today,
        tomorrow: addDays(today, 1),
        pulledAt: day.pulledAt,
        fixtures,
        notOnBetfair: day.fixtures.length - fixtures.length,
        betfairChecked: onBetfair !== null,
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
      const patch: { hidden?: boolean; reset?: boolean; country?: string | null; tier?: number | null; noSend?: boolean; keep?: boolean; ipgDone?: boolean } = {};
      if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
      if (typeof body.reset === "boolean") patch.reset = body.reset;
      if (typeof body.country === "string" || body.country === null) patch.country = body.country;
      if (typeof body.tier === "number" || body.tier === null) patch.tier = body.tier;
      if (typeof body.noSend === "boolean") patch.noSend = body.noSend;
      if (typeof body.keep === "boolean") patch.keep = body.keep;
      if (typeof body.ipgDone === "boolean") patch.ipgDone = body.ipgDone;
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

    if (path === "/internal/strategy-names") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "GET") {
        send(res, 200, { names: listStrategyNames(db) });
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        try {
          saveStrategyName(db, body.key, body.name, body.description);
        } catch (err) {
          send(res, 400, { error: "invalid", message: err instanceof Error ? err.message : "Couldn't save that name." });
          return;
        }
        send(res, 200, { names: listStrategyNames(db) });
        return;
      }
      send(res, 405, { error: "method_not_allowed" });
      return;
    }

    if (path === "/internal/betfair/unplaced" || path === "/internal/betfair/unplaced/clear" || path === "/internal/betfair/unplaced/fix" || path === "/internal/push" || path.startsWith("/internal/push/")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (path === "/internal/betfair/unplaced" && req.method === "GET") {
        const link = getBetfairLinkStatus();
        send(res, 200, { afterMinutes: UNPLACED_AFTER_MS / 60_000, configured: link.configured, picks: listUnplaced(db, link.lastOkAt) });
        return;
      }
      if (path === "/internal/push" && req.method === "GET") {
        send(res, 200, { publicKey: pushPublicKey(db), devices: db.listPushSubscriptions().map((s) => ({ label: s.label, createdAt: s.createdAt })) });
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (path === "/internal/betfair/unplaced/fix") {
          if (!Number.isInteger(body.id)) {
            send(res, 400, { error: "invalid", message: "No pick given." });
            return;
          }
          try {
            send(res, 200, { ok: true, ...fixAndResend(db, body.id as number) });
          } catch (err) {
            send(res, 400, { error: "invalid", message: err instanceof Error ? err.message : "Couldn't fix that pick." });
          }
          return;
        }
        if (path === "/internal/betfair/unplaced/clear") {
          const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is number => Number.isInteger(x)) : [];
          if (ids.length === 0) {
            send(res, 400, { error: "invalid", message: "No picks given to clear." });
            return;
          }
          const cleared = db.clearUnplaced(ids, new Date().toISOString());
          log.info(`Not placed: ${cleared} pick${cleared === 1 ? "" : "s"} cleared by the admin.`);
          send(res, 200, { ok: true, cleared });
          return;
        }
        if (path === "/internal/push/subscribe") {
          const sub = parseSubscription(body.subscription);
          if (!sub) {
            send(res, 400, { error: "invalid", message: "That browser didn't give a usable subscription." });
            return;
          }
          const label = typeof body.label === "string" ? body.label.slice(0, 80) : null;
          subscribePush(db, sub, label, typeof body.origin === "string" ? body.origin : null);
          log.info(`Push: a device was added${label ? ` (${label})` : ""}.`);
          send(res, 200, { ok: true });
          return;
        }
        if (path === "/internal/push/unsubscribe") {
          send(res, 200, { ok: typeof body.endpoint === "string" && db.deletePushSubscription(body.endpoint) });
          return;
        }
        if (path === "/internal/push/test") {
          const reached = await sendPush(db, { title: "Notifications are on", body: "You'll get one when a sent pick isn't placed within 3 minutes, and today's results at 06:50, 14:00, 17:00 and 21:30.", url: "/more/admin/sending", tag: "test" });
          // And today's summary as it stands, so its look can be checked without waiting for the next one.
          await sendPush(db, { ...buildDailySummary(db), url: "/dashboard", tag: "summary-test" });
          send(res, 200, { reached });
          return;
        }
      }
      send(res, 404, { error: "not_found" });
      return;
    }

    if ((path === "/internal/picks/manual-bet" || path === "/internal/picks/review") && req.method === "POST") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) {
        send(res, 400, { error: "invalid", message: "No such pick." });
        return;
      }
      if (path === "/internal/picks/review") {
        if (!db.setResultReviewed(id, body.ok !== false)) send(res, 404, { error: "no_such_pick" });
        else send(res, 200, { ok: true });
        return;
      }
      // Logging a bet placed by hand: { id, stake, odds } (odds as 5/2, evens or 3.5), or { id, clear: true }.
      if (body.clear === true) {
        db.setManualBet(id, null);
        send(res, 200, { ok: true });
        return;
      }
      const stake = Number(String(body.stake ?? "").replace(/^£/, ""));
      const odds = parseOdds(body.odds);
      if (!Number.isFinite(stake) || stake <= 0 || stake > 100000) {
        send(res, 400, { error: "invalid", message: "Enter the amount you staked, for example 5 or 2.50." });
        return;
      }
      if (odds === null) {
        send(res, 400, { error: "invalid", message: "Enter the odds you got: a fraction (5/2), evens, or a decimal (3.5)." });
        return;
      }
      if (!db.setManualBet(id, { stake: Math.round(stake * 100) / 100, odds })) {
        send(res, 404, { error: "no_such_pick" });
        return;
      }
      log.info(`Pick ${id} logged as placed by hand: £${stake.toFixed(2)} at ${odds}.`);
      // A bet placed by hand on Betfair can link to the pick now.
      matchBets(db);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && path === "/internal/picks/discrepancies") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      send(res, 200, { picks: db.listResultDiscrepancies() });
      return;
    }

    if (path === "/internal/betfair/coverage" && (req.method === "GET" || req.method === "POST")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const competitions = db.listBetfairCompetitions();
      const latest = competitions.reduce<string | null>((m, c) => (m === null || c.lastSeen > m ? c.lastSeen : m), null);
      const base = { competitionCount: competitions.length, competitionsUpdatedAt: latest };
      if (req.method === "GET") {
        // The competition names too, to choose from when a league is matched by hand.
        const names = [...new Set(competitions.map((c) => c.name))].sort((a, b) => a.localeCompare(b));
        send(res, 200, { ...base, leagues: coverageOfAlertLeagues(db), saved: savedListCoverage(db), competitions: names });
        return;
      }
      // POST { names: [...] }: a pasted list, e.g. InPlayGuru's leagues.
      const body = await readJsonBody(req, MAX_IMPORT_BYTES);
      const names = Array.isArray(body.names)
        ? [...new Set(body.names.filter((n): n is string => typeof n === "string").map((n) => n.replace(/\s+/g, " ").trim()).filter((n) => n.length > 1 && n.length <= 120))].slice(0, 5000)
        : [];
      // { save: true } keeps the list, so it's re-checked as Betfair's competitions build up.
      if (body.save === true && names.length > 0) saveLeagueList(db, names);
      send(res, 200, { ...base, leagues: names.map((n) => checkLeague(n, competitions)) });
      return;
    }

    if ((path === "/internal/betfair/use-match" || path === "/internal/betfair/coverage/override") && req.method === "POST") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      try {
        if (path === "/internal/betfair/use-match") {
          const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : NaN;
          if (!Number.isFinite(id) || typeof body.event !== "string") throw new Error("id and event are needed.");
          send(res, 200, chooseBetfairMatch(db, id, body.event));
        } else {
          setLeagueOverride(db, body.league, body.competition);
          log.info(`League "${String(body.league)}" set to Betfair's "${String(body.competition)}" on the Leagues page.`);
          send(res, 200, { ok: true });
        }
      } catch (err) {
        send(res, 400, { error: "invalid", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (path === "/internal/betfair/match-name" && req.method === "POST") {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const body = await readJsonBody(req);
      try {
        const line = addMatchName(db, body.from, body.to);
        // Bets on picks sent under the old spelling can link now.
        const linked = matchBets(db);
        log.info(`Match name added from Reconcile: "${line}" (${linked} bet(s) linked).`);
        send(res, 200, { line, linked });
      } catch (err) {
        send(res, 400, { error: "invalid", message: err instanceof Error ? err.message : String(err) });
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

    if (path.startsWith("/internal/horses")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      try {
        if (req.method === "GET" && path === "/internal/horses") {
          send(res, 200, { bets: listHorseBets(db), days: listHorseDays(db), courses: listHorseCourses(db), knownCourses: RACECOURSES });
          return;
        }
        if (req.method === "PUT" && path === "/internal/horses/day") {
          const body = await readJsonBody(req);
          send(res, 200, { bets: saveHorseDay(db, body.day, body.entries, body.yankeeStake ?? null) });
          return;
        }
        if (req.method === "POST" && path === "/internal/horses/result") {
          const body = await readJsonBody(req);
          setHorseResult(db, body.id, body.result);
          send(res, 200, { ok: true });
          return;
        }
      } catch (err) {
        // The reasons are written for the admin ("NAP: enter the odds as..."), so they are passed on.
        send(res, 400, { error: "invalid", message: err instanceof Error ? err.message : String(err) });
        return;
      }
      send(res, 404, { error: "not_found" });
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
      // Without the Betfair check, only bets logged as placed by hand are known (they don't need Betfair).
      const all = pickPlacements(db, link);
      const picks = link.configured ? all : Object.fromEntries(Object.entries(all).filter(([, v]) => v.manual));
      send(res, 200, { link, picks });
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
      send(res, 200, {
        ...computeReconcile(db),
        importTokenConfigured: Boolean(process.env.BETFAIR_IMPORT_TOKEN),
        betfairLink: getBetfairLinkStatus(),
        cornerMarkets: cornerMarketsSeen(db),
        teamMarkets: teamMarketsSeen(db),
      });
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
      // GoalBrew places the bets itself (Direct betting: Live), so the betting software is handed nothing.
      if (directIsLive(db)) {
        const csv = toCsv([]);
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Length": Buffer.byteLength(csv), "Cache-Control": "no-store" });
        res.end(csv);
        return;
      }
      const feed = buildFeed(db, { markSent: true, holdForExchangeMs: getBetfairLinkStatus().configured ? EXCHANGE_HOLD_MS : 0 });
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
      // The UK day is in the key, so "today" and the month roll over at midnight even with no new data.
      send(res, 200, memoized(db, `winloss:${winLossMode}:${ukDateOf(new Date())}`, () => ({ ...computeWinLoss(db, new Date(), winLossMode) })));
      return;
    }

    // Stripe's webhook for paid memberships: checked by its signature (members/stripe.ts), not the internal key.
    if (req.method === "POST" && path === "/webhooks/stripe") {
      const raw = await readBody(req, 256 * 1024);
      const sig = req.headers["stripe-signature"];
      const r = stripeWebhook(db, raw, Array.isArray(sig) ? sig[0] : sig);
      send(res, r.status, r.body);
      return;
    }

    if (path.startsWith("/internal/members/")) {
      if (!process.env.ADMIN_INTERNAL_KEY) {
        send(res, 500, { error: "not_configured" });
        return;
      }
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      await handleMembersRoute({
        req,
        method: req.method ?? "GET",
        path,
        url: new URL(rawUrl, "http://internal"),
        db,
        res,
        send,
        readJsonBody: () => readJsonBody(req),
        live: membersLiveDeps(),
      });
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

    if (req.method === "POST" && path === "/internal/picks/clear-waiting") {
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
      if (id === null || typeof body.cleared !== "boolean") {
        send(res, 400, { error: "id_and_cleared_required" });
        return;
      }
      if (!db.setWaitingCleared(id, body.cleared)) {
        send(res, 404, { error: "no_such_pick" });
        return;
      }
      log.info(`Pick ${id} ${body.cleared ? "cleared from" : "put back on"} Live's Waiting for a result.`);
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
      const sinceParam = new URL(rawUrl, "http://internal").searchParams.get("since");
      const sinceMs = sinceParam ? Date.parse(sinceParam) : NaN;
      const since = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null;
      const returns = computeStrategyReturns(db, since);
      send(res, 200, {
        ignored: Object.values(db.getIgnoredStrategies()).sort(),
        since,
        strategies: db.listStrategiesForAdmin(since).map((x) => ({
          ...x,
          returns: returns[x.label.toLowerCase()] ?? null,
          sendingOn: settings.strategies[x.label.toLowerCase()] === true,
          // Live only when both this strategy's switch and the master switch are on; otherwise its picks are simulated.
          mode: settings.enabled && settings.strategies[x.label.toLowerCase()] === true ? "live" : "sim",
          stake: currentStake(db, settings, x.label.toLowerCase()),
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
      saveSendingSettings(db, { strategies: { [key]: false }, stakes: { [key]: null }, stakePct: { [key]: null }, minOdds: { [key]: null } });
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

    if (path === "/internal/picks/export" && req.method === "GET") {
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const csv = picksExportCsv(db);
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Length": Buffer.byteLength(csv), "Cache-Control": "no-store" });
      res.end(csv);
      return;
    }

    if (path === "/internal/direct/export" && req.method === "GET") {
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const csv = directExportCsv(db);
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Length": Buffer.byteLength(csv), "Cache-Control": "no-store" });
      res.end(csv);
      return;
    }

    if (path === "/internal/direct" && (req.method === "GET" || req.method === "PUT")) {
      if (!isAdminAuthorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "PUT") {
        try {
          saveDirectSettings(db, await readJsonBody(req));
        } catch (err) {
          send(res, 400, { error: err instanceof Error ? err.message : "invalid" });
          return;
        }
      }
      const settings = getDirectSettings(db);
      const webhooks = db.listExternalWebhooks(10).map((w) => {
        const text = alertTextFrom(w.body);
        let summary: string | null = null;
        if (text) {
          const p = parseAlert(text);
          summary = `${p.strategyRaw}: ${p.home ?? "?"} v ${p.away ?? "?"}`;
        }
        return { receivedAt: w.receivedAt, signatureVerified: w.signatureVerified, understood: text !== null, summary, sample: w.body.slice(0, 800) };
      });
      send(res, 200, {
        settings,
        effectiveMode: effectiveMode(settings),
        readiness: await directReadiness(),
        stakedToday: stakedToday(db),
        sendingOn: getSendingSettings(db).enabled,
        strategies: db.listStrategiesForAdmin().map((s) => s.label),
        bets: db.listDirectBets(50),
        webhooks,
        webhooksTotal: db.countWebhooks(),
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
      const preview = buildFeed(db, { markSent: false, holdForExchangeMs: getBetfairLinkStatus().configured ? EXCHANGE_HOLD_MS : 0 });
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
          stakePct: number | null;
          stakeNow: number | null;
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
          stakePct: settings.stakePct[key] ?? null,
          // What a percentage stake comes to now, in pounds (null for a flat stake, or while the balance is unknown).
          stakeNow: settings.stakePct[key] === undefined ? null : currentStake(db, settings, key),
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
        // The Betfair balance percentage stakes work from (null until it has been read).
        bank: getBank(db),
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
      // "Webhook alerts: use" (Direct betting page): the alert becomes a pick, as a Telegram message does.
      if (outcome === "captured" && getDirectSettings(db).webhook === "use") {
        try {
          const used = useWebhookAlert(db, body.toString("utf8"), sha256Hex(body));
          log.info(`InPlayGuru webhook used as a pick: ${used}.`);
          if (used === "added" || used === "updated") {
            requestExchangeCheck();
            recordSimBets(db);
            wakeDirect();
            wakeMembers();
          }
        } catch (err) {
          log.error(`Could not use an InPlayGuru webhook as a pick: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
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
      // One attempt at a time, but one that has hung for 3 minutes (no code typed, or Telegram never answered) is replaced.
      const inProgress = loginFlow.status === "connecting" || loginFlow.status === "awaiting_code" || loginFlow.status === "awaiting_password";
      if (inProgress && Date.now() - loginFlow.startedAt > 3 * 60_000) {
        void activeTelegramClient?.disconnect().catch(() => {});
        activeTelegramClient = null;
      } else if (inProgress) {
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
            // GramJS calls this on every refusal and, unless told to stop, quietly tries again, which left the admin page
            // on "Connecting..." for ever. A wrong code or password may be typed again; anything else ends the attempt
            // and its reason is shown on the page.
            onError: async (err) => {
              log.error(`Telegram login error: ${err.message}`);
              const retry = /PHONE_CODE_INVALID|PASSWORD_HASH_INVALID/.test(err.message);
              loginFlow.error = telegramLoginError(err.message);
              if (retry) return false;
              loginFlow.fail(telegramLoginError(err.message));
              return true;
            },
          })
          .then(() => {
            const sessionString = client.session.save() as unknown as string;
            loginFlow.succeed(sessionString);
            log.info("Telegram login succeeded; session string ready to save as TELEGRAM_SESSION.");
          })
          .catch((err) => {
            // Keep the reason onError already gave (the catch then only sees GramJS's "AUTH_USER_CANCEL").
            if (loginFlow.status !== "error") loginFlow.fail(telegramLoginError(err instanceof Error ? err.message : String(err)));
            activeTelegramClient = null;
            void client.disconnect().catch(() => {});
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
        // Whether alerts are being read now (from a saved session or a login here), and the last one stored.
        listener: getListenerStatus(),
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
        // The session string gives full access to the Telegram account: handed over this once, then not kept here.
        loginFlow.sessionString = null;
      } catch (err) {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    send(res, 404, { error: "not_found" });
  }
}

/** Telegram's login refusals in plain English (the raw code is kept in brackets for searching). */
function telegramLoginError(raw: string): string {
  const wait = /FLOOD_WAIT_(\d+)|wait of (\d+) seconds/i.exec(raw);
  if (wait) {
    const secs = Number(wait[1] ?? wait[2]);
    const mins = Math.ceil(secs / 60);
    return `Telegram says too many login attempts: wait ${mins >= 60 ? `${Math.ceil(mins / 60)} hour(s)` : `${mins} minute(s)`} and try again. (${raw})`;
  }
  if (/PHONE_NUMBER_INVALID/.test(raw)) return `Telegram doesn't recognise that phone number. Use the international format, e.g. +447700900123. (${raw})`;
  if (/PHONE_CODE_INVALID/.test(raw)) return `That code isn't right. Type the latest code Telegram sent. (${raw})`;
  if (/PHONE_CODE_EXPIRED/.test(raw)) return `That code has expired. Start again to get a new one. (${raw})`;
  if (/PASSWORD_HASH_INVALID/.test(raw)) return `That two-step verification password isn't right. Try again. (${raw})`;
  return raw;
}
