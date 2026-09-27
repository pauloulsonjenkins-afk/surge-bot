/**
 * Watches one Telegram chat (a group/channel the account is already a
 * member of, where InPlayGuru's alerts land) for new messages and stores
 * each one as a captured pick — the same storage path the InPlayGuru
 * webhook uses (inplayguru_webhooks table, backed up to the Space, shown
 * on the admin Picks page).
 *
 * signatureVerified is stored as true for these: unlike the public webhook
 * endpoint, this path only ever sees messages from a chat you explicitly
 * chose while logged into your own Telegram account, so there's no
 * separate signature to check.
 */
import type { TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import type { EngineDb } from "../storage/engine-db";
import { handleVerifiedPick } from "../inplayguru/receiver";
import { log } from "../server/log";

export async function startTelegramListener(client: TelegramClient, db: EngineDb, chatId: string): Promise<void> {
  const target = BigInt(chatId);

  client.addEventHandler(async (event: NewMessageEvent) => {
    try {
      const message = event.message;
      const chat = await message.getChat();
      const chatIdOnMessage = chat && "id" in chat && chat.id ? BigInt(chat.id.toString()) : null;
      if (chatIdOnMessage === null || chatIdOnMessage !== target) return;

      const text = message.message ?? "";
      if (!text.trim()) return;

      const sender = await message.getSender();
      const senderLabel =
        sender && "username" in sender && sender.username
          ? `@${sender.username}`
          : sender && "title" in sender && sender.title
            ? sender.title
            : "unknown";

      const payload = JSON.stringify({
        source: "telegram",
        chatId: chatIdOnMessage.toString(),
        messageId: message.id,
        date: message.date,
        sender: senderLabel,
        text,
      });

      const outcome = handleVerifiedPick(db, Buffer.from(payload, "utf8"), "application/json", true);
      log.info(`Telegram message ${message.id} from chat ${chatIdOnMessage} ${outcome}.`);
    } catch (err) {
      log.error(`Telegram listener failed to process a message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, new NewMessage({}));

  log.info(`Telegram listener attached, watching chat ${chatId}.`);
}
