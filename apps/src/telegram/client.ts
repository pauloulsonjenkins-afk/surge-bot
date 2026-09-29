/**
 * Builds a GramJS user-account client. Two uses:
 *  - a fresh, unauthenticated client during the admin login handshake
 *  - a client restored from TELEGRAM_SESSION at boot, for the live listener
 *
 * This logs in as your own Telegram account (not a bot), because a normal
 * Telegram bot can't read messages in a group it wasn't given admin rights
 * in and can't be added to receive InPlayGuru's alerts the way your account
 * already does.
 */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

export function createTelegramClient(apiId: number, apiHash: string, sessionString = ""): TelegramClient {
  const session = new StringSession(sessionString);
  return new TelegramClient(session, apiId, apiHash, {
    // Keep trying to reconnect after a drop instead of giving up after 5 tries and going quiet.
    connectionRetries: Number.MAX_SAFE_INTEGER,
    retryDelay: 2000,
    autoReconnect: true,
  });
}