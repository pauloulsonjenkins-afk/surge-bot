/**
 * App alerts: a member picks up to 2 strategies and gets a GoalBrew app notification (Web Push) on their phone or
 * browser each time one of them sends an alert, with the details: the match, league, minute and score, the bet and the
 * price. Never the strategy's trigger rules.
 *
 *   who      tiers with "alertNotifications" (paid and trial by default). A trial member can choose only among their
 *            trial strategies (the "viewSelections" scope). A member who loses access simply stops getting them.
 *   when     straight after the alert arrives (the members pass is woken by each new alert). An alert whose price isn't
 *            known yet waits up to 90 seconds for Betfair's; only alerts that can still be bet are sent, each once.
 *
 * INFORMATION ONLY: nothing here bets, and nothing touches any Betfair account.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { deliver, parseSubscription, pushPublicKey, type PushMessage } from "../server/push";
import { log } from "../server/log";
import { listCatalogue, maxAgeMinutes, memberStrategyKey, toPickFull, type CatalogueEntry } from "./catalogue";
import { getMembersConfig } from "./config";
import { can, strategyAllowed } from "./permissions";
import { memberContext, type MemberContext } from "./service";
import { membersStore } from "./store";

export const MAX_ALERT_STRATEGIES = 2;
/** How long an alert with no price yet waits for Betfair's before it is sent without one. */
const PRICE_WAIT_MS = 90_000;
/** Older alerts are never pushed (a phone that was off, or a pass that didn't run). */
const FRESH_MS = 10 * 60_000;

/** Why this member can't use app alerts, or null when they can. */
export function alertsBlock(ctx: MemberContext): string | null {
  return can(ctx.access, "alertNotifications") ? null : "App alerts are part of the paid membership and the free trial.";
}

/** The strategies this member may choose from: the ones whose selections their access covers. */
function choosable(db: EngineDb, ctx: MemberContext): CatalogueEntry[] {
  return listCatalogue(db, ctx.config).filter((c) => strategyAllowed(ctx.access, "viewSelections", c.key));
}

export interface AlertsView {
  locked: boolean;
  reason: string | null;
  max: number;
  chosen: string[];
  options: Array<{ key: string; name: string }>;
  devices: Array<{ endpoint: string; label: string | null; createdAt: string }>;
  publicKey: string;
}

export function alertsView(db: EngineDb, ctx: MemberContext): AlertsView {
  const store = membersStore(db);
  const reason = alertsBlock(ctx);
  return {
    locked: reason !== null,
    reason,
    max: MAX_ALERT_STRATEGIES,
    chosen: store.listAlertChoices(ctx.user.id).map((c) => c.strategyKey),
    options: reason ? [] : choosable(db, ctx).map((c) => ({ key: c.key, name: c.name })),
    // The member's own devices: the endpoint lets the page tell whether THIS device is on.
    devices: store.listPushDevices(ctx.user.id).map((d) => ({ endpoint: d.endpoint, label: d.label, createdAt: d.createdAt })),
    publicKey: pushPublicKey(db),
  };
}

/** Saves the member's choice of strategies (at most 2). Throws with a reason. */
export function chooseAlerts(db: EngineDb, ctx: MemberContext, keys: unknown, now = new Date()): void {
  const block = alertsBlock(ctx);
  if (block) throw new Error(block);
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) throw new Error("Choose strategies from the list.");
  const wanted = [...new Set((keys as string[]).map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length > MAX_ALERT_STRATEGIES) throw new Error(`Choose up to ${MAX_ALERT_STRATEGIES} strategies.`);
  const allowed = new Set(choosable(db, ctx).map((c) => c.key));
  if (wanted.some((k) => !allowed.has(k))) throw new Error("That strategy isn't available to you.");
  membersStore(db).setAlertChoices(ctx.user.id, wanted, now.toISOString());
}

