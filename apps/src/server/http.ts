/**
 * The engine's HTTP interface. Two routes:
 *
 *   GET  /health                               DigitalOcean's health check
 *   POST /webhooks/inplayguru/<path token>     InPlayGuru picks
 *
 * The request URL contains the secret path token, so URLs are never logged.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { EngineDb } from "../storage/engine-db";
import type { BackupScheduler } from "../storage/spaces-sync";
import type { ServerEnv } from "./server-env";
import { verifyHmacSignature, verifyPathToken } from "../inplayguru/verify";
import { handleVerifiedPick } from "../inplayguru/receiver";
import { log } from "./log";

const MAX_BODY_BYTES = 64 * 1024;
const WEBHOOK_PREFIX = "/webhooks/inplayguru/";

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

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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

export function createEngineHttpServer(env: ServerEnv, db: EngineDb, backups: BackupScheduler): Server {
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error(`Unhandled error in request handler: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, { error: "internal_error" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "/").split("?")[0] ?? "/";

    if (req.method === "GET" && path === "/health") {
      // Stays 200 even if backups are failing: a failed health check makes
      // DigitalOcean restart the container, which would lose un-backed-up data.
      send(res, 200, { ok: true, webhooksStored: db.countWebhooks(), backup: backups.getStatus() });
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
}
