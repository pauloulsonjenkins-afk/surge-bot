/**
 * Member lifecycle: who a member is right now (tier and permissions), the 7-day trial, and the admin's controls.
 *
 * TRIAL RULES (enforced here, on the engine; the website can't change them)
 *   - Started by the member pressing "Start trial", not at sign-up. The strategies are chosen in the same step.
 *   - Exactly `trialStrategyLimit` strategies (3), all offered to members, all different. Fixed for the whole trial:
 *     there is no route that changes them. Only the admin's "Reset trial" clears them (and allows one more trial).
 *   - One trial per normalised email, ever (email.ts), and none from throwaway inbox domains.
 *   - Ends `trialDays` (7) after it started; the account is then Free again (tier "expired"). Nothing is deleted:
 *     simulation, follows, settings and history stay; premium parts lock.
 *   - Never includes live betting (see permissions.ts).
 */
import type { EngineDb } from "../storage/engine-db";
import { getMembersConfig, type MembersConfig } from "./config";
import { accessFor, can, effectiveTier, type Access, type Tier } from "./permissions";
import { membersStore, type MemberRow } from "./store";
import { emailKey, isDisposableEmail } from "./email";
import { listCatalogue } from "./catalogue";
import { log } from "../server/log";

export interface MemberContext {
  user: { id: number; email: string; name: string };
  member: MemberRow;
  tier: Tier;
  access: Access;
  config: MembersConfig;
}

/**
 * The member behind a website account, with their tier and permissions at `now`. Null for an account that doesn't
 * exist or was disabled. The first visit makes the member (free). A member who has lost the right to live betting
 * (trial ended, subscription lapsed, suspended) has it switched off here, before anything else can use it.
 */
export function memberContext(db: EngineDb, userId: number, now = new Date()): MemberContext | null {
  const user = db.getAppUserById(userId);
  if (!user || !user.active) return null;
  const store = membersStore(db);
  const at = now.toISOString();
  const { member, created } = store.ensureMember(userId, at);
  if (created) {
    // The simulation bank starts now, at the default size, with a flat stake of 2% of it.
    store.getSettings(userId, { simBank: getMembersConfig(db).defaultSimBank, stakeValue: Math.max(1, Math.round(getMembersConfig(db).defaultSimBank * 2) / 100) }, at);
    store.event(userId, "free_registration", null, at);
    store.audit({ at, userId, actor: "member", action: "registration", object: `member ${userId}`, result: "ok", detail: null });
  }
  const config = getMembersConfig(db);
  const tier = effectiveTier(member, now);
  const access = accessFor(tier, store.trialStrategies(userId), config.tierOverrides, config.flags);
  const ctx: MemberContext = { user: { id: user.id, email: user.email, name: user.name }, member, tier, access, config };
  enforceLivePermission(db, ctx, at);
  return ctx;
}

function enforceLivePermission(db: EngineDb, ctx: MemberContext, at: string): void {
  if (can(ctx.access, "enableLiveBetting")) return;
  const store = membersStore(db);
  const liveFollows = store.listFollows(ctx.user.id).filter((f) => f.mode === "live").length;
  if (!ctx.member.liveEnabled && liveFollows === 0) return;
  store.updateMember(ctx.user.id, { liveEnabled: false }, at);
  store.liveFollowsToSim(ctx.user.id, at);
  ctx.member = { ...ctx.member, liveEnabled: false };
  store.audit({ at, userId: ctx.user.id, actor: "system", action: "automation_disabled", object: "live betting", result: "ok", detail: `Membership is ${ctx.tier}, which doesn't include live betting.` });
  store.notify({
    userId: ctx.user.id,
    at,
    kind: "automation_disabled",
    title: "Live betting switched off",
    body: "Your membership no longer includes live betting, so your strategies are back in simulation. No real bets will be placed.",
    link: "/members/automation",
  });
}

// ---- trial -------------------------------------------------------------------------------------------------------

export interface TrialStatus {
  /** available: can start one; active: running; used: had one; unavailable: not offered (reason says why). */
  state: "available" | "active" | "used" | "unavailable";
  reason: string | null;
  startedAt: string | null;
  endsAt: string | null;
  /** Whole days left (rounded up), and hours left, while active. */
  daysLeft: number | null;
  hoursLeft: number | null;
  strategies: string[];
  days: number;
  strategyLimit: number;
}

export function trialStatus(db: EngineDb, ctx: MemberContext, now = new Date()): TrialStatus {
  const store = membersStore(db);
  const base = { days: ctx.config.trialDays, strategyLimit: ctx.config.trialStrategyLimit, strategies: store.trialStrategies(ctx.user.id) };
  const m = ctx.member;
  if (m.trialEndsAt && Date.parse(m.trialEndsAt) > now.getTime() && ctx.tier === "trial") {
    const ms = Date.parse(m.trialEndsAt) - now.getTime();
    return { ...base, state: "active", reason: null, startedAt: m.trialStartedAt, endsAt: m.trialEndsAt, daysLeft: Math.ceil(ms / 86_400_000), hoursLeft: Math.ceil(ms / 3_600_000) };
  }
  if (m.trialStartedAt) return { ...base, state: "used", reason: "You've already had your free trial.", startedAt: m.trialStartedAt, endsAt: m.trialEndsAt, daysLeft: null, hoursLeft: null };
  const why = trialRefusal(db, ctx);
  return { ...base, state: why ? "unavailable" : "available", reason: why, startedAt: null, endsAt: null, daysLeft: null, hoursLeft: null };
}

