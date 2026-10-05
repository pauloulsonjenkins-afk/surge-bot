/**
 * /internal/members/* : the Members platform's engine API, called only by the website's server with the same Bearer
 * key as every /internal route (checked by http.ts before this runs). The website first checks the member's sign-in
 * cookie and passes their account id in the header X-Member-Id; the engine re-reads the account (it must exist and be
 * active) and works out their permissions itself. Nothing the browser sends decides what a member may see or do.
 *
 *   GET  me | plans | dashboard | strategies | strategy?key= | upcoming | history?mode&strategy&from&to&result&execution&page
 *        performance?mode&range | settings | automation | notifications | community | community/strategy?id=
 *   POST trial/start {strategies} | follow {strategy, mode, auto} or {strategy, off: true} | settings {...}
 *        settings/reset-sim {bank} | simulate {pickId} | notifications/read | event {event, props}
 *        billing/checkout | billing/portal | betfair/connect {kind} | betfair/test | betfair/disconnect
 *        live {on, confirmation} | live/stop | community/create | community/update {id, ...} | community/delete {id}
 *   Admin (no member id): GET admin/overview | admin/config ; POST admin/config | admin/member {userId, action, ...}
 *        admin/stop-all-live
 * Errors come back as { error } in plain English (400), never stack traces.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EngineDb } from "../storage/engine-db";
import { log } from "../server/log";
import { getMembersConfig, saveMembersConfig } from "./config";
import { listCatalogue } from "./catalogue";
import { adminUpdateMember, CLIENT_EVENTS, memberContext, startTrial, type AdminMemberAction, type MemberContext } from "./service";
import { can } from "./permissions";
import { membersStore, type BetMode, type StakingMethod } from "./store";
import { cleanRisk } from "./staking";
import { memberSettingsFor, simulateManually, wakeMembers } from "./runner";
import { automationView, dashboardView, historyView, meView, performanceView, plansView, settingsView, strategiesView, strategyView, upcomingView, type BetFilters } from "./views";
import { createCheckout, createPortal, stripeConfigured } from "./stripe";
import { connectOrTest, disconnect } from "./betfair-connection";
import { globalKillSwitch, memberKillSwitch, setMemberLive, type LiveDeps } from "./live";
import { createStrategy, deleteStrategy, leaderboard, listOwnStrategies, ownStrategyView, updateStrategy } from "./community";
import { effectiveTier } from "./permissions";

export interface MembersRouteCtx {
  req: IncomingMessage;
  method: string;
  path: string;
  url: URL;
  db: EngineDb;
  res: ServerResponse;
  send: (res: ServerResponse, status: number, body: Record<string, unknown>) => void;
  readJsonBody: () => Promise<Record<string, unknown>>;
  live: LiveDeps | null;
}

class Refused extends Error {}

const PREFIX = "/internal/members/";

/** Returns true when the path was a members route (and a reply was sent). */
export async function handleMembersRoute(c: MembersRouteCtx): Promise<boolean> {
  if (!c.path.startsWith(PREFIX)) return false;
  const route = c.path.slice(PREFIX.length);
  try {
    if (route.startsWith("admin/")) await adminRoute(c, route.slice(6));
    else await memberRoute(c, route);
  } catch (err) {
    if (err instanceof Refused || err instanceof Error) {
      const known = err instanceof Refused || !/TypeError|ReferenceError|SqliteError/.test(err.name);
      if (!known) log.error(`Members route ${route} failed: ${err.stack ?? err.message}`);
      c.send(c.res, known ? 400 : 500, { error: known ? err.message : "Something went wrong. Please try again." });
    } else c.send(c.res, 500, { error: "Something went wrong. Please try again." });
  }
  return true;
}

