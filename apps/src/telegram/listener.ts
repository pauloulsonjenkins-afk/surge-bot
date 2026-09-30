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
 * Catch-up sync. Live updates alone can silently miss messages: during a
 * redeploy or restart, after a dropped connection, or if the update stream
 * stalls. So every couple of minutes (and once at start) the last messages of
 * the chat are read back from Telegram and anything new or changed is stored.
 * Storing is keyed on chat + message id, so this never duplicates a pick, and
 * it also picks up full-time edits that were missed.
 *
 * Every alert is stored with Telegram's own posting time. The bet feed's age
 * check uses that time, so an alert that reaches the app late (via the sync, or
 * a delayed update) is never treated as fresh and sent to bet.
 *
 * Nothing here places a bet. Parsing only describes the pick.
 */
import type { TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage";
import type { Api } from "telegram";
import type { EngineDb } from "../storage/engine-db";
import { handleVerifiedPick } from "../inplayguru/receiver";
import { parseAlert } from "../inplayguru/parse-alert";
import { recordSimBets } from "../inplayguru/bet-feed";
import { log } from "../server/log";

const SYNC_EVERY_MS = 2 * 60 * 1000;
const SYNC_MESSAGES = 40;

/** What /health reports about the listener. */
export interface ListenerStatus {
  watching: string | null;
  /** Last time any alert (live or synced) was stored. */
  lastAlertAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  /** Alerts the catch-up sync found that live updates had missed, since start. */
  recoveredBySync: number;
}

const status: ListenerStatus = {
  watching: null,
  lastAlertAt: null,
  lastSyncAt: null,
  lastSyncError: null,
  recoveredBySync: 0,
};

export function getListenerStatus(): ListenerStatus {
  return { ...status };
}

let attachedFor: string | null = null;
let stopped = false;

/** Stops storing and syncing (another container has taken over). The Telegram client itself is disconnected by the caller. */
export function stopTelegramListener(): void {
  stopped = true;
  status.watching = null;
}

interface IncomingText {
  chatKey: string;
  messageId: number;
  /** Unix seconds, from Telegram. */
  date: number;
  text: string;
  senderLabel: string;
}

/** True for real alerts: two team names and a match timer. Welcome messages and announcements aren't. */
function isAlert(text: string): boolean {
  try {
    const p = parseAlert(text);
    return Boolean(p.home && p.away && p.minute !== null);
  } catch {
    return false;
  }
}

/** True when the alert is for a strategy deleted with "ignore new alerts" on the Strategies page. */
function isIgnored(db: EngineDb, text: string): boolean {
  try {
    return db.isStrategyIgnored(parseAlert(text).strategyRaw);
  } catch {
    return false;
  }
}

/** Stores one message. Returns true when something was written. */
function store(db: EngineDb, m: IncomingText, how: "new" | "edit" | "sync"): boolean {
  const messageAt = new Date(m.date * 1000).toISOString();

  // An alert deleted along with its strategy stays deleted: not by the catch-up sync, not by a late full-time edit.
  if (db.isPickDeleted(m.chatKey, m.messageId)) return false;

  // A strategy that was deleted with "ignore new alerts" is dropped here, before anything is stored.
  if (isIgnored(db, m.text)) {
    if (how === "new") log.info(`Telegram message ${m.messageId} is for an ignored strategy; not stored.`);
    return false;
  }

  if (how !== "edit" && db.getLivePickText(m.chatKey, m.messageId) === null) {
    const payload = JSON.stringify({
      source: "telegram",
      chatId: m.chatKey,
      messageId: m.messageId,
      date: m.date,
      sender: m.senderLabel,
      text: m.text,
    });
    const outcome = handleVerifiedPick(db, Buffer.from(payload, "utf8"), "application/json", true);
    if (how === "new") log.info(`Telegram message ${m.messageId} from chat ${m.chatKey} ${outcome}.`);
  }

  // A parse problem must never lose the raw capture above, so it is caught on its own.
  try {
    const parsed = parseAlert(m.text);
    // A real alert always has two team names and a match timer. Welcome messages,
    // announcements and the like don't, so they stay in the raw log only.
    if (!parsed.home || !parsed.away || parsed.minute === null) {
      if (how === "new") log.info(`Telegram message ${m.messageId} is not an alert; not added to the live picks.`);
      return false;
    }
    const what = db.upsertLivePick(m.chatKey, m.messageId, m.text, parsed, messageAt);
    status.lastAlertAt = new Date().toISOString();
    // Record the simulated bet straight away, so it uses the stake and limits in force when the alert arrived.
    try {
      recordSimBets(db);
    } catch (err) {
      log.error(`Could not record the simulated bet: ${err instanceof Error ? err.message : String(err)}`);
    }
    log.info(
      `Live pick for Telegram message ${m.messageId} ${what}` +
        `${how === "edit" ? " (edit)" : how === "sync" ? " (caught up by sync)" : ""}: strategy "${parsed.strategyRaw}", ` +
        `market ${parsed.market ?? "none"}, result ${parsed.result ?? "pending"}` +
        `${parsed.flags.length ? `, ${parsed.flags.length} flag(s)` : ""}.`,
    );
    return true;
  } catch (err) {
    log.error(`Could not parse Telegram message ${m.messageId} into a live pick: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function startTelegramListener(client: TelegramClient, db: EngineDb, chatId: string): Promise<void> {
  if (attachedFor === chatId) {
    log.warn(`Telegram listener is already watching chat ${chatId}; not attaching a second time.`);
    return;
  }
  attachedFor = chatId;
  status.watching = chatId;
  const target = BigInt(chatId);

  // message.chatId is worked out locally from the message itself, so non-matching chats are
  // dropped straight away with no network call (getChat() could fetch the chat for every
  // message from every chat the account is in).
  const isOurs = (message: Api.Message): boolean => {
    const id = message.chatId;
    return id !== undefined && BigInt(id.toString()) === target;
  };

  async function handle(event: NewMessageEvent | EditedMessageEvent, isEdit: boolean): Promise<void> {
    try {
      if (stopped) return;
      const message = event.message;
      if (!isOurs(message)) return;
      const text = message.message ?? "";
      if (!text.trim()) return;

      let senderLabel = "unknown";
      if (!isEdit) {
        const sender = await message.getSender();
        senderLabel =
          sender && "username" in sender && sender.username
            ? `@${sender.username}`
            : sender && "title" in sender && sender.title
              ? sender.title
              : "unknown";
      }
      store(db, { chatKey: chatId, messageId: message.id, date: message.date, text, senderLabel }, isEdit ? "edit" : "new");
    } catch (err) {
      log.error(`Telegram listener failed to process a message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  client.addEventHandler((event: NewMessageEvent) => handle(event, false), new NewMessage({}));
  client.addEventHandler((event: EditedMessageEvent) => handle(event, true), new EditedMessage({}));
  log.info(`Telegram listener attached (new + edited messages), watching chat ${chatId}.`);

  // A plain number (not a numeric string, which GramJS could read as a phone number or username).
  const chatRef = Number(chatId);

  let syncing = false;
  const sync = async () => {
    if (syncing || stopped) return;
    syncing = true;
    try {
      if (!client.connected) {
        log.warn("Telegram client is disconnected; reconnecting before the catch-up sync.");
        await client.connect();
      }
      let messages: Api.Message[];
      try {
        messages = await client.getMessages(chatRef, { limit: SYNC_MESSAGES });
      } catch {
        // A freshly restored session may not know this chat yet; loading the chat list teaches it.
        await client.getDialogs({ limit: 100 });
        messages = await client.getMessages(chatRef, { limit: SYNC_MESSAGES });
      }
      let recovered = 0;
      // Oldest first, so picks are stored in the order they were posted.
      for (const m of [...messages].reverse()) {
        const text = m.message ?? "";
        if (!text.trim()) continue;
        const stored = db.getLivePickText(chatId, m.id);
        if (stored === text) continue; // already stored, unchanged
        if (stored === null && !isAlert(text)) continue; // not an alert: nothing to catch up
        if (stored === null && isIgnored(db, text)) continue; // an ignored strategy: nothing to catch up
        if (store(db, { chatKey: chatId, messageId: m.id, date: m.date, text, senderLabel: "sync" }, "sync")) recovered++;
      }
      status.recoveredBySync += recovered;
      status.lastSyncAt = new Date().toISOString();
      status.lastSyncError = null;
      if (recovered > 0) log.warn(`Catch-up sync stored ${recovered} alert(s) or result(s) that live updates had missed.`);
    } catch (err) {
      status.lastSyncError = err instanceof Error ? err.message : String(err);
      log.error(`Telegram catch-up sync failed: ${status.lastSyncError}`);
    } finally {
      syncing = false;
    }
  };

  void sync();
  setInterval(() => void sync(), SYNC_EVERY_MS).unref();
}
