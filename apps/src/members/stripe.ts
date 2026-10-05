/**
 * Paid membership through Stripe subscriptions. The engine talks to Stripe directly (no SDK, plain HTTPS), and Stripe
 * tells the engine about payments through its webhook, so paid access follows Stripe and never the browser.
 *
 * Engine settings (DigitalOcean):
 *   STRIPE_SECRET_KEY       sk_live_... (or sk_test_... to try it out)
 *   STRIPE_PRICE_ID         the subscription price, made in the Stripe dashboard (price_...)
 *   STRIPE_WEBHOOK_SECRET   whsec_... from the webhook endpoint below
 *   MEMBERS_SITE_URL        the website's address, for Stripe's return links (default: the DigitalOcean app address)
 * Webhook endpoint to add in Stripe: <site>/engine/webhooks/stripe, events: checkout.session.completed,
 * customer.subscription.created / updated / deleted, invoice.payment_failed.
 *
 * Paid access lasts to the end of the period Stripe has been paid for, plus a day's grace. Each event is handled once
 * (Stripe can send one more than once), and its signature is checked against STRIPE_WEBHOOK_SECRET first.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EngineDb } from "../storage/engine-db";
import { log } from "../server/log";
import type { MemberContext } from "./service";
import { membersStore, type MemberRow } from "./store";

const API = "https://api.stripe.com/v1/";
const GRACE_MS = 86_400_000;

export function stripeConfigured(env = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY?.trim() && env.STRIPE_PRICE_ID?.trim() && env.STRIPE_WEBHOOK_SECRET?.trim());
}

function siteUrl(env = process.env): string {
  const u = env.MEMBERS_SITE_URL?.trim() || "https://seashell-app-z8xl5.ondigitalocean.app";
  return u.replace(/\/+$/, "");
}

async function stripePost(path: string, params: Record<string, string>, env = process.env): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new Error(`Stripe: ${msg}`);
  }
  return body;
}

/** A Stripe Checkout page for the subscription. Returns its address for the browser to go to. */
export async function createCheckout(db: EngineDb, ctx: MemberContext, env = process.env): Promise<string> {
  if (!stripeConfigured(env)) throw new Error("Payments aren't set up yet.");
  if (ctx.tier === "paid" || ctx.tier === "admin") throw new Error("You already have full access.");
  if (ctx.tier === "suspended") throw new Error("This account is suspended.");
  const site = siteUrl(env);
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": env.STRIPE_PRICE_ID!.trim(),
    "line_items[0][quantity]": "1",
    success_url: `${site}/members?upgraded=1`,
    cancel_url: `${site}/members/upgrade`,
    client_reference_id: String(ctx.user.id),
    "metadata[user_id]": String(ctx.user.id),
    "subscription_data[metadata][user_id]": String(ctx.user.id),
    allow_promotion_codes: "true",
  };
  if (ctx.member.stripeCustomerId) params.customer = ctx.member.stripeCustomerId;
  else params.customer_email = ctx.user.email;
  const s = await stripePost("checkout/sessions", params, env);
  membersStore(db).event(ctx.user.id, "upgrade_checkout_started", null, new Date().toISOString());
  if (typeof s.url !== "string") throw new Error("Stripe didn't return a checkout page.");
  return s.url;
}

/** Stripe's billing page (change card, cancel), for a member who has subscribed. */
export async function createPortal(ctx: MemberContext, env = process.env): Promise<string> {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Payments aren't set up yet.");
  if (!ctx.member.stripeCustomerId) throw new Error("There's no subscription on this account.");
  const s = await stripePost("billing_portal/sessions", { customer: ctx.member.stripeCustomerId, return_url: `${siteUrl(env)}/members/settings` }, env);
  if (typeof s.url !== "string") throw new Error("Stripe didn't return a billing page.");
  return s.url;
}

