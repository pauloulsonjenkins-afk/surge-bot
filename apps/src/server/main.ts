/**
 * Entry point for the engine's DigitalOcean web service.
 * package.json "start" runs the compiled copy: node dist/src/server/main.js
 */
import { getExchangeReader, requestExchangeCheck, startBetfairPoller, whenPicksReady } from "../betfair/exchange";
import { syncLayPicks } from "../inplayguru/lay-groups";
import { parseAlert } from "../inplayguru/parse-alert";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadServerEnv } from "./server-env";
import { createEngineHttpServer, disconnectLoginClient, warmReportCache } from "./http";
import { EngineDb } from "../storage/engine-db";
import { BackupScheduler, leaseIsLive, SpacesSync } from "../storage/spaces-sync";
import { createTelegramClient } from "../telegram/client";
import { getListenerStatus, setConnectState, startTelegramListener, stopTelegramListener } from "../telegram/listener";
import { HANDOVER_WAIT_MS, superviseTelegram, type Supervisor } from "../telegram/supervisor";
import { log } from "./log";
import { startDailyFixturePull } from "../fixtures/daily-pull";
import { recordSimBets } from "../inplayguru/bet-feed";
import { startDailySummary } from "./daily-summary";
import { startWeeklyReview } from "./weekly-review";
import { startTelegramWatchdog } from "./telegram-watchdog";
import { BetfairTrader, startDirectBetting, wake as wakeDirect } from "../betfair/direct";
import { readCredentials } from "../betfair/exchange";
import { startMembers } from "../members/runner";
import { startHistoryRefresh } from "../history/football-data";
import { startDailyTips } from "./daily-tips";
import { notifyAdvice } from "./strategy-advice";
import { notifyLeagueMilestones } from "./league-returns";
import { startEdge } from "../edge/edge";
import { priceEdgeNow, startEdgePrices } from "../edge/edge-prices";
import { startValueSettling } from "../edge/value-strategy";
import { startProbeOnce } from "../fixtures/probe";
import { startGoalTimes } from "../fixtures/goal-times";
import { logHorseResults } from "./horse-results";
import { autoWatchGoldenFinds, loadCustomSegments, monitorGoldenBets } from "./golden";
import { monitorLayBadges } from "./lay-badges";

