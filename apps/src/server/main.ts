/**
 * Entry point for the engine's DigitalOcean web service.
 * package.json "start" runs the compiled copy: node dist/src/server/main.js
 */
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { loadServerEnv } from "./server-env";
import { createEngineHttpServer } from "./http";
import { EngineDb } from "../storage/engine-db";
import { BackupScheduler, SpacesSync } from "../storage/spaces-sync";
import { log } from "./log";

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

  let backups: BackupScheduler | null = null;
  const db = new EngineDb(env.dbPath, () => backups?.markDirty());
  backups = new BackupScheduler(db, sync, join(dirname(env.dbPath), "snapshot-upload.db"));
  backups.start();

  if (!env.signingSecret) {
    log.warn(
      "INPLAYGURU_SIGNING_SECRET is not set: webhooks are protected by the URL token only. " +
        "Add the signing secret once InPlayGuru provides it.",
    );
  }

  const server = createEngineHttpServer(env, db, backups);
  server.listen(env.port, "0.0.0.0", () => log.info(`Engine web service listening on port ${env.port}.`));

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