/** Checks Stripe's "Stripe-Signature" header (t=...,v1=...) over the raw body. Within 5 minutes of now. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || sigs.length === 0 || Math.abs(nowSec - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.`).update(raw).digest("hex"));
  return sigs.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);

function memberFor(db: EngineDb, obj: Obj): MemberRow | null {
  const store = membersStore(db);
  const meta = (obj.metadata ?? {}) as Obj;
  const id = Number(str(meta.user_id) ?? str(obj.client_reference_id));
  if (Number.isInteger(id) && id > 0 && db.getAppUserById(id)) return store.ensureMember(id, new Date().toISOString()).member;
  const customer = str(obj.customer);
  return customer ? store.getMemberByStripeCustomer(customer) : null;
}

/** The end of the period paid for, from a subscription (older and newer Stripe API shapes). */
function periodEnd(sub: Obj): number | null {
  if (typeof sub.current_period_end === "number") return sub.current_period_end;
  const items = (sub.items as { data?: Array<{ current_period_end?: number }> } | undefined)?.data ?? [];
  const ends = items.map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  return ends.length ? Math.max(...ends) : null;
}

/** Handles one verified event. Returns what it did, for the log. */
export function handleStripeEvent(db: EngineDb, event: Obj, now = new Date()): string {
  const store = membersStore(db);
  const at = now.toISOString();
  const id = str(event.id);
  const type = str(event.type) ?? "";
  if (!id) return "ignored: no id";
  if (!store.claimStripeEvent(id, type, at)) return "already handled";
  const obj = ((event.data as Obj | undefined)?.object ?? {}) as Obj;
  const m = memberFor(db, obj);
  if (!m) return `ignored: no member for ${type}`;

  if (type === "checkout.session.completed") {
    store.updateMember(m.userId, { stripeCustomerId: str(obj.customer) ?? m.stripeCustomerId, stripeSubscriptionId: str(obj.subscription) ?? m.stripeSubscriptionId }, at);
    return `checkout completed for member ${m.userId}`;
  }
  if (type.startsWith("customer.subscription.")) {
    const status = str(obj.status) ?? "unknown";
    const end = periodEnd(obj);
    const live = (status === "active" || status === "trialing" || status === "past_due") && type !== "customer.subscription.deleted";
    const paidUntil = live && end ? new Date(end * 1000 + GRACE_MS).toISOString() : at;
    const wasPaid = m.paidUntil !== null && Date.parse(m.paidUntil) > now.getTime();
    store.updateMember(m.userId, { paidUntil, paidSource: "stripe", subscriptionStatus: status, stripeCustomerId: str(obj.customer) ?? m.stripeCustomerId, stripeSubscriptionId: str(obj.id) ?? m.stripeSubscriptionId }, at);
    store.audit({ at, userId: m.userId, actor: "stripe", action: live ? (wasPaid ? "membership_change" : "upgrade") : "membership_change", object: `subscription ${str(obj.id) ?? ""}`, result: "ok", detail: `${type}: ${status}, paid until ${paidUntil}.` });
    if (live && !wasPaid) {
      store.event(m.userId, "paid_subscription_started", { source: "stripe" }, at);
      store.notify({ userId: m.userId, at, kind: "upgrade", title: "Welcome to full membership", body: "Every strategy, full detail and all features are now unlocked.", link: "/members" });
    }
    return `subscription ${status} for member ${m.userId}`;
  }
  if (type === "invoice.payment_failed") {
    store.notify({ userId: m.userId, at, kind: "payment_failed", title: "Payment didn't go through", body: "Stripe couldn't take your membership payment. Update your card in Settings to keep full access.", link: "/members/settings" });
    return `payment failed for member ${m.userId}`;
  }
  return `ignored: ${type}`;
}

/** The webhook, given the raw body and signature header. Status and body to reply with. */
export function stripeWebhook(db: EngineDb, raw: Buffer, signature: string | undefined, env = process.env): { status: number; body: Record<string, unknown> } {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return { status: 503, body: { error: "not_configured" } };
  if (!verifyStripeSignature(raw, signature, secret)) return { status: 400, body: { error: "bad_signature" } };
  let event: Obj;
  try {
    event = JSON.parse(raw.toString("utf8")) as Obj;
  } catch {
    return { status: 400, body: { error: "bad_json" } };
  }
  const did = handleStripeEvent(db, event);
  log.info(`Stripe webhook ${str(event.type)}: ${did}.`);
  return { status: 200, body: { received: true } };
}
