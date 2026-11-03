/**
 * A phone notification when a proper tip comes in (Free tips, 3 Nov 2026): a message read as a tip, or one you marked Tip,
 * from a channel you follow. One notification per message; tapping it opens the Free tips page.
 *
 *   - On unless switched off in the page's Settings; quiet hours (23:00 to 07:00 UK) on unless switched off.
 *   - Only fresh tips: one found more than 15 minutes after it was posted (a catch-up read, a restart) isn't sent, since a
 *     price from then is gone. It is still marked, so it never comes up later.
 *   - Messages that only become a tip later (learning from your calls, a rule change) are never notified.
 * Nothing here bets or changes how anything is bet.
 */
import type { EngineDb } from "../storage/engine-db";
import { isQuietHour } from "../server/golden-notify";
import { sendPush } from "../server/push";
import { log } from "../server/log";

const KEY = "tips_notify";
const FRESH_MS = 15 * 60_000;

export interface TipNotifySettings {
  on: boolean;
  /** No notifications between 23:00 and 07:00 UK time. */
  quiet: boolean;
}

export function getTipNotify(db: EngineDb): TipNotifySettings {
  try {
    const raw = JSON.parse(db.getSetting(KEY) ?? "{}") as Partial<TipNotifySettings>;
    return { on: raw.on !== false, quiet: raw.quiet !== false };
  } catch {
    return { on: true, quiet: true };
  }
}

export function setTipNotify(db: EngineDb, patch: Partial<TipNotifySettings>): TipNotifySettings {
  const s = { ...getTipNotify(db), ...(typeof patch.on === "boolean" ? { on: patch.on } : {}), ...(typeof patch.quiet === "boolean" ? { quiet: patch.quiet } : {}) };
  db.setSetting(KEY, JSON.stringify(s));
  return s;
}

/** Sends the notification for each new tip not yet told. Returns how many were sent. */
export async function notifyNewTips(db: EngineDb, now = new Date()): Promise<number> {
  const settings = getTipNotify(db);
  let sent = 0;
  for (const t of db.listUnnotifiedTips(new Date(now.getTime() - 24 * 3_600_000).toISOString())) {
    const fresh = now.getTime() - Date.parse(t.postedAt) <= FRESH_MS;
    // Marked first, so a failure can never send the same tip twice.
    db.markChannelTipNotified(t.chatKey, t.messageId, now.toISOString());
    if (!settings.on || !fresh || (settings.quiet && isQuietHour(now))) continue;
    try {
      const bet = [t.selection, t.odds !== null ? `@ ${t.odds}` : null].filter(Boolean).join(" ");
      await sendPush(db, {
        title: `New tip: ${t.channel}`,
        body: [t.match, bet].filter(Boolean).join(" · ") || t.text.slice(0, 120),
        url: "/more/admin/tips",
        tag: `tip-${t.chatKey}-${t.messageId}`,
      });
      sent++;
    } catch (err) {
      log.warn(`Free tips: notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return sent;
}
