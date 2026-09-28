/**
 * Watches one Telegram chat (a group/channel, or the personal alerts bot DM,
 * that the logged-in account can see) and stores each alert.
 *
 * Two kinds of event are handled:
 *  - NEW message: saved raw (the admin Picks page reads this log) AND parsed
 *    into the live_picks table (the Live tab reads this).
 *  - EDITED message: InPlayGuru edits the original alert after full time to add
 *    the Match Summary and Hit/Miss. The edit is re-parsed and the SAME
 *    live_picks row is updated (matched on chat id + Telegram message id), so
 *    the result lands on the existing pick and nothing is duplicated.
 *    Edits are deliberately not added to the raw log, which stays a record of
 *    what first arrived.
 *
 * Nothing here places a bet. Parsing only describes the pick.
 */
import type { TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage";
import type { EngineDb } from "../storage/engine-db";
import { handleVerifiedPick } from "../inplayguru/receiver";
import { parseAlert } from "../inplayguru/parse-alert";
import { log } from "../server/log";

export async function startTelegramListener(client: TelegramClient, db: EngineDb, chatId: string): Promise<void> {
  const target = BigInt(chatId);

  async function handle(event: NewMessageEvent | EditedMessageEvent, isEdit: boolean): Promise<void> {
    try {
      const message = event.message;
      const chat = await message.getChat();
      const chatIdOnMessage = chat && "id" in chat && chat.id ? BigInt(chat.id.toString()) : null;
      if (chatIdOnMessage === null || chatIdOnMessage !== target) return;

      const text = message.message ?? "";
      if (!text.trim()) return;

      const chatKey = chatIdOnMessage.toString();

      if (!isEdit) {
        const sender = await message.getSender();
        const senderLabel =
          sender && "username" in sender && sender.username
            ? `@${sender.username}`
            : sender && "title" in sender && sender.title
              ? sender.title
              : "unknown";

        const payload = JSON.stringify({
          source: "telegram",
          chatId: chatKey,
          messageId: message.id,
          date: message.date,
          sender: senderLabel,
          text,
        });

        const outcome = handleVerifiedPick(db, Buffer.from(payload, "utf8"), "application/json", true);
        log.info(`Telegram message ${message.id} from chat ${chatKey} ${outcome}.`);
      }

      // Parse and store for the Live tab. A parse problem must never lose the
      // raw capture above, so it is caught on its own.
      try {
        const parsed = parseAlert(text);
        // A real alert always has two team names and a match timer. Welcome
        // messages, announcements and the like don't, so they are kept in the raw
        // log (Picks page) but never turned into a strategy or a pick.
        if (!parsed.home || !parsed.away || parsed.minute === null) {
          log.info(`Telegram message ${message.id} is not an alert; not added to the live picks.`);
          return;
        }
        const what = db.upsertLivePick(chatKey, message.id, text, parsed);
        log.info(
          `Live pick for Telegram message ${message.id} ${what}` +
            `${isEdit ? " (edit)" : ""}: strategy "${parsed.strategyRaw}", market ${parsed.market ?? "none"}, ` +
            `result ${parsed.result ?? "pending"}${parsed.flags.length ? `, ${parsed.flags.length} flag(s)` : ""}.`,
        );
      } catch (err) {
        log.error(
          `Could not parse Telegram message ${message.id} into a live pick: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      log.error(`Telegram listener failed to process a message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  client.addEventHandler((event: NewMessageEvent) => handle(event, false), new NewMessage({}));
  client.addEventHandler((event: EditedMessageEvent) => handle(event, true), new EditedMessage({}));

  log.info(`Telegram listener attached (new + edited messages), watching chat ${chatId}.`);
}
