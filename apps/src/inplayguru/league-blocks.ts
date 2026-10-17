/**
 * A strategy stopped in a league (Leagues → Profit, or Apply on the "stop it in this league" suggestion). The bet feed
 * doesn't bet its picks there; they're recorded in Sim instead, so the block can be judged and undone.
 * Kept free of other imports so the bet feed can read it without a circular import. Strategy keys are lower-case
 * strategy labels (strategyLabel(...).toLowerCase()).
 */
import type { EngineDb } from "../storage/engine-db";

const BLOCKS_KEY = "league_blocks";

/** Lower-case strategy -> league key -> the league's name and when it was stopped. */
export type LeagueBlocks = Record<string, Record<string, { league: string; at: string }>>;

export function getLeagueBlocks(db: EngineDb): LeagueBlocks {
  try {
    return JSON.parse(db.getSetting(BLOCKS_KEY) ?? "{}") as LeagueBlocks;
  } catch {
    return {};
  }
}

/** True when this strategy (its label, any case) is stopped in this league. */
export function isLeagueBlocked(blocks: LeagueBlocks, strategyKey: string, leagueKey: string): boolean {
  return !!blocks[strategyKey.toLowerCase()]?.[leagueKey];
}

/** Stops (or with `blocked` false, restarts) a strategy in a league. */
export function saveLeagueBlock(db: EngineDb, strategyKey: string, leagueKey: string, league: string, blocked: boolean, now = new Date()): void {
  const blocks = getLeagueBlocks(db);
  const s = strategyKey.toLowerCase();
  if (blocked) (blocks[s] ??= {})[leagueKey] = { league, at: now.toISOString() };
  else if (blocks[s]) {
    delete blocks[s]![leagueKey];
    if (Object.keys(blocks[s]!).length === 0) delete blocks[s];
  }
  db.setSetting(BLOCKS_KEY, JSON.stringify(blocks));
}