function memberId(req: IncomingMessage): number | null {
  const raw = req.headers["x-member-id"];
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

async function memberRoute(c: MembersRouteCtx, route: string): Promise<void> {
  const { db, res, send, method, url } = c;
  const id = memberId(c.req);
  if (id === null) return send(res, 401, { error: "Sign in to continue." });
  const ctx = memberContext(db, id);
  if (!ctx) return send(res, 401, { error: "Sign in to continue." });
  const ok = (body: Record<string, unknown>) => send(res, 200, body);
  const store = membersStore(db);
  const at = () => new Date().toISOString();

  if (method === "GET") {
    switch (route) {
      case "me":
        return ok(meView(db, ctx));
      case "plans":
        return ok(plansView(db, ctx));
      case "dashboard":
        return ok(dashboardView(db, ctx, c.live));
      case "strategies":
        return ok({ strategies: strategiesView(db, ctx), trialPicker: trialPicker(db, ctx) });
      case "strategy": {
        const v = strategyView(db, ctx, url.searchParams.get("key") ?? "");
        return v ? ok({ strategy: v }) : send(res, 404, { error: "No such strategy." });
      }
      case "upcoming":
        return ok(upcomingView(db, ctx, c.live));
      case "history": {
        const q = url.searchParams;
        const mode = q.get("mode");
        const result = q.get("result");
        const execution = q.get("execution");
        const f: BetFilters = {
          mode: mode === "sim" || mode === "live" ? mode : undefined,
          strategy: s(q.get("strategy"), 120)?.toLowerCase() || undefined,
          from: isoOrUndefined(q.get("from")),
          to: isoOrUndefined(q.get("to")),
          result: result === "won" || result === "lost" || result === "void" || result === "open" || result === "notPlaced" ? result : undefined,
          execution: execution === "auto" || execution === "manual" ? execution : undefined,
          page: Number(q.get("page")) || 0,
        };
        return ok(historyView(db, ctx, f));
      }
      case "performance": {
        const mode: BetMode = url.searchParams.get("mode") === "live" ? "live" : "sim";
        const r = url.searchParams.get("range");
        return ok(performanceView(db, ctx, mode, r === "today" || r === "7d" || r === "30d" ? r : "all"));
      }
      case "settings":
        return ok(settingsView(db, ctx));
      case "automation":
        return ok(automationView(db, ctx, c.live));
      case "notifications":
        return ok({ notifications: store.listNotifications(id, 50), unread: store.unreadCount(id) });
      case "community":
        return ok({ own: can(ctx.access, "createStrategy") ? listOwnStrategies(db, ctx) : [], leaderboard: leaderboard(db, ctx), canCreate: can(ctx.access, "createStrategy") && ctx.config.flags.strategyCreation, catalogue: listCatalogue(db, ctx.config).map((x) => ({ key: x.key, name: x.name })) });
      case "community/strategy":
        return ok(ownStrategyView(db, ctx, url.searchParams.get("id")));
    }
    return send(res, 404, { error: "not_found" });
  }

  if (method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  const body = await c.readJsonBody();
  switch (route) {
    case "trial/start": {
      const r = startTrial(db, ctx, body.strategies);
      if (!r.ok) throw new Refused(r.error);
      return ok({ trial: r.status });
    }
    case "follow":
      follow(db, ctx, body);
      wakeMembers();
      return ok({ follows: store.listFollows(id) });
    case "settings":
      saveSettings(db, ctx, body);
      return ok(settingsView(db, ctx));
    case "settings/reset-sim": {
      if (!can(ctx.access, "useSimulation")) throw new Refused("Simulation isn't part of your membership.");
      const bank = Number(body.bank);
      if (!Number.isFinite(bank) || bank < 10 || bank > 1_000_000) throw new Refused("Choose a starting bank from £10 to £1,000,000.");
      memberSettingsFor(db, ctx, at());
      store.resetSimulation(id, Math.round(bank * 100) / 100, at());
      store.audit({ at: at(), userId: id, actor: "member", action: "simulation_reset", object: null, result: "ok", detail: `New bank £${bank}.` });
      store.event(id, "simulation_used", { reset: true, bank }, at());
      return ok(settingsView(db, ctx));
    }
    case "simulate": {
      const r = simulateManually(db, ctx, body.pickId);
      if (!r.ok) throw new Refused(r.error);
      return ok({ betId: r.bet.id });
    }
    case "notifications/read":
      store.markNotificationsRead(id, at());
      return ok({ unread: 0 });
    case "event": {
      const ev = s(body.event, 60);
      if (ev && CLIENT_EVENTS.has(ev)) store.event(id, ev, body.props && typeof body.props === "object" ? (body.props as Record<string, unknown>) : null, at());
      return ok({ ok: true });
    }
    case "billing/checkout":
      store.event(id, "upgrade_clicked", null, at());
      return ok({ url: await createCheckout(db, ctx) });
    case "billing/portal":
      return ok({ url: await createPortal(ctx) });
    case "betfair/connect":
    case "betfair/test":
      return ok({ connection: await connectOrTest(db, ctx, body.kind === "vendor" ? "vendor" : "house", c.live) });
    case "betfair/disconnect":
      disconnect(db, ctx);
      return ok({ ok: true });
    case "live": {
      const r = setMemberLive(db, ctx, body.on === true, body.confirmation);
      if (!r.ok) throw new Refused(r.error);
      return ok({ ok: true });
    }
    case "live/stop":
      return ok({ cancelled: memberKillSwitch(db, id) });
    case "community/create":
      return ok({ strategy: createStrategy(db, ctx, body) });
    case "community/update":
      return ok({ strategy: updateStrategy(db, ctx, body.id, body) });
    case "community/delete":
      deleteStrategy(db, ctx, body.id);
      return ok({ ok: true });
  }
  send(res, 404, { error: "not_found" });
}

function isoOrUndefined(v: string | null): string | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** For the trial start screen: every offered strategy with its record, so the choice is informed (no methodology). */
function trialPicker(db: EngineDb, ctx: MemberContext) {
  if (ctx.tier !== "free" && ctx.tier !== "expired") return null;
  return { limit: ctx.config.trialStrategyLimit, days: ctx.config.trialDays };
}

function follow(db: EngineDb, ctx: MemberContext, body: Record<string, unknown>): void {
  const store = membersStore(db);
  const key = s(body.strategy, 120)?.toLowerCase();
  const entry = listCatalogue(db, ctx.config).find((x) => x.key === key);
  if (!key || !entry) throw new Refused("No such strategy.");
  const at = new Date().toISOString();
  if (body.off === true) {
    store.setFollow(ctx.user.id, key, null, at);
    return;
  }
  const mode: BetMode = body.mode === "live" ? "live" : "sim";
  if (mode === "sim" && !can(ctx.access, "useSimulation")) throw new Refused("Simulation isn't part of your membership.");
  if (mode === "live") {
    if (!can(ctx.access, "enableLiveBetting")) throw new Refused("Live betting isn't part of your membership.");
    if (!entry.liveApproved) throw new Refused("This strategy isn't approved for live betting.");
    if (!ctx.member.liveEnabled) throw new Refused("Switch live betting on in Betfair Automation first.");
  }
  const auto = body.auto !== false;
  if (auto && mode === "sim" && !can(ctx.access, "simAutomation")) throw new Refused("Automatic simulation isn't part of your membership.");
  store.setFollow(ctx.user.id, key, { mode, auto }, at);
  store.audit({ at, userId: ctx.user.id, actor: "member", action: mode === "live" ? "automation_enabled" : "follow", object: key, result: "ok", detail: `${mode}${auto ? ", automatic" : ""}` });
  if (mode === "sim") store.event(ctx.user.id, "simulation_used", { follow: key }, at);
}

const METHODS: StakingMethod[] = ["flat", "percent_bank", "fixed_percent", "custom", "strategy"];

function saveSettings(db: EngineDb, ctx: MemberContext, body: Record<string, unknown>): void {
  const store = membersStore(db);
  const at = new Date().toISOString();
  const cur = memberSettingsFor(db, ctx, at);
  const advanced = can(ctx.access, "advancedStaking");
  let method = cur.stakingMethod;
  if (body.stakingMethod !== undefined) {
    if (!METHODS.includes(body.stakingMethod as StakingMethod)) throw new Refused("Choose a staking method.");
    if (body.stakingMethod !== "flat" && !advanced) throw new Refused("Advanced staking is for trial and paid members. Free members use a flat stake.");
    method = body.stakingMethod as StakingMethod;
  }
  let value = cur.stakeValue;
  if (body.stakeValue !== undefined) {
    value = Number(body.stakeValue);
    const pct = method === "percent_bank" || method === "fixed_percent";
    if (!Number.isFinite(value) || value <= 0 || (pct ? value > 25 : value > 100_000)) throw new Refused(pct ? "Choose a percentage from 0.1 to 25." : "Choose a stake above £0.");
    value = Math.round(value * 100) / 100;
  }
  let custom = cur.customStakes;
  if (body.customStakes !== undefined) {
    if (!advanced) throw new Refused("Custom stakes are for trial and paid members.");
    const raw = body.customStakes && typeof body.customStakes === "object" ? (body.customStakes as Record<string, unknown>) : {};
    const offered = new Set(listCatalogue(db, ctx.config).map((x) => x.key));
    custom = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (offered.has(k) && Number.isFinite(n) && n > 0 && n <= 100_000) custom[k] = Math.round(n * 100) / 100;
    }
  }
  let risk = cur.risk;
  if (body.risk !== undefined) {
    try {
      risk = cleanRisk(body.risk, cur.risk, can(ctx.access, "advancedRisk"));
    } catch (err) {
      throw new Refused(err instanceof Error ? err.message : "Those limits can't be saved.");
    }
  }
  store.saveSettings(ctx.user.id, { stakingMethod: method, stakeValue: value, customStakes: custom, risk }, at);
  if (body.risk !== undefined) store.audit({ at, userId: ctx.user.id, actor: "member", action: "risk_limit_changed", object: null, result: "ok", detail: JSON.stringify(risk) });
}

// ---- admin -----------------------------------------------------------------------------------------------------

async function adminRoute(c: MembersRouteCtx, route: string): Promise<void> {
  const { db, res, send, method } = c;
  const store = membersStore(db);
  const ok = (body: Record<string, unknown>) => send(res, 200, body);
  if (method === "GET" && route === "overview") {
    const now = new Date();
    // Every account, whether or not it has opened the Members platform yet (those show as free, not visited).
    const rows = new Map(store.listMembers().map((m) => [m.userId, m]));
    const members = db.listAppUsers().map((u) => {
      const m = rows.get(u.id) ?? { userId: u.id, tierOverride: null, trialStartedAt: null, trialEndsAt: null, paidUntil: null, paidSource: null, subscriptionStatus: null, liveEnabled: false, automationPaused: false, createdAt: u.createdAt };
      return {
        userId: u.id,
        email: u.email,
        name: u.name,
        active: u.active,
        visited: rows.has(u.id),
        lastLoginAt: u.lastLoginAt,
        tier: effectiveTier(m, now),
        tierOverride: m.tierOverride,
        trialStartedAt: m.trialStartedAt,
        trialEndsAt: m.trialEndsAt,
        trialStrategies: store.trialStrategies(m.userId),
        paidUntil: m.paidUntil,
        paidSource: m.paidSource,
        subscriptionStatus: m.subscriptionStatus,
        liveEnabled: m.liveEnabled,
        automationPaused: m.automationPaused,
        connection: store.getConnection(m.userId).kind,
        createdAt: m.createdAt,
      };
    });
    const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const bets = store.listAllBets({ since: since30, limit: 5000 });
    return ok({
      members,
      funnel: store.eventCounts(since30),
      bets: {
        sim: bets.filter((b) => b.mode === "sim").length,
        live: bets.filter((b) => b.mode === "live").length,
        failedLive: bets.filter((b) => b.mode === "live" && (b.status === "failed" || b.status === "rejected")).slice(0, 50),
      },
      audit: store.listAudit({ limit: 100 }),
      stripe: { configured: stripeConfigured() },
    });
  }
  if (route === "config") {
    if (method === "POST") saveMembersConfig(db, await c.readJsonBody());
    return ok({ config: getMembersConfig(db), strategies: listCatalogue(db, { ...getMembersConfig(db), publishedStrategies: [] }).map((x) => ({ key: x.key, name: x.name })) });
  }
  if (method === "POST" && route === "member") {
    const body = await c.readJsonBody();
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) throw new Refused("Which member?");
    const action = body.action;
    let a: AdminMemberAction;
    if (action === "set_override") a = { action, value: body.value === "admin" || body.value === "suspended" ? body.value : null };
    else if (action === "grant_paid") a = { action, until: typeof body.until === "string" && body.until ? body.until : null };
    else if (action === "reset_trial" || action === "stop_live") a = { action };
    else if (action === "extend_trial") a = { action, days: Number(body.days) };
    else throw new Refused("Unknown action.");
    return ok({ member: adminUpdateMember(db, userId, a) });
  }
  if (method === "POST" && route === "stop-all-live") return ok({ cancelled: globalKillSwitch(db) });
  send(res, 404, { error: "not_found" });
}