async function main(): Promise<void> {
  const env = loadServerEnv();
  const sync = new SpacesSync(env.spaces);

  if (existsSync(env.dbPath)) {
    log.info("Local database already present (same container restarted); keeping it.");
  } else {
    const restored = await sync.restoreTo(env.dbPath);
    log.info(
      restored === "restored"
        ? `Restored database from ${sync.description}.`
        : `No backup at ${sync.description} yet; starting a new database (normal on the very first run).`,
    );
  }

  // Claims the backup for this container, so an older container still running during a deploy stops
  // uploading instead of overwriting this one's database with its own last copy.
  const instanceId = randomUUID();
  const born = Date.now();
  // Another container still holding the lease (a deploy under way): it's still connected to Telegram, so this one waits
  // before connecting (HANDOVER_WAIT_MS). Read before this container's own lease is written over it.
  const previous = await sync.readLease().catch(() => null);
  const handover = leaseIsLive(previous, born);
  await sync.writeLease(instanceId, born);

  let telegram: Supervisor | null = null;
  let backups: BackupScheduler | null = null;
  const db = new EngineDb(env.dbPath, () => backups?.markDirty());
  // Golden slices added from the finder (segments.ts), before anything prices or bets a pick.
  loadCustomSegments(db);
  backups = new BackupScheduler(
    db,
    sync,
    join(dirname(env.dbPath), "snapshot-upload.db"),
    5_000,
    60_000,
    instanceId,
    () => {
      // Two containers on one Telegram session can get the session revoked, and both would store alerts.
      void telegram?.stop();
      stopTelegramListener();
      void disconnectLoginClient();
      log.warn("Telegram listener disconnected: the newer container has taken over.");
    },
    () => {
      // The newer container went away (its deploy failed or was rolled back): this one listens again.
      telegram?.start();
      log.warn("Telegram listener starting again: this container has taken the backup back.");
    },
    born,
  );
  backups.start();

  // Stopping (a deploy, a restart): set up before anything below can wait on the network, so the last changes are
  // always backed up (it used to come after the Telegram connection, which could wait for ever).
  let stopping = false;
  let httpServer: ReturnType<typeof createEngineHttpServer> | null = null;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received: finishing requests and uploading the final backup.`);
    httpServer?.close();
    await telegram?.stop().catch(() => {});
    await disconnectLoginClient().catch(() => {});
    try {
      await backups?.flush();
    } finally {
      db.close();
      process.exit(exitCode);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // A failed background task nothing caught (a promise with no .catch): Node would stop the whole engine for it, pausing
  // alerts and bets until DigitalOcean restarts it. Logged instead, and the engine carries on.
  process.on("unhandledRejection", (reason) => {
    log.error(`A background task failed and nothing caught it (the engine carries on): ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
  // A thrown error nothing caught can leave things half done: back up, let go of Telegram and stop, so it restarts clean.
  process.on("uncaughtException", (err) => {
    log.error(`Unexpected error, stopping so the engine restarts cleanly: ${err.stack ?? err.message}`);
    void shutdown("uncaughtException", 1);
  });

  // Correct any stored results using the current rules (hit/miss from the final score).
  try {
    const fixed = db.recomputeSettledResults(parseAlert);
    if (fixed > 0) log.info(`Corrected ${fixed} stored result(s) using the final score.`);
  } catch (err) {
    log.error(`Could not re-check stored results: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!env.signingSecret) {
    log.warn(
      "INPLAYGURU_SIGNING_SECRET is not set: webhooks are protected by the URL token only. " +
        "Add the signing secret once InPlayGuru provides it.",
    );
  }

  // Today and Strategies are the two most-viewed, heaviest pages (Today polls every 15s): worked out here, between
  // requests, so an admin's view is (almost) always a cache hit instead of holding up this one thread while they wait
  // (phase 3 of the 27 Oct 2026 site tidy-up). Once now, then every 45s; cachedReport skips the work when nothing's
  // changed since the last time, so a quiet period costs almost nothing.
  warmReportCache(db);
  const reportWarm = setInterval(() => warmReportCache(db), 45_000);
  reportWarm.unref();

  // Simulated bets are recorded as alerts arrive; this sweep also catches a Live strategy's pick that aged out
  // without being sent, so it is counted as not placed.
  const simSweep = setInterval(() => {
    try {
      recordSimBets(db);
    } catch (err) {
      log.error(`Could not record simulated bets: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 60_000);
  simSweep.unref();

  // LAY picks (inplayguru/lay-groups.ts): made from qualifying next-goal alerts within seconds, so Betfair's lay price is
  // read while it's still the alert's moment; their sources' later edits are copied across so they settle.
  const laySweep = setInterval(() => {
    try {
      if (syncLayPicks(db) > 0) {
        requestExchangeCheck();
        recordSimBets(db);
      }
    } catch (err) {
      log.error(`Could not make LAY picks: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 15_000);
  laySweep.unref();

  // Once an hour in the daytime (08:00-22:00 UK): any strategy now worth putting Live, or back to Sim? One
  // notification per new suggestion; they're also listed on the Today page.
  const adviceCheck = setInterval(() => {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    if (hour < 8 || hour >= 22) return;
    void notifyAdvice(db).catch((err) => log.warn(`Strategy suggestions failed: ${err instanceof Error ? err.message : String(err)}`));
    // Golden safety: a slice bet Live on its own goes back to Sim when it stops earning it (one notification each).
    void monitorGoldenBets(db).catch((err) => log.warn(`Golden safety check failed: ${err instanceof Error ? err.message : String(err)}`));
    // Golden finder: new ideas are watched at once, quietly (no notification; golden.ts notifies at 30 and 50 picks).
    try {
      autoWatchGoldenFinds(db);
    } catch (err) {
      log.warn(`Golden finder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // League milestones (50 / 100 / 250 / 500 picks in a league, country or strategy-in-a-league): one notification.
    void notifyLeagueMilestones(db).catch((err) => log.warn(`League milestones failed: ${err instanceof Error ? err.message : String(err)}`));
    // LAY badges: the same idea as Golden, for LAY groups (one notification each way).
    void monitorLayBadges(db).catch((err) => log.warn(`LAY badges failed: ${err instanceof Error ? err.message : String(err)}`));
  }, 3_600_000);
  adviceCheck.unref();

  // Reads your bets from Betfair (read only) so the site knows within a minute whether a sent pick was placed.
  startBetfairPoller(db);

  // Horses: results logged from Betfair (horse-results.ts). Every 3 minutes from 10:00 to 23:00 UK: a new bet is matched
  // to its race within minutes, and each result is logged a few minutes after its race's off. A pass with nothing due
  // asks Betfair nothing.
  const horseResults = setInterval(() => {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const reader = getExchangeReader();
    if (hour < 10 || hour > 22 || !reader) return;
    void logHorseResults(db, reader).catch((err) => log.warn(`Horse results from Betfair failed: ${err instanceof Error ? err.message : String(err)}`));
  }, 3 * 60_000);
  horseResults.unref();

  // Today's profit so far as a push notification at 06:50, 14:00, 17:00 and 21:30 UK time.
  startDailySummary(db);
  // The Sunday review at 19:00 UK: the week, and every current strategy suggestion.
  startWeeklyReview(db);
  // A push notification when Telegram alerts stop arriving, and when they're back.
  startTelegramWatchdog(db);
  db.markExistingNoSendLeaguesDone();
  startDirectBetting(db);
  // A pick ready to bet (its Betfair match found, or its price risen to the minimum) is bet straight away, not at the
  // next 4-second pass.
  whenPicksReady(wakeDirect);
  // Past results for the League history page: downloaded a few minutes after start, refreshed daily.
  startHistoryRefresh();
  // The day's horse tips, fetched at a random time between 10:00 and 14:00 UK (needs the TIPS_* settings).
  startDailyTips(db);
  // Edge: pre-match insight cards for members, worked out from past results a few times a day (read-only for betting).
  startEdge(db, () => void priceEdgeNow(db));
  // ...and the Betfair price of each card's bets in the next 24 hours, every two hours (read-only).
  startEdgePrices(db);
  // Best Value Cuppa (Sim only): settles its picks from Betfair's results.
  startValueSettling(db);

  // The Members platform: simulated bets for members following strategies, and (only when every live switch is on)
  // real bets on the house Betfair account for admin members. See src/members/runner.ts and live.ts.
  const memberCreds = readCredentials();
  const memberTrader = memberCreds ? new BetfairTrader(memberCreds) : null;
  startMembers(db, memberTrader ? { trading: memberTrader, account: () => memberTrader.account() } : null);

  const server = createEngineHttpServer(env, db, backups);
  httpServer = server;
  server.listen(env.port, "0.0.0.0", () => log.info(`Engine web service listening on port ${env.port}.`));

  // Daily fixtures for the Schedule tab. Nothing happens until the key is set.
  const apiFootballKey = process.env.API_FOOTBALL_KEY?.trim();
  if (apiFootballKey) {
    startDailyFixturePull(db, apiFootballKey);
    // One-off check of what the plan allows, for Edge Phase 2 (fixtures/probe.ts). Runs once ever, 3 calls.
    startProbeOnce(db, apiFootballKey);
    // Goal times for the admin's Trade Log: at most 30 API-Football calls a day (fixtures/goal-times.ts).
    startGoalTimes(db, apiFootballKey);
  } else {
    log.info("API_FOOTBALL_KEY is not set; the Schedule tab's daily fixture pull is off.");
  }

  // If a Telegram session was already completed via the admin Telegram tab
  // and saved as env vars, resume listening on restart without needing to
  // log in again. Until all four vars are set, this is a no-op — use the
  // admin Telegram tab to run the login flow first.
  const tgApiId = process.env.TELEGRAM_API_ID;
  const tgApiHash = process.env.TELEGRAM_API_HASH;
  const tgSession = process.env.TELEGRAM_SESSION;
  const tgChatId = process.env.TELEGRAM_SOURCE_CHAT_ID;
  if (tgApiId && tgApiHash && tgSession && tgChatId) {
    // Connected in the background and kept connected: a failed attempt is tried again (telegram/supervisor.ts).
    telegram = superviseTelegram({
      connect: () => {
        const client = createTelegramClient(Number(tgApiId), tgApiHash, tgSession);
        // Only this attempt's own listener is stopped on closing, never one attached from the admin's Telegram tab.
        let attached = false;
        const ready = (async () => {
          await client.connect();
          await startTelegramListener(client, db, tgChatId);
          attached = true;
          log.info("Telegram listener resumed from saved session.");
        })();
        return {
          ready,
          close: async () => {
            if (attached) stopTelegramListener();
            await client.destroy().catch(() => client.disconnect());
          },
        };
      },
      onState: (s) => setConnectState(s),
      // Logged in again from the admin's Telegram tab meanwhile: that listener is the one in use.
      attachedElsewhere: () => getListenerStatus().watching !== null,
    });
    telegram.start(handover ? HANDOVER_WAIT_MS : 0);
  } else {
    log.info("Telegram env vars not fully set yet; log in via the admin Telegram tab first.");
  }
}

main().catch((err) => {
  log.error(`Engine web service failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});