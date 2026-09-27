/**
 * The engine's HTTP interface. Routes:
 *
 *   GET  /health                               DigitalOcean's health check
 *   POST /webhooks/inplayguru/<path token>     InPlayGuru picks
 *   GET  /internal/picks                        recent captured picks (admin site only)
 *   POST /internal/telegram/login/start         begin Telegram user-session login
 *   POST /internal/telegram/login/code          submit the SMS/app login code
 *   POST /internal/telegram/login/password      submit the 2FA password, if any
 *   GET  /internal/telegram/login/status        poll login progress
 *   GET  /internal/telegram/login/chats         list chats once logged in
 *   POST /internal/telegram/login/watch         pick which chat to watch and start listening
 *
 * The webhook URL contains the secret path token, so URLs are never logged.
 * /internal/* routes are protected separately by ADMIN_INTERNAL_KEY, checked
 * as a Bearer token — they're meant to be called server-to-server by the
 * admin site, not opened directly in a browser.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TelegramClient } from "telegram";
import type { EngineDb } from "../storage/engine-db";
import type { BackupScheduler } from "../storage/spaces-sync";
import type { ServerEnv } from "./server-env";
import { verifyHmacSignature, verifyPathToken } from "../inplayguru/verify";
import { handleVerifiedPick } from "../inplayguru/receiver";
import { createTelegramClient } from "../telegram/client";
import { loginFlow } from "../telegram/session-flow";
import { startTelegramListener } from "../telegram/listener";
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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
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
      send(res, 200, { ok: true, webhooksStored: db.countWebhooks(), backup: backups.getStatus() });
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
