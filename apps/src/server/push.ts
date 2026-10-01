/**
 * Push notifications to the admin's devices (Web Push): a browser, or the site installed as an app on a phone. The
 * site subscribes a device on the Sending page; the engine stores it (push_subscriptions) and sends to every device.
 *
 * The VAPID key pair that identifies this server to the push services is made on first use and kept in settings, so
 * there is nothing to configure. The public key is handed to the browser when it subscribes.
 */
import webpush from "web-push";
import type { EngineDb } from "../storage/engine-db";
import { log } from "./log";

const KEYS_SETTING = "push_vapid";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** Who runs this server, for the push services: the site's address, saved when a device subscribes. */
  subject: string | null;
}

function vapidKeys(db: EngineDb): VapidKeys {
  try {
    const raw = db.getSetting(KEYS_SETTING);
    if (raw) {
      const k = JSON.parse(raw) as Partial<VapidKeys>;
      if (k.publicKey && k.privateKey) return { publicKey: k.publicKey, privateKey: k.privateKey, subject: k.subject ?? null };
    }
  } catch {
    // made again below
  }
  const fresh = webpush.generateVAPIDKeys();
  const keys: VapidKeys = { publicKey: fresh.publicKey, privateKey: fresh.privateKey, subject: null };
  db.setSetting(KEYS_SETTING, JSON.stringify(keys));
  return keys;
}

/** The public key a browser needs to subscribe. */
export function pushPublicKey(db: EngineDb): string {
  return vapidKeys(db).publicKey;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Checks what a browser sent before it is stored. */
export function parseSubscription(v: unknown): PushSubscriptionInput | null {
  if (!v || typeof v !== "object") return null;
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 2000) return null;
  if (typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

/** Stores a device, and the site's address as the contact the push services see (it must be https or mailto). */
export function subscribePush(db: EngineDb, sub: PushSubscriptionInput, label: string | null, siteOrigin: string | null): void {
  db.savePushSubscription(sub, label);
  if (siteOrigin && /^https:\/\/[^/]+$/.test(siteOrigin)) {
    const keys = vapidKeys(db);
    if (keys.subject !== siteOrigin) db.setSetting(KEYS_SETTING, JSON.stringify({ ...keys, subject: siteOrigin }));
  }
}

export interface PushMessage {
  title: string;
  body: string;
  /** The page to open when the notification is tapped. */
  url?: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
}

/**
 * Sends a notification to every subscribed device. Devices the push service says are gone are removed. Returns how
 * many it reached. Never throws: a failed notification mustn't stop the caller.
 */
export async function sendPush(db: EngineDb, message: PushMessage): Promise<number> {
  const subs = db.listPushSubscriptions();
  if (subs.length === 0) return 0;
  const keys = vapidKeys(db);
  const options = {
    vapidDetails: { subject: keys.subject ?? "mailto:admin@example.com", publicKey: keys.publicKey, privateKey: keys.privateKey },
    // Worth delivering for a while if the phone is off, but not hours later.
    TTL: 30 * 60,
    urgency: "high" as const,
  };
  let reached = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(message), options);
      reached++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        db.deletePushSubscription(s.endpoint);
        log.info("Push: removed a device that no longer accepts notifications.");
      } else {
        log.warn(`Push failed (${code ?? "no status"}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return reached;
}
