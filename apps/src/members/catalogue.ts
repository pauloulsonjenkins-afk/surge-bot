/**
 * The house strategies as members see them, and the one place that decides how much of a pick a member is sent.
 *
 * IP protection is done HERE, on the engine: a view a member isn't allowed is never built, so it can't reach the
 * browser (no hiding in the page). The views are:
 *   - StrategyCard     every member: the name, in-play or pre-match. Nothing about how it works.
 *   - StrategyDetail   members whose access covers the strategy: description, rules in short, the bet.
 *   - PickFull         members whose access covers the strategy's selections: match, league, minute, score, market,
 *                      selection, price.
 * A pick a member can't see in full is only ever counted, never described.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { alertOddsOfPick, betableUntil, getSendingSettings, kickoffAt, strategyLabel } from "../inplayguru/bet-feed";
import { listStrategyNames } from "../inplayguru/strategy-names";
import type { MembersConfig } from "./config";

export const MARKET_LABEL: Record<string, string> = {
  NEXT_GOAL: "Next goal",
  BOTH_TEAMS_TO_SCORE: "Both teams to score",
  FIRST_HALF_CORNERS: "1st half corners",
  UNDERDOG_DOUBLE_CHANCE: "Underdog win or draw",
  FAVOURITE_TO_WIN: "Favourite to win",
  FAVOURITE_TO_SCORE: "Favourite to score",
  OVER_1_5: "Over 1.5 goals",
  FIRST_HALF_GOALS: "1st half goals (pre-match)",
};

export function marketName(market: string | null): string | null {
  return market ? (MARKET_LABEL[market] ?? market) : null;
}

/** The key members' strategies go by: InPlayGuru's name without its note, after the admin's merges, lower case. */
export function memberStrategyKey(merges: Record<string, string>, raw: string): string {
  const own = strategyLabel(raw);
  return (merges[own.toLowerCase()] ?? own).toLowerCase();
}

export interface CatalogueEntry {
  key: string;
  name: string;
  description: string;
  trigger: string;
  bet: string;
  type: "in-play" | "pre-match";
  liveApproved: boolean;
}

/** The strategies offered to members: named, published (all, unless the admin chose some) and not ignored. */
export function listCatalogue(db: EngineDb, config: MembersConfig): CatalogueEntry[] {
  const names = listStrategyNames(db);
  const ignored = db.getIgnoredStrategies();
  const seen = new Map(db.listStrategiesSeen().map((s) => [s.label.toLowerCase(), s.market]));
  const published = config.publishedStrategies.length ? new Set(config.publishedStrategies) : null;
  const live = new Set(config.liveApprovedStrategies);
  const out: CatalogueEntry[] = [];
  for (const [key, info] of Object.entries(names)) {
    if (key in ignored) continue;
    if (published && !published.has(key)) continue;
    // A strategy that never sent an alert has nothing to show yet.
    if (!seen.has(key)) continue;
    out.push({
      key,
      name: info.name,
      description: info.description,
      trigger: info.trigger,
      bet: info.bet,
      type: seen.get(key) === "FIRST_HALF_GOALS" ? "pre-match" : "in-play",
      liveApproved: live.has(key),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---- views ----------------------------------------------------------------------------------------------------

export interface StrategyCard {
  key: string;
  name: string;
  type: "in-play" | "pre-match";
}

export interface StrategyDetail extends StrategyCard {
  description: string;
  /** The rules in short. */
  trigger: string;
  bet: string;
  liveApproved: boolean;
}

export function toCard(c: CatalogueEntry): StrategyCard {
  return { key: c.key, name: c.name, type: c.type };
}

export function toDetail(c: CatalogueEntry): StrategyDetail {
  return { ...toCard(c), description: c.description, trigger: c.trigger, bet: c.bet, liveApproved: c.liveApproved };
}

/** A pick in full, for a member allowed its strategy's selections. */
export interface PickFull {
  id: number;
  strategyKey: string;
  strategyName: string;
  at: string;
  competition: string | null;
  home: string | null;
  away: string | null;
  minute: number | null;
  score: string | null;
  market: string | null;
  selection: string | null;
  /** The price recorded for the bet: the alert's own, else Betfair's when the alert arrived. */
  odds: number | null;
  /** live = still bettable now; waiting = bet window passed, no result yet; settled. */
  state: "live" | "waiting" | "settled" | "void";
  result: "hit" | "miss" | null;
  ftScore: string | null;
  /** Pre-match picks: estimated kick-off. */
  kickoffAt: string | null;
  /** Until when the pick can still be bet. */
  betableUntil: string;
}

export function pickPrice(p: LivePick): number | null {
  return alertOddsOfPick(p) ?? (p.exchangeOdds !== null && p.exchangeOdds > 1 ? p.exchangeOdds : null);
}

export function pickState(p: LivePick, now: Date, maxAgeMinutes: number): PickFull["state"] {
  if (p.excluded || p.waitingClearedAt) return "void";
  if (p.result) return "settled";
  return now.getTime() <= betableUntil(p, maxAgeMinutes) ? "live" : "waiting";
}

export function toPickFull(p: LivePick, key: string, name: string, now: Date, maxAgeMinutes: number): PickFull {
  const ko = kickoffAt(p);
  return {
    id: p.id,
    strategyKey: key,
    strategyName: name,
    at: p.messageAt ?? p.firstSeenAt,
    competition: p.competition,
    home: p.home,
    away: p.away,
    minute: p.minute,
    score: p.goalsHome !== null && p.goalsAway !== null ? `${p.goalsHome}-${p.goalsAway}` : null,
    market: marketName(p.market),
    selection: p.selection,
    odds: pickPrice(p),
    state: pickState(p, now, maxAgeMinutes),
    result: p.result,
    ftScore: p.ftScore,
    kickoffAt: ko === null ? null : new Date(ko).toISOString(),
    betableUntil: new Date(betableUntil(p, maxAgeMinutes)).toISOString(),
  };
}

/** The feed's age limit, for working out which picks can still be bet. */
export function maxAgeMinutes(db: EngineDb): number {
  return getSendingSettings(db).maxAgeMinutes;
}
