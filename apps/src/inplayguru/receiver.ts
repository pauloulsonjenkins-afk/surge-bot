/**
 * What happens to a webhook once it has passed the security checks.
 *
 * Each verified webhook is stored in the inplayguru_webhooks table and backed up to the Space (the Telegram listener
 * stores its messages here too). By default that is all: InPlayGuru's webhook format isn't published.
 *
 * With "Webhook alerts: use" on the Direct betting page, a webhook whose body reads as an alert also becomes a pick,
 * exactly like a Telegram message (useWebhookAlert below), so InPlayGuru's webhook can take over from Telegram. The
 * same alert arriving both ways is kept once.
 */
import type { EngineDb } from "../storage/engine-db";
import { log } from "../server/log";
import { sha256Hex } from "./verify";
import { isRealAlert, parseAlert } from "./parse-alert";

export type PickOutcome = "captured" | "duplicate";

export function handleVerifiedPick(
  db: EngineDb,
  rawBody: Buffer,
  contentType: string | null,
  signatureVerified: boolean,
): PickOutcome {
  const bodySha256 = sha256Hex(rawBody);
  const isNew = db.saveWebhook({
    receivedAt: new Date().toISOString(),
    bodySha256,
    contentType,
    signatureVerified,
    body: rawBody.toString("utf8"),
  });

  if (!isNew) {
    log.info(`InPlayGuru webhook ${bodySha256.slice(0, 12)} is a repeat of one already stored; ignored.`);
    return "duplicate";
  }

  log.info(
    `InPlayGuru webhook ${bodySha256.slice(0, 12)} captured (${rawBody.length} bytes, ` +
      `signature ${signatureVerified ? "verified" : "not checked: no signing secret set"}).`,
  );
  return "captured";
}

// ---------------------------------------------------------------------------
// Using webhook alerts as picks (Direct betting page: "Webhook alerts: use")

/** The key webhook picks are stored under in live_picks (Telegram's use the chat id). */
export const WEBHOOK_CHAT = "webhook";

/**
 * The alert text inside a webhook body. InPlayGuru's format isn't published, so this takes the body as plain text, or
 * from JSON the longest string value (at any depth) that reads as an alert: two teams and a timer or a kick-off line,
 * the same test as Telegram's messages. Null when nothing in it reads as an alert.
 */
export function alertTextFrom(body: string): string | null {
  const reads = (s: string) => {
    try {
      return isRealAlert(parseAlert(s));
    } catch {
      return false;
    }
  };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reads(body) ? body : null;
  }
  const strings: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(json, 0);
  return strings.filter((s) => s.includes("\n") && reads(s)).sort((a, b) => b.length - a.length)[0] ?? null;
}

export type WebhookUseOutcome = "added" | "updated" | "alreadyFromTelegram" | "notAnAlert" | "ignoredStrategy";

/**
 * Adds a webhook's alert to the picks, as the Telegram listener does with a message. When Telegram already brought
 * the same alert (same strategy, teams and score within 15 minutes) it is left to that one, so there is one pick.
 */
export function useWebhookAlert(db: EngineDb, body: string, bodySha256: string, now = new Date()): WebhookUseOutcome {
  const text = alertTextFrom(body);
  if (!text) return "notAnAlert";
  const parsed = parseAlert(text);
  if (db.isStrategyIgnored(parsed.strategyRaw)) return "ignoredStrategy";
  const at = now.toISOString();
  if (parsed.home && parsed.away && db.findTwinPick(parsed.strategyRaw, parsed.home, parsed.away, [parsed.goalsHome, parsed.goalsAway], at, "telegram")) {
    return "alreadyFromTelegram";
  }
  // A stable number from the body, so InPlayGuru sending the same webhook again updates the same pick.
  const messageId = parseInt(bodySha256.slice(0, 12), 16);
  return db.upsertLivePick(WEBHOOK_CHAT, messageId, text, parsed, at) === "inserted" ? "added" : "updated";
}
