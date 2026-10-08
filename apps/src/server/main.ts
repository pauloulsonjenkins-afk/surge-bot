/**
 * Entry point for the engine's DigitalOcean web service.
 * package.json "start" runs the compiled copy: node dist/src/server/main.js
 */
import { startBetfairPoller } from "../betfair/exchange";
import { parseAlert } from "../inplayguru/parse-alert";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadServerEnv } from "./server-env";
import { createEngineHttpServer } from "./http";
import { EngineDb } from "../storage/engine-db";
import { BackupScheduler, SpacesSync } from "../storage/spaces-sync";
import { createTelegramClient } from "../telegram/client";
import { startTelegramListener, stopTelegramListener } from "../telegram/listener";
import { log } from "./log";
import { startDailyFixturePull } from "../fixtures/daily-pull";
import { recordSimBets } from "../inplayguru/bet-feed";
import { startDailySummary } from "./daily-summary";
import { startTelegramWatchdog } from "./telegram-watchdog";
import { BetfairTrader, startDirectBetting } from "../betfair/direct";
import { readCredentials } from "../betfair/exchange";
import { startMembers } from "../members/runner";
import { startHistoryRefresh } from "../history/football-data";

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
  await sync.writeLease(instanceId);

  let telegramClient: ReturnType<typeof createTelegramClient> | null = null;
  let backups: BackupScheduler | null = null;
  const db = new EngineDb(env.dbPath, () => backups?.markDirty());
  backups = new BackupScheduler(db, sync, join(dirname(env.dbPath), "snapshot-upload.db"), 5_000, 60_000, instanceId, () => {
    // Two containers on one Telegram session can get the session revoked, and both would store alerts.
    stopTelegramListener();
    void telegramClient?.disconnect().catch(() => {});
    log.warn("Telegram listener disconnected: the newer container has taken over.");
  });
  backups.start();

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

  // Reads your bets from Betfair (read only) so the site knows within a minute whether a sent pick was placed.
  startBetfairPoller(db);

  // Today's profit so far as a push notification at 06:50, 14:00, 17:00 and 21:30 UK time.
  startDailySummary(db);
  // A push notification when Telegram alerts stop arriving, and when they're back.
  startTelegramWatchdog(db);
  db.markExistingNoSendLeaguesDone();
  startDirectBetting(db);
  // Past results for the League history page: downloaded a few minutes after start, refreshed daily.
  startHistoryRefresh();

  // The Members platform: simulated bets for members following strategies, and (only when every live switch is on)
  // real bets on the house Betfair account for admin members. See src/members/runner.ts and live.ts.
  const memberCreds = readCredentials();
  const memberTrader = memberCreds ? new BetfairTrader(memberCreds) : null;
  startMembers(db, memberTrader ? { trading: memberTrader, account: () => memberTrader.account() } : null);

  const server = createEngineHttpServer(env, db, backups);
  server.listen(env.port, "0.0.0.0", () => log.info(`Engine web service listening on port ${env.port}.`));

  // Daily fixtures for the Schedule tab. Nothing happens until the key is set.
  const apiFootballKey = process.env.API_FOOTBALL_KEY?.trim();
  if (apiFootballKey) {
    startDailyFixturePull(db, apiFootballKey);
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
    try {
      const client = createTelegramClient(Number(tgApiId), tgApiHash, tgSession);
      telegramClient = client;
      await client.connect();
      await startTelegramListener(client, db, tgChatId);
      log.info("Telegram listener resumed from saved session.");
    } catch (err) {
      log.error(
        `Failed to resume the Telegram listener from the saved session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    log.info("Telegram env vars not fully set yet; log in via the admin Telegram tab first.");
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received: finishing requests and uploading the final backup.`);
    server.close();
    try {
      await backups?.flush();
    } finally {
      db.close();
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error(`Engine web service failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});