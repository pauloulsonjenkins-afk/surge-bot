/**
 * COMMUNITY strategies: member-made strategies, private to their creator unless shared (and sharing is switched on).
 *
 * A member strategy is a filter on top of the house alerts: which house strategies it starts from, then minute, odds
 * and league conditions. Its results are therefore worked out by GoalBrew from real alerts and their real results
 * ("system verified"), never typed in, so nobody can claim figures they didn't get. All results are SIMULATION
 * (a level £10 per alert at the alert's price, after commission), and are labelled so.
 *
 * VERSIONS: changing the rules makes a new version. Each alert is judged by the version in force when it arrived, so
 * the tracked record keeps the results that came from the old rules. A "backtest" of the current rules over past
 * alerts is shown separately and never counts towards the leaderboard.
 *
 * LEADERBOARD: ranked by ROI shrunk towards zero by sample size, roi x n / (n + 100), so 20 bets at +100% (adjusted
 * +16.7%) doesn't outrank 2,000 bets at +25% (adjusted +23.8%). Strategies with fewer than 20 tracked bets aren't ranked.
 *
 * OWNERSHIP: only the owner can see the rules, change, pause, archive or delete a strategy (checked here, by user id).
 */
import type { EngineDb } from "../storage/engine-db";
import { pickOdds } from "../server/pricing";
import { can } from "./permissions";
import type { MemberContext } from "./service";
import { listCatalogue, memberStrategyKey } from "./catalogue";
import { HOUSE_UNIT_STAKE, MoneyTally, hitRate, type MoneyFigures } from "./house";
import { membersStore, type CommunityStrategy, type StrategyVersion } from "./store";

export interface StrategyRules {
  /** House strategy keys it starts from (at least one). */
  base: string[];
  minuteMin: number | null;
  minuteMax: number | null;
  oddsMin: number | null;
  oddsMax: number | null;
  /** Only alerts from leagues whose name contains one of these (empty = any). */
  leagues: string[];
  /** Never alerts from leagues whose name contains one of these. */
  excludeLeagues: string[];
}

export interface Record_ extends MoneyFigures {
  bets: number;
  wins: number;
  losses: number;
  hitRate: number | null;
}

const LEADERBOARD_MIN_BETS = 20;
const SHRINK = 100;