/** Turns app alerts on for a device (the browser's push subscription). Throws with a reason. */
export function addAlertDevice(db: EngineDb, ctx: MemberContext, subscription: unknown, label: unknown, now = new Date()): void {
  const block = alertsBlock(ctx);
  if (block) throw new Error(block);
  const sub = parseSubscription(subscription);
  if (!sub) throw new Error("This device's notification details weren't valid. Try again.");
  const store = membersStore(db);
  if (store.listPushDevices(ctx.user.id).length >= 10) throw new Error("Notifications are on for 10 devices already: turn one off first.");
  store.savePushDevice(ctx.user.id, sub, typeof label === "string" ? label.slice(0, 60) : null, now.toISOString());
}

export function removeAlertDevice(db: EngineDb, ctx: MemberContext, endpoint: unknown): void {
  if (typeof endpoint === "string") membersStore(db).deletePushDevice(endpoint, ctx.user.id);
}

function sendTo(db: EngineDb, userId: number, message: PushMessage): Promise<number> {
  const store = membersStore(db);
  return deliver(db, store.listPushDevices(userId), message, (endpoint) => store.deletePushDevice(endpoint, null));
}

export async function sendAlertTest(db: EngineDb, ctx: MemberContext): Promise<number> {
  const block = alertsBlock(ctx);
  if (block) throw new Error(block);
  return sendTo(db, ctx.user.id, { title: "GoalBrew test", body: "App alerts are working on this device.", url: "/members/notifications", tag: "member-test" });
}

/** "Brewed Awakening: Leeds v Hull" / "Next goal · Over 2.5 @ 1.85 · 63' 1-1 · Championship". */
export function alertMessage(p: LivePick, entry: CatalogueEntry, now: Date, maxAge: number): PushMessage {
  const f = toPickFull(p, entry.key, entry.name, now, maxAge);
  const bet = [f.market, f.selection].filter(Boolean).join(" · ") || "See the app";
  const when = f.minute !== null ? `${f.minute}'${f.score ? ` ${f.score}` : ""}` : f.kickoffAt ? "pre-match" : null;
  const body = [`${bet}${f.odds !== null ? ` @ ${f.odds.toFixed(2)}` : ""}`, when, f.competition].filter(Boolean).join(" · ");
  return { title: `${entry.name}: ${f.home ?? "?"} v ${f.away ?? "?"}`, body, url: `/members/upcoming#pick-${p.id}`, tag: `alert-${p.id}` };
}

/** One pass: pushes each new alert of a chosen strategy to the members who chose it. Returns how many were sent. */
export async function runAlertPushes(db: EngineDb, now = new Date()): Promise<number> {
  const store = membersStore(db);
  const choices = store.listAllAlertChoices();
  if (choices.length === 0) return 0;
  const catalogue = new Map(listCatalogue(db, getMembersConfig(db)).map((c) => [c.key, c]));
  const merges = db.getStrategyMerges();
  const maxAge = maxAgeMinutes(db);
  const picks = db.listLivePicks(200, { from: new Date(now.getTime() - FRESH_MS).toISOString(), to: new Date(now.getTime() + 60_000).toISOString() });
  const contexts = new Map<number, MemberContext | null>();
  let sent = 0;
  for (const p of picks) {
    if (p.excluded || p.result || p.status === "unmapped") continue;
    const key = memberStrategyKey(merges, p.strategy);
    const entry = catalogue.get(key);
    if (!entry) continue;
    const at = p.messageAt ?? p.firstSeenAt;
    const f = toPickFull(p, key, entry.name, now, maxAge);
    if (f.state !== "live") continue;
    if (f.odds === null && now.getTime() - Date.parse(at) < PRICE_WAIT_MS) continue;
    for (const c of choices) {
      if (c.strategyKey !== key || at < c.createdAt) continue;
      if (!contexts.has(c.userId)) contexts.set(c.userId, memberContext(db, c.userId, now));
      const ctx = contexts.get(c.userId);
      if (!ctx || alertsBlock(ctx) || !strategyAllowed(ctx.access, "viewSelections", key)) continue;
      if (!store.markAlertSent(c.userId, p.id, now.toISOString())) continue;
      try {
        if ((await sendTo(db, c.userId, alertMessage(p, entry, now, maxAge))) > 0) sent++;
      } catch (err) {
        log.warn(`Members app alert, pick ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return sent;
}