/** Why this member can't start a trial, or null when they can. */
function trialRefusal(db: EngineDb, ctx: MemberContext): string | null {
  if (!ctx.config.flags.trial) return "Trials aren't available at the moment.";
  if (ctx.tier === "suspended") return "This account is suspended.";
  if (ctx.tier === "paid" || ctx.tier === "admin") return "You already have full access.";
  if (ctx.tier === "trial" || ctx.member.trialStartedAt) return "You've already had your free trial.";
  if (isDisposableEmail(ctx.user.email)) return "Trials need a permanent email address. Throwaway inboxes can use the Free membership.";
  const claim = membersStore(db).trialClaim(emailKey(ctx.user.email));
  if (claim && claim.userId !== ctx.user.id) return "A trial has already been used with this email address.";
  if (claim) return "You've already had your free trial.";
  return null;
}

export type StartTrialResult = { ok: true; status: TrialStatus } | { ok: false; error: string };

/** Starts the trial with the chosen strategies. Everything is checked here; a refused start writes only an audit line. */
export function startTrial(db: EngineDb, ctx: MemberContext, strategies: unknown, now = new Date()): StartTrialResult {
  const store = membersStore(db);
  const at = now.toISOString();
  const refuse = (error: string): StartTrialResult => {
    store.audit({ at, userId: ctx.user.id, actor: "member", action: "trial_start", object: null, result: "refused", detail: error });
    return { ok: false, error };
  };
  const why = trialRefusal(db, ctx);
  if (why) return refuse(why);
  const offered = new Set(listCatalogue(db, ctx.config).map((c) => c.key));
  const need = Math.min(ctx.config.trialStrategyLimit, offered.size);
  if (!Array.isArray(strategies)) return refuse("Choose your strategies.");
  const chosen = [...new Set(strategies.filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase()))];
  if (chosen.length !== strategies.length) return refuse("Each strategy can only be chosen once.");
  if (chosen.some((s) => !offered.has(s))) return refuse("One of those strategies isn't available.");
  if (chosen.length !== need) return refuse(`Choose exactly ${need} strategies.`);
  const endsAt = new Date(now.getTime() + ctx.config.trialDays * 86_400_000).toISOString();
  if (!store.startTrial(ctx.user.id, emailKey(ctx.user.email), chosen, at, endsAt)) return refuse("You've already had your free trial.");

  // Follow the chosen strategies in simulation, so the trial shows something straight away. Existing follows stay.
  const following = new Set(store.listFollows(ctx.user.id).map((f) => f.strategyKey));
  for (const s of chosen) if (!following.has(s)) store.setFollow(ctx.user.id, s, { mode: "sim", auto: true }, at);

  store.audit({ at, userId: ctx.user.id, actor: "member", action: "trial_start", object: chosen.join(", "), result: "ok", detail: `Ends ${endsAt}.` });
  store.event(ctx.user.id, "trial_started", { strategies: chosen }, at);
  for (const s of chosen) store.event(ctx.user.id, "trial_strategy_selected", { strategy: s }, at);
  store.notify({
    userId: ctx.user.id,
    at,
    kind: "trial_started",
    title: `Your ${ctx.config.trialDays}-day Premium Trial has started`,
    body: `You have full access to your ${chosen.length} chosen strategies until ${new Date(endsAt).toUTCString().slice(0, 22)}. Simulation only: no real money is placed.`,
    link: "/members",
  });
  log.info(`Member ${ctx.user.id} started a trial (${chosen.join(", ")}).`);
  const fresh = memberContext(db, ctx.user.id, now)!;
  return { ok: true, status: trialStatus(db, fresh, now) };
}

/**
 * Countdown and expiry notices, sent once each: 3 days left, 1 day left, ended. Also tells a member when paid access
 * has ended. Run by the members runner every few minutes.
 */