function num(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Enter a number from ${min} to ${max}.`);
  return Math.round(n * 100) / 100;
}

function words(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 30);
}

export function cleanRules(db: EngineDb, ctx: MemberContext, raw: unknown): StrategyRules {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const offered = new Set(listCatalogue(db, ctx.config).map((c) => c.key));
  const base = words(r.base).map((s) => s.toLowerCase()).filter((s) => offered.has(s));
  if (base.length === 0) throw new Error("Choose at least one house strategy to start from.");
  const rules: StrategyRules = {
    base,
    minuteMin: num(r.minuteMin, 0, 130),
    minuteMax: num(r.minuteMax, 0, 130),
    oddsMin: num(r.oddsMin, 1.01, 1000),
    oddsMax: num(r.oddsMax, 1.01, 1000),
    leagues: words(r.leagues),
    excludeLeagues: words(r.excludeLeagues),
  };
  if (rules.minuteMin !== null && rules.minuteMax !== null && rules.minuteMin > rules.minuteMax) throw new Error("The earliest minute is after the latest.");
  if (rules.oddsMin !== null && rules.oddsMax !== null && rules.oddsMin > rules.oddsMax) throw new Error("The minimum odds are above the maximum.");
  return rules;
}

function matches(rules: StrategyRules, p: { key: string; minute: number | null; odds: number | null; competition: string | null }): boolean {
  if (!rules.base.includes(p.key)) return false;
  if (rules.minuteMin !== null && (p.minute === null || p.minute < rules.minuteMin)) return false;
  if (rules.minuteMax !== null && (p.minute === null || p.minute > rules.minuteMax)) return false;
  if (rules.oddsMin !== null && (p.odds === null || p.odds < rules.oddsMin)) return false;
  if (rules.oddsMax !== null && (p.odds === null || p.odds > rules.oddsMax)) return false;
  const league = (p.competition ?? "").toLowerCase();
  if (rules.leagues.length && !rules.leagues.some((l) => league.includes(l.toLowerCase()))) return false;
  if (rules.excludeLeagues.some((l) => league.includes(l.toLowerCase()))) return false;
  return true;
}

/** Settled house alerts with what a rule needs. */
function settledAlerts(db: EngineDb) {
  const merges = db.getStrategyMerges();
  const comp = new Map<number, { minute: number | null; competition: string | null }>();
  for (const p of db.listAllLivePicks()) comp.set(p.id, { minute: p.minute, competition: p.competition });
  return db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").map((r) => ({
    at: r.firstSeenAt,
    key: memberStrategyKey(merges, r.strategy),
    won: r.result === "hit",
    odds: pickOdds(r, null)?.odds ?? null,
    minute: comp.get(r.id)?.minute ?? null,
    competition: comp.get(r.id)?.competition ?? null,
  }));
}

function tally(list: Array<{ won: boolean; odds: number | null }>, commissionPct: number): Record_ {
  const t = new MoneyTally();
  let wins = 0;
  let losses = 0;
  for (const a of list) {
    if (a.won) wins++;
    else losses++;
    if (a.odds !== null) t.add(HOUSE_UNIT_STAKE, a.odds, a.won, commissionPct / 100);
  }
  return { bets: wins + losses, wins, losses, hitRate: hitRate(wins, losses), ...t.result() };
}

/**
 * Tracked: each alert judged by the version in force when it arrived (from the strategy's creation on).
 * Backtest: the current rules over every past alert (hypothetical, never ranked).
 */
export function strategyRecord(db: EngineDb, s: CommunityStrategy, versions: StrategyVersion[], commissionPct: number): { tracked: Record_; backtest: Record_ } {
  const alerts = settledAlerts(db);
  const sorted = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const current = sorted[sorted.length - 1]?.rules as StrategyRules | undefined;
  const tracked = alerts.filter((a) => {
    if (a.at < s.createdAt) return false;
    const v = [...sorted].reverse().find((x) => x.createdAt <= a.at);
    return v ? matches(v.rules as StrategyRules, a) : false;
  });
  const back = current ? alerts.filter((a) => matches(current, a)) : [];
  return { tracked: tally(tracked, commissionPct), backtest: tally(back, commissionPct) };
}

export function adjustedRoi(roi: number | null, bets: number): number | null {
  return roi === null ? null : Math.round(((roi * bets) / (bets + SHRINK)) * 10) / 10;
}

// ---- owner actions -------------------------------------------------------------------------------------------

function own(db: EngineDb, ctx: MemberContext, id: unknown): CommunityStrategy {
  const n = Number(id);
  const s = Number.isInteger(n) ? membersStore(db).getCommunityStrategy(n) : null;
  // Someone else's strategy is answered exactly like one that doesn't exist.
  if (!s || s.ownerId !== ctx.user.id) throw new Error("No such strategy.");
  return s;
}

function cleanText(v: unknown, max: number, what: string, required: boolean): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (required && !s) throw new Error(`Give it a ${what}.`);
  if (s.length > max) throw new Error(`The ${what} can be at most ${max} characters.`);
  return s;
}

export function createStrategy(db: EngineDb, ctx: MemberContext, body: Record<string, unknown>, now = new Date()): CommunityStrategy {
  if (!can(ctx.access, "createStrategy")) throw new Error("Creating strategies is for paid members.");
  const store = membersStore(db);
  if (store.listCommunityStrategies({ ownerId: ctx.user.id }).length >= 20) throw new Error("You can have up to 20 strategies.");
  const s = store.createCommunityStrategy(ctx.user.id, cleanText(body.name, 40, "name", true), cleanText(body.description, 300, "description", false), cleanRules(db, ctx, body.rules), now.toISOString());
  store.audit({ at: now.toISOString(), userId: ctx.user.id, actor: "member", action: "strategy_creation", object: `community ${s.id}`, result: "ok", detail: s.name });
  return s;
}

export function updateStrategy(db: EngineDb, ctx: MemberContext, id: unknown, body: Record<string, unknown>, now = new Date()): CommunityStrategy {
  const s = own(db, ctx, id);
  const store = membersStore(db);
  const at = now.toISOString();
  const patch: Partial<Pick<CommunityStrategy, "name" | "description" | "status" | "visibility">> = {};
  if (body.name !== undefined) patch.name = cleanText(body.name, 40, "name", true);
  if (body.description !== undefined) patch.description = cleanText(body.description, 300, "description", false);
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "paused" && body.status !== "archived") throw new Error("Choose active, paused or archived.");
    patch.status = body.status;
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== "private" && body.visibility !== "shared") throw new Error("Choose private or shared.");
    if (body.visibility === "shared" && (!can(ctx.access, "shareStrategy") || !ctx.config.flags.community)) throw new Error("Sharing strategies isn't available yet.");
    patch.visibility = body.visibility;
  }
  store.updateCommunityStrategy(s.id, patch, at);
  if (body.rules !== undefined) store.addCommunityVersion(s.id, cleanRules(db, ctx, body.rules), at);
  store.audit({ at, userId: ctx.user.id, actor: "member", action: patch.visibility === "shared" ? "strategy_publication" : "strategy_change", object: `community ${s.id}`, result: "ok", detail: JSON.stringify(Object.keys(body)) });
  return store.getCommunityStrategy(s.id)!;
}

export function deleteStrategy(db: EngineDb, ctx: MemberContext, id: unknown, now = new Date()): void {
  const s = own(db, ctx, id);
  membersStore(db).deleteCommunityStrategy(s.id, now.toISOString());
  membersStore(db).audit({ at: now.toISOString(), userId: ctx.user.id, actor: "member", action: "strategy_deletion", object: `community ${s.id}`, result: "ok", detail: s.name });
}

/** The owner's view: rules, versions and both records. */
export function ownStrategyView(db: EngineDb, ctx: MemberContext, id: unknown) {
  const s = own(db, ctx, id);
  const versions = membersStore(db).listCommunityVersions(s.id);
  return { strategy: s, versions, record: strategyRecord(db, s, versions, ctx.config.commissionPct), followers: membersStore(db).followerCount(s.id) };
}

export function listOwnStrategies(db: EngineDb, ctx: MemberContext) {
  const store = membersStore(db);
  return store.listCommunityStrategies({ ownerId: ctx.user.id }).map((s) => ({ strategy: s, record: strategyRecord(db, s, store.listCommunityVersions(s.id), ctx.config.commissionPct) }));
}

/** Shared strategies for the community page: results only, never the rules (the creator's work). */
export function leaderboard(db: EngineDb, ctx: MemberContext) {
  if (!ctx.config.flags.community || !can(ctx.access, "viewCommunity")) return { enabled: false, rows: [] };
  const store = membersStore(db);
  const rows = store.listCommunityStrategies({ shared: true }).map((s) => {
    const { tracked } = strategyRecord(db, s, store.listCommunityVersions(s.id), ctx.config.commissionPct);
    const creator = db.getAppUserById(s.ownerId);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      creator: creator?.name?.split(" ")[0] || "Member",
      record: tracked,
      adjustedRoi: adjustedRoi(tracked.roi, tracked.bets),
      ranked: tracked.bets >= LEADERBOARD_MIN_BETS,
      followers: store.followerCount(s.id),
      verification: "System verified · Simulation",
    };
  });
  rows.sort((a, b) => Number(b.ranked) - Number(a.ranked) || (b.adjustedRoi ?? -1e9) - (a.adjustedRoi ?? -1e9));
  return { enabled: true, rows };
}