export function runMembershipNotices(db: EngineDb, now = new Date()): void {
  const store = membersStore(db);
  const at = now.toISOString();
  const t = now.getTime();
  for (const m of store.listMembers()) {
    if (m.trialEndsAt) {
      const left = Date.parse(m.trialEndsAt) - t;
      const notices = new Set(m.trialNotices);
      const paid = m.paidUntil !== null && Date.parse(m.paidUntil) > t;
      const add = (key: string, title: string, body: string, kind: string) => {
        notices.add(key);
        if (!paid) store.notify({ userId: m.userId, at, kind, title, body, link: "/members/upgrade" });
      };
      if (left <= 0 && !notices.has("ended")) {
        add("ended", "Your Premium Trial has ended", "You're back on the Free membership. Your simulation, settings and history are all kept. Upgrade any time to unlock everything again.", "trial_expired");
        store.event(m.userId, "trial_expired", null, at);
        store.audit({ at, userId: m.userId, actor: "system", action: "trial_expiry", object: `member ${m.userId}`, result: "ok", detail: null });
      } else if (left > 0 && left <= 86_400_000 && !notices.has("1d")) {
        add("1d", "Your trial ends tomorrow", "Your Premium Trial ends within 24 hours. Upgrade to keep detailed strategies, selections and full analytics.", "trial_ending");
      } else if (left > 86_400_000 && left <= 3 * 86_400_000 && !notices.has("3d")) {
        add("3d", "3 days left of your trial", "Your Premium Trial has 3 days left. Upgrade any time to keep full access.", "trial_ending");
      }
      if (notices.size !== m.trialNotices.length) store.updateMember(m.userId, { trialNotices: [...notices] }, at);
    }
    if (m.paidUntil && Date.parse(m.paidUntil) <= t && !store.hasNotification(m.userId, "paid_ended", m.paidUntil)) {
      store.notify({
        userId: m.userId,
        at,
        kind: "paid_ended",
        title: "Your membership has ended",
        body: "You're on the Free membership now. Everything you had is kept; renew to unlock it again.",
        link: m.paidUntil,
      });
      store.audit({ at, userId: m.userId, actor: "system", action: "membership_change", object: "paid ended", result: "ok", detail: m.paidUntil });
    }
  }
}

// ---- admin -------------------------------------------------------------------------------------------------------

export type AdminMemberAction =
  | { action: "set_override"; value: "admin" | "suspended" | null }
  | { action: "grant_paid"; until: string | null }
  | { action: "reset_trial" }
  | { action: "extend_trial"; days: number }
  | { action: "stop_live" };

/** The admin's changes to one member. Throws with a reason. */
export function adminUpdateMember(db: EngineDb, userId: number, a: AdminMemberAction, now = new Date()): MemberRow {
  const store = membersStore(db);
  const at = now.toISOString();
  if (!db.getAppUserById(userId)) throw new Error("No such account.");
  const before = store.ensureMember(userId, at).member;
  const audit = (action: string, detail: string) => store.audit({ at, userId, actor: "admin", action, object: `member ${userId}`, result: "ok", detail });
  switch (a.action) {
    case "set_override": {
      if (a.value !== null && a.value !== "admin" && a.value !== "suspended") throw new Error("Choose admin, suspended or none.");
      store.updateMember(userId, { tierOverride: a.value }, at);
      if (a.value === "suspended") {
        store.updateMember(userId, { liveEnabled: false }, at);
        store.liveFollowsToSim(userId, at);
      }
      audit("membership_change", `Override ${before.tierOverride ?? "none"} -> ${a.value ?? "none"}.`);
      break;
    }
    case "grant_paid": {
      if (a.until !== null && !Number.isFinite(Date.parse(a.until))) throw new Error("Give a valid date.");
      store.updateMember(userId, { paidUntil: a.until, paidSource: a.until ? "admin" : before.paidSource === "admin" ? null : before.paidSource }, at);
      audit("membership_change", `Paid until ${a.until ?? "none"} (was ${before.paidUntil ?? "none"}).`);
      if (a.until && Date.parse(a.until) > now.getTime()) store.event(userId, "paid_subscription_started", { source: "admin" }, at);
      break;
    }
    case "reset_trial": {
      store.resetTrial(userId, at);
      audit("trial_reset", "The member may start one more trial.");
      break;
    }
    case "extend_trial": {
      if (!before.trialEndsAt) throw new Error("This member hasn't started a trial.");
      if (!Number.isInteger(a.days) || a.days < 1 || a.days > 60) throw new Error("Extend by 1 to 60 days.");
      const base = Math.max(Date.parse(before.trialEndsAt), now.getTime());
      const ends = new Date(base + a.days * 86_400_000).toISOString();
      store.updateMember(userId, { trialEndsAt: ends, trialNotices: [] }, at);
      audit("trial_extend", `Trial now ends ${ends}.`);
      break;
    }
    case "stop_live": {
      store.updateMember(userId, { liveEnabled: false, automationPaused: true }, at);
      store.liveFollowsToSim(userId, at);
      audit("kill_switch", "Admin stopped this member's live betting.");
      store.notify({ userId, at, kind: "kill_switch", title: "Live betting stopped", body: "An administrator stopped live betting on your account. Your strategies are in simulation.", link: "/members/automation" });
      break;
    }
  }
  return store.getMember(userId)!;
}

/** Product events the website may record for a member (anything else is ignored). */
export const CLIENT_EVENTS = new Set([
  "strategy_viewed",
  "daily_results_viewed",
  "weekly_results_viewed",
  "simulation_used",
  "premium_feature_clicked",
  "upgrade_prompt_shown",
  "upgrade_clicked",
  "trial_prompt_clicked",
]);
