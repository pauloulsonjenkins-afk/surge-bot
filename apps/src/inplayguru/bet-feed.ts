/**
 * The bet feed: a small CSV, served at a private link, that the betting
 * software polls. Each row is one pick to back.
 *
 * SAFETY. This is the only place a pick can leave the app, so every gate is
 * here and every gate defaults to "closed":
 *   1. A master switch, OFF until you turn it on.
 *   2. A per-strategy switch, OFF until you turn each one on.
 *   3. The pick must be `sendable` (recognised strategy, complete, consistent
 *      with the alert's own odds line, not settled).
 *   4. The pick must be recent (default 10 minutes), so an old alert can't
 *      be sent late. "Recent" is measured from when Telegram says the alert
 *      was posted, not when this app received it, so an alert that arrives
 *      late (after a dropped connection or a restart) is never treated as new.
 *      Pre-match picks (First Half Goal) are the exception: they stay in the
 *      feed until a few minutes after kick-off (the alert's "Kickoff: In 1 hour"),
 *      because the betting software may place a pre-match bet nearer the start.
 *      A row that left the feed after 10 minutes was never placed (fixed 1 Oct 2026).
 *   5. A daily limit on how many NEW picks can be handed over.
 *   6. Only markets whose exact code is known are sent. Corners are not. The underdog strategy is
 *      sent as a Double Chance bet on the underdog (win or draw); "Pass Master 1st half" is sent as the favourite in
 *      Match Odds (until 1 Oct 2026; now the favourite to score again, see FAVOURITE_TO_SCORE below); "First Half Goal" is sent as Over 0.5 first-half goals. Their exchange wording is set on the Sending page.
 *   7. A stake must be set for the strategy, and it must not exceed the
 *      "highest stake allowed" ceiling. A strategy cannot be switched on
 *      without a stake.
 *   8. A per-strategy stop loss (see stop-loss.ts): once a strategy has lost
 *      its daily limit, or hit its losing run, no NEW picks for it are sent
 *      for the rest of the UK day.
 * A pick that fails any gate is simply left out and the reason is recorded so
 * the Sending page can show it.
 *
 * The feed says what to back and how much (the Size column). If a strategy has a
 * minimum odds set, the row also carries it in a MinPrice column, and the betting
 * software waits for the price to reach it before placing the bet. Loss caps and the
 * maximum liability stay in the betting software as the outer net.
 *
 * Once a pick has been handed over, its row is stored exactly as sent and every
 * later poll repeats that row unchanged. Changing a stake or a match-name fix
 * afterwards therefore can't make the betting software see a "new" tip for a
 * pick it already has, which could otherwise place a second bet.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { kickoffMinutes, leagueCountryFromText } from "./parse-alert";
import { accountToday, computeStopLoss } from "./stop-loss";
import { alertOddsOf } from "../server/pricing";
import { cleanPct, getBank, resolveStake } from "./stake";
import { getLeagueBlocks, isLeagueBlocked } from "./league-blocks";
import { segmentsOf, type AlertFacts } from "../server/segments";

export interface SendingSettings {
  /** Master switch. */
  enabled: boolean;
  /** Per-strategy switches, keyed by lower-case strategy name. Missing = off. */
  strategies: Record<string, boolean>;
  /**
   * A watched slice bet on its own (server/segments.ts), keyed "strategy key#slice id", e.g. Second Pour's Golden
   * alerts: Live or Sim regardless of the strategy's own switch, at its own stake (else the strategy's).
   */
  segmentBets: Record<string, SegmentBet>;
  /** Stake in pounds per strategy, keyed by lower-case strategy name. Missing (and no percentage) = cannot be sent. */
  stakes: Record<string, number>;
  /** Or a stake as a percentage of the Betfair balance (see stake.ts). A strategy has a flat stake or a percentage, not both. */
  stakePct: Record<string, number>;
  /** Minimum back odds per strategy, keyed by lower-case strategy name. Missing = no minimum. Sent as the MinPrice column. */
  minOdds: Record<string, number>;
  /** Lay strategies (Away Win Lay): the highest price to lay at, per strategy. Missing = no limit. */
  maxLayOdds: Record<string, number>;
  /** Hard ceiling. A stake above this is never sent, whatever is saved. */
  maxStake: number;
  /** Picks older than this are never sent. */
  maxAgeMinutes: number;
  /** Most NEW picks handed over per UK day. */
  dailyCap: number;
  /** Stop all NEW bets for the rest of the UK day once Live is down this much (£) across every strategy. 0 = off. */
  dailyLossLimit: number;
  /**
   * The stake ladder (server/strategy-advice.ts) applies its stake raises and cuts by itself, one step per strategy at
   * most every 7 days, with a notification for each. Off = suggestions only. Live / Sim changes always wait for the admin.
   */
  ladderAuto: boolean;
  /**
   * In-play picks from an alert after this minute are never bet (Live) nor recorded as Sim bets, whatever the strategy's
   * own rules say: a safety net for a rule mistake upstream (Sustained momentum fired at 93' on 14 Oct 2026). 0 = off.
   */
  latestMinute: number;
  /** Most money (£) staked in total on any one match, across strategies, so correlated bets (e.g. several Next goal strategies) can't stack. 0 = no limit. */
  matchCap: number;
  /** Market code and selection name used for Both Teams to Score. */
  bttsMarketType: string;
  bttsSelection: string;
  /** Underdog win or draw: the market code, and the selection wording when the underdog is the home / away side. {home} and {away} become the team names. */
  underdogMarketType: string;
  underdogHomeSelection: string;
  underdogAwaySelection: string;
  /** Favourite to win ("Pass Master 1st half", sent as Match Odds): the market code, and the selection wording when the favourite is the home / away side. {home} and {away} become the team names. */
  favouriteMarketType: string;
  favouriteHomeSelection: string;
  favouriteAwaySelection: string;
  /**
   * Favourite to score again ("Pass Master 1st half"): the market code for the favourite's own goals when the favourite is
   * the home / away side, and the selection. {line} becomes the line ("1.5") and {line10} ten times it, two digits ("15", "05" for 0.5). An empty
   * code = not sent yet (the code has to be confirmed from Betfair; see "Team goal markets on Betfair" on Reconcile).
   */
  favouriteScoresHomeMarketType: string;
  favouriteScoresAwayMarketType: string;
  favouriteScoresSelection: string;
  /** First-half goals ("First Half Goal", a pre-match alert): the market code and selection name for Over 0.5 first-half goals. */
  firstHalfGoalsMarketType: string;
  firstHalfGoalsSelection: string;
  /**
   * First-half corners ("First Half Corner Race": one more corner before half-time). Empty code = not sent yet.
   * {line} becomes the line ("5.5") and {line10} ten times it ("55"), in either field, as Betfair names its markets.
   */
  firstHalfCornersMarketType: string;
  firstHalfCornersSelection: string;
  /** One "alert name = exchange name" per line, applied to each team name. */
  aliases: string;
}

export interface SegmentBet {
  live: boolean;
  /** Its own stake: a percentage of the balance, or flat pounds (one or neither; neither = the strategy's stake). */
  stakePct: number | null;
  stake: number | null;
  /** When it was last switched Live (its own Live record, which the Golden safety check judges, counts from here). */
  liveSince: string | null;
}

export const DEFAULT_SENDING: SendingSettings = {
  enabled: false,
  strategies: {},
  segmentBets: {},
  stakes: {},
  stakePct: {},
  minOdds: {},
  maxLayOdds: {},
  maxStake: 5,
  maxAgeMinutes: 10,
  dailyCap: 30,
  matchCap: 0,
  dailyLossLimit: 0,
  ladderAuto: false,
  latestMinute: 88,
  bttsMarketType: "BOTH_TEAMS_TO_SCORE",
  bttsSelection: "Yes",
  underdogMarketType: "DOUBLE_CHANCE",
  underdogHomeSelection: "{home} or Draw",
  underdogAwaySelection: "Draw or {away}",
  favouriteMarketType: "MATCH_ODDS",
  favouriteHomeSelection: "{home}",
  favouriteAwaySelection: "{away}",
  favouriteScoresHomeMarketType: "",
  favouriteScoresAwayMarketType: "",
  favouriteScoresSelection: "Over {line} Goals",
  firstHalfGoalsMarketType: "FIRST_HALF_GOALS_05",
  firstHalfGoalsSelection: "Over 0.5 Goals",
  firstHalfCornersMarketType: "",
  firstHalfCornersSelection: "Over {line} Corners",
  aliases: "",
};

const SETTINGS_KEY = "sending";

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function cleanStake(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 && n <= 500 ? Math.round(n * 100) / 100 : null;
}

/** Lowest price Betfair allows; sent as MinPrice when a strategy has no minimum, which means "no limit". */
export const NO_MINIMUM_PRICE = 1.01;

function cleanMinOdds(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 1.01 && n <= 1000 ? Math.round(n * 100) / 100 : null;
}

/** Selection wording for the underdog bet. Letters, numbers, spaces and the {home} / {away} placeholders only. */
function cleanTemplate(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9_ {}]{1,80}$/.test(s) ? s : fallback;
}

/** A market code or selection that may hold {line} / {line10}, or (for the code) be empty to mean "not set". */
function cleanLineTemplate(v: unknown, fallback: string, allowEmpty: boolean): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "" && allowEmpty) return "";
  return /^[A-Za-z0-9_ .{}]{1,60}$/.test(s) ? s : fallback;
}

/** Selection name such as "Over 0.5 Goals": letters, numbers, spaces, underscores and full stops only. */
function cleanSelectionName(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9_ .]{1,60}$/.test(s) ? s : fallback;
}

function cleanCode(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9_ ]{1,60}$/.test(s) ? s : fallback;
}

/** Reads the saved settings, filling anything missing or invalid with the safe default. */
export function getSendingSettings(db: EngineDb): SendingSettings {
  let raw: Partial<SendingSettings> = {};
  try {
    const saved = db.getSetting(SETTINGS_KEY);
    if (saved) raw = JSON.parse(saved) as Partial<SendingSettings>;
  } catch {
    raw = {};
  }
  const strategies: Record<string, boolean> = {};
  if (raw.strategies && typeof raw.strategies === "object") {
    for (const [k, v] of Object.entries(raw.strategies)) strategies[k.toLowerCase()] = v === true;
  }
  const segmentBets: Record<string, SegmentBet> = {};
  if (raw.segmentBets && typeof raw.segmentBets === "object") {
    for (const [k, v] of Object.entries(raw.segmentBets)) {
      if (!v || typeof v !== "object") continue;
      const b = v as Partial<SegmentBet>;
      segmentBets[k.toLowerCase()] = { live: b.live === true, stakePct: cleanPct(b.stakePct), stake: cleanStake(b.stake), liveSince: b.live === true && typeof b.liveSince === "string" ? b.liveSince : null };
    }
  }
  const stakes: Record<string, number> = {};
  if (raw.stakes && typeof raw.stakes === "object") {
    for (const [k, v] of Object.entries(raw.stakes)) {
      const st = cleanStake(v);
      if (st !== null) stakes[k.toLowerCase()] = st;
    }
  }
  const stakePct: Record<string, number> = {};
  if (raw.stakePct && typeof raw.stakePct === "object") {
    for (const [k, v] of Object.entries(raw.stakePct)) {
      const p = cleanPct(v);
      if (p !== null && stakes[k.toLowerCase()] === undefined) stakePct[k.toLowerCase()] = p;
    }
  }
  const minOdds: Record<string, number> = {};
  if (raw.minOdds && typeof raw.minOdds === "object") {
    for (const [k, v] of Object.entries(raw.minOdds)) {
      const m = cleanMinOdds(v);
      if (m !== null) minOdds[k.toLowerCase()] = m;
    }
  }
  const maxLayOdds: Record<string, number> = {};
  if (raw.maxLayOdds && typeof raw.maxLayOdds === "object") {
    for (const [k, v] of Object.entries(raw.maxLayOdds)) {
      const m = cleanMinOdds(v);
      if (m !== null) maxLayOdds[k.toLowerCase()] = m;
    }
  }
  return {
    enabled: raw.enabled === true,
    strategies,
    segmentBets,
    stakes,
    stakePct,
    minOdds,
    maxLayOdds,
    maxStake: clampInt(raw.maxStake, 1, 500, DEFAULT_SENDING.maxStake),
    maxAgeMinutes: clampInt(raw.maxAgeMinutes, 1, 60, DEFAULT_SENDING.maxAgeMinutes),
    dailyCap: clampInt(raw.dailyCap, 0, 1000, DEFAULT_SENDING.dailyCap),
    matchCap: clampInt(raw.matchCap, 0, 5000, DEFAULT_SENDING.matchCap),
    dailyLossLimit: clampInt(raw.dailyLossLimit, 0, 100000, DEFAULT_SENDING.dailyLossLimit),
    ladderAuto: raw.ladderAuto === true,
    latestMinute: clampInt(raw.latestMinute, 0, 130, DEFAULT_SENDING.latestMinute),
    bttsMarketType: cleanCode(raw.bttsMarketType, DEFAULT_SENDING.bttsMarketType),
    bttsSelection: cleanCode(raw.bttsSelection, DEFAULT_SENDING.bttsSelection),
    underdogMarketType: cleanCode(raw.underdogMarketType, DEFAULT_SENDING.underdogMarketType),
    underdogHomeSelection: cleanTemplate(raw.underdogHomeSelection, DEFAULT_SENDING.underdogHomeSelection),
    underdogAwaySelection: cleanTemplate(raw.underdogAwaySelection, DEFAULT_SENDING.underdogAwaySelection),
    // "NEXT_GOAL" was an earlier guess for this strategy that isn't a real market, so it is never used.
    favouriteMarketType: raw.favouriteMarketType === "NEXT_GOAL" ? DEFAULT_SENDING.favouriteMarketType : cleanCode(raw.favouriteMarketType, DEFAULT_SENDING.favouriteMarketType),
    favouriteHomeSelection: cleanTemplate(raw.favouriteHomeSelection, DEFAULT_SENDING.favouriteHomeSelection),
    favouriteAwaySelection: cleanTemplate(raw.favouriteAwaySelection, DEFAULT_SENDING.favouriteAwaySelection),
    firstHalfGoalsMarketType: cleanCode(raw.firstHalfGoalsMarketType, DEFAULT_SENDING.firstHalfGoalsMarketType),
    firstHalfGoalsSelection: cleanSelectionName(raw.firstHalfGoalsSelection, DEFAULT_SENDING.firstHalfGoalsSelection),
    firstHalfCornersMarketType: cleanLineTemplate(raw.firstHalfCornersMarketType, DEFAULT_SENDING.firstHalfCornersMarketType, true),
    favouriteScoresHomeMarketType: cleanLineTemplate(raw.favouriteScoresHomeMarketType, DEFAULT_SENDING.favouriteScoresHomeMarketType, true),
    favouriteScoresAwayMarketType: cleanLineTemplate(raw.favouriteScoresAwayMarketType, DEFAULT_SENDING.favouriteScoresAwayMarketType, true),
    favouriteScoresSelection: cleanLineTemplate(raw.favouriteScoresSelection, DEFAULT_SENDING.favouriteScoresSelection, false),
    firstHalfCornersSelection: cleanLineTemplate(raw.firstHalfCornersSelection, DEFAULT_SENDING.firstHalfCornersSelection, false),
    aliases: typeof raw.aliases === "string" ? raw.aliases.slice(0, 5000) : "",
  };
}

/** The alert's facts a watched slice tests (server/segments.ts). */
export function pickFacts(p: LivePick): AlertFacts {
  return {
    goalsHome: p.goalsHome,
    goalsAway: p.goalsAway,
    stats: p.detail?.stats ?? {},
    preMatch1x2: p.detail?.odds?.preMatch1x2 ?? null,
    live1x2: p.detail?.odds?.live1x2 ?? null,
    minute: p.minute,
    country: leagueCountryFromText(p.rawText),
  };
}

/** The watched slices this pick is in (ids and labels), whatever their start date. */
export function pickSegments(p: LivePick): Array<{ id: string; label: string }> {
  const segs = segmentsOf(strategyLabel(p.strategy).toLowerCase());
  if (segs.length === 0) return [];
  const f = pickFacts(p);
  return segs.filter((s) => s.test(f)).map((s) => ({ id: s.id, label: s.label }));
}

/** The slice this pick is bet under, when that slice has its own betting set (Strategies: "Bet it separately"). */
export function segmentBetFor(settings: SendingSettings, p: LivePick): { key: string; id: string; label: string; cfg: SegmentBet } | null {
  const key = strategyLabel(p.strategy).toLowerCase();
  for (const s of pickSegments(p)) {
    const cfg = settings.segmentBets[`${key}#${s.id}`];
    if (cfg) return { key, id: s.id, label: s.label, cfg };
  }
  return null;
}

/** Settings with a slice's own stake in place of its strategy's, for resolveStake. */
export function withSegmentStake(settings: SendingSettings, key: string, cfg: SegmentBet): SendingSettings {
  if (cfg.stakePct !== null) {
    const stakes = { ...settings.stakes };
    delete stakes[key];
    return { ...settings, stakes, stakePct: { ...settings.stakePct, [key]: cfg.stakePct } };
  }
  if (cfg.stake !== null) {
    const stakePct = { ...settings.stakePct };
    delete stakePct[key];
    return { ...settings, stakePct, stakes: { ...settings.stakes, [key]: cfg.stake } };
  }
  return settings;
}

/** Applies a partial update from the admin page and saves the merged, validated result. */
export function saveSendingSettings(db: EngineDb, patch: Record<string, unknown>): SendingSettings {
  const current = getSendingSettings(db);
  const next: SendingSettings = { ...current, strategies: { ...current.strategies }, stakes: { ...current.stakes }, stakePct: { ...current.stakePct }, minOdds: { ...current.minOdds }, segmentBets: { ...current.segmentBets } };
  // A watched slice's own betting: { "strategy#slice": { live, stakePct, stake } }, or null to go back to the strategy's.
  if (patch.segmentBets && typeof patch.segmentBets === "object") {
    for (const [k, v] of Object.entries(patch.segmentBets as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (v === null) delete next.segmentBets[key];
      else if (typeof v === "object") {
        const b = v as Partial<SegmentBet>;
        const cur = next.segmentBets[key] ?? { live: false, stakePct: null, stake: null, liveSince: null };
        const pct = b.stakePct === undefined ? cur.stakePct : b.stakePct === null ? null : cleanPct(b.stakePct);
        const flat = b.stake === undefined ? cur.stake : b.stake === null ? null : cleanStake(b.stake);
        const live = typeof b.live === "boolean" ? b.live : cur.live;
        next.segmentBets[key] = { live, stakePct: pct, stake: pct !== null ? null : flat, liveSince: live ? (cur.live && cur.liveSince ? cur.liveSince : new Date().toISOString()) : null };
      }
    }
  }

  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.ladderAuto === "boolean") next.ladderAuto = patch.ladderAuto;
  if (patch.latestMinute !== undefined) next.latestMinute = clampInt(patch.latestMinute, 0, 130, current.latestMinute);
  // Stakes first, so a request can set a stake and switch the strategy on together.
  if (patch.stakes && typeof patch.stakes === "object") {
    for (const [k, v] of Object.entries(patch.stakes as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (v === null) delete next.stakes[key];
      else {
        const st = cleanStake(v);
        if (st !== null) {
          next.stakes[key] = st;
          delete next.stakePct[key]; // a flat stake replaces a percentage
        }
      }
    }
  }
  if (patch.stakePct && typeof patch.stakePct === "object") {
    for (const [k, v] of Object.entries(patch.stakePct as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (v === null) delete next.stakePct[key];
      else {
        const p = cleanPct(v);
        if (p !== null) {
          next.stakePct[key] = p;
          delete next.stakes[key]; // a percentage replaces a flat stake
        }
      }
    }
  }
  if (patch.minOdds && typeof patch.minOdds === "object") {
    for (const [k, v] of Object.entries(patch.minOdds as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (v === null) delete next.minOdds[key];
      else {
        const m = cleanMinOdds(v);
        if (m !== null) next.minOdds[key] = m;
      }
    }
  }
  if (patch.maxLayOdds && typeof patch.maxLayOdds === "object") {
    for (const [k, v] of Object.entries(patch.maxLayOdds as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (v === null) delete next.maxLayOdds[key];
      else {
        const m = cleanMinOdds(v);
        if (m !== null) next.maxLayOdds[key] = m;
      }
    }
  }
  if (patch.maxStake !== undefined) next.maxStake = clampInt(patch.maxStake, 1, 500, current.maxStake);
  if (patch.strategies && typeof patch.strategies === "object") {
    for (const [k, v] of Object.entries(patch.strategies as Record<string, unknown>)) {
      if (typeof v === "boolean") next.strategies[k.toLowerCase()] = v;
    }
  }
  if (patch.maxAgeMinutes !== undefined) next.maxAgeMinutes = clampInt(patch.maxAgeMinutes, 1, 60, current.maxAgeMinutes);
  if (patch.dailyCap !== undefined) next.dailyCap = clampInt(patch.dailyCap, 0, 1000, current.dailyCap);
  if (patch.matchCap !== undefined) next.matchCap = clampInt(patch.matchCap, 0, 5000, current.matchCap);
  if (patch.dailyLossLimit !== undefined) next.dailyLossLimit = clampInt(patch.dailyLossLimit, 0, 100000, current.dailyLossLimit);
  if (patch.bttsMarketType !== undefined) next.bttsMarketType = cleanCode(patch.bttsMarketType, current.bttsMarketType);
  if (patch.bttsSelection !== undefined) next.bttsSelection = cleanCode(patch.bttsSelection, current.bttsSelection);
  if (patch.underdogMarketType !== undefined) next.underdogMarketType = cleanCode(patch.underdogMarketType, current.underdogMarketType);
  if (patch.underdogHomeSelection !== undefined) next.underdogHomeSelection = cleanTemplate(patch.underdogHomeSelection, current.underdogHomeSelection);
  if (patch.underdogAwaySelection !== undefined) next.underdogAwaySelection = cleanTemplate(patch.underdogAwaySelection, current.underdogAwaySelection);
  if (patch.favouriteMarketType !== undefined) next.favouriteMarketType = cleanCode(patch.favouriteMarketType, current.favouriteMarketType);
  if (patch.favouriteHomeSelection !== undefined) next.favouriteHomeSelection = cleanTemplate(patch.favouriteHomeSelection, current.favouriteHomeSelection);
  if (patch.favouriteAwaySelection !== undefined) next.favouriteAwaySelection = cleanTemplate(patch.favouriteAwaySelection, current.favouriteAwaySelection);
  if (patch.firstHalfGoalsMarketType !== undefined) next.firstHalfGoalsMarketType = cleanCode(patch.firstHalfGoalsMarketType, current.firstHalfGoalsMarketType);
  if (patch.firstHalfGoalsSelection !== undefined) next.firstHalfGoalsSelection = cleanSelectionName(patch.firstHalfGoalsSelection, current.firstHalfGoalsSelection);
  if (patch.favouriteScoresHomeMarketType !== undefined) next.favouriteScoresHomeMarketType = cleanLineTemplate(patch.favouriteScoresHomeMarketType, current.favouriteScoresHomeMarketType, true);
  if (patch.favouriteScoresAwayMarketType !== undefined) next.favouriteScoresAwayMarketType = cleanLineTemplate(patch.favouriteScoresAwayMarketType, current.favouriteScoresAwayMarketType, true);
  if (patch.favouriteScoresSelection !== undefined) next.favouriteScoresSelection = cleanLineTemplate(patch.favouriteScoresSelection, current.favouriteScoresSelection, false);
  if (patch.firstHalfCornersMarketType !== undefined) next.firstHalfCornersMarketType = cleanLineTemplate(patch.firstHalfCornersMarketType, current.firstHalfCornersMarketType, true);
  if (patch.firstHalfCornersSelection !== undefined) next.firstHalfCornersSelection = cleanLineTemplate(patch.firstHalfCornersSelection, current.firstHalfCornersSelection, false);
  if (typeof patch.aliases === "string") next.aliases = patch.aliases.slice(0, 5000);

  // A strategy can't be on without a stake.
  for (const k of Object.keys(next.strategies)) {
    if (next.strategies[k] && next.stakes[k] === undefined && next.stakePct[k] === undefined) next.strategies[k] = false;
  }

  db.setSetting(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------------------

export interface FeedRow {
  pickId: number;
  provider: string;
  marketType: string;
  selectionName: string;
  eventName: string;
  /** BACK for every strategy, except LAY for Away Win Lay (placed only by GoalBrew's own direct betting). */
  betType: "BACK" | "LAY";
  /** Stake in pounds, sent in the Size column. For a LAY row it is the LIABILITY: the most the bet can lose. */
  stake: number;
  /** Minimum back odds for this pick, sent in the MinPrice column. Null = none set. */
  minPrice: number | null;
  /** LAY rows only: the highest price it may be laid at (the strategy's maximum lay price). Null = none set. */
  maxPrice?: number | null;
  /**
   * Bet by hand (Live: "Bet this for real", Edge: Bet): the admin chose this Sim pick. It still counts in its strategy's
   * Sim record, and is left out of the strategy's Live judgement (stake ladder, back to Sim); the money counts as usual.
   */
  byHand?: boolean;
}

export interface FeedSkip {
  pickId: number;
  strategy: string;
  match: string;
  reason: string;
}

export interface FeedResult {
  rows: FeedRow[];
  skipped: FeedSkip[];
  csv: string;
  /** Picks handed over for the first time in this call. */
  newlySent: number;
  /** Set when nothing can be sent for a global reason, e.g. the master switch is off. */
  blockedReason: string | null;
}

/** How long a new pick waits for its Betfair match check before it is sent anyway (see buildFeed). */
export const EXCHANGE_HOLD_MS = 45_000;

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

/** "Both Teams to Score (Favorite conceded first)" -> "Both Teams to Score". */
export function strategyLabel(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || raw;
}

/** Providers must not contain commas or quotes, or they break the file. */
function providerName(raw: string): string {
  return strategyLabel(raw).replace(/[",\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Adds (or replaces) one "alert name = exchange name" line in the Sending page's Match names, e.g. from a bet on the
 * Reconcile page whose team Betfair spells differently. Returns the line saved. Throws if either name can't be a line.
 */
export function addMatchName(db: EngineDb, alertName: unknown, exchangeName: unknown): string {
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const from = clean(alertName);
  const to = clean(exchangeName);
  if (!from || !to || from.length > 80 || to.length > 80 || /[=\r\n]/.test(from + to)) throw new Error("Both names are needed, without = signs.");
  if (from.toLowerCase() === to.toLowerCase()) throw new Error("The two names are the same.");
  const line = `${from} = ${to}`;
  const kept = getSendingSettings(db)
    .aliases.split("\n")
    .filter((l) => {
      const i = l.indexOf("=");
      return l.trim() !== "" && !(i > 0 && l.slice(0, i).trim().toLowerCase() === from.toLowerCase());
    });
  const next = [...kept, line].join("\n");
  if (next.length > 5000) throw new Error("Match names is full (5,000 characters). Tidy it under Betting → Limits → Match names first.");
  saveSendingSettings(db, { aliases: next });
  return line;
}

/** A team name as the exchange writes it, using the Sending page's "alert name = exchange name" lines. */
export function exchangeNamer(db: EngineDb): (name: string) => string {
  const aliases = parseAliases(getSendingSettings(db).aliases);
  return (name) => aliases.get(name.trim().toLowerCase()) ?? name.trim();
}

function parseAliases(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    const from = line.slice(0, i).trim().toLowerCase();
    const to = line.slice(i + 1).trim();
    if (from && to) map.set(from, to);
  }
  return map;
}

/** One quoted CSV field. Quotes are dropped and line breaks become spaces, so no value can break a row in two. */
function csvField(v: string): string {
  return `"${v.replace(/"/g, "").replace(/[\r\n]+/g, " ")}"`;
}

/**
 * The file the betting software reads. The MinPrice column is only added once at least one strategy has a
 * minimum odds set, so until you use the feature the file is exactly what it was before. From then on every
 * row carries it, with 1.01 (the lowest Betfair price, i.e. no limit) for strategies without a minimum.
 */
export function toCsv(rows: FeedRow[], includeMinPrice = false): string {
  const cols = ["Provider", "MarketType", "SelectionName", "EventName", "BetType", "Size", ...(includeMinPrice ? ["MinPrice"] : [])];
  const header = cols.map(csvField).join(",");
  const lines = rows.map((r) =>
    [
      r.provider,
      r.marketType,
      r.selectionName,
      r.eventName,
      r.betType,
      r.stake.toFixed(2),
      ...(includeMinPrice ? [(r.minPrice ?? NO_MINIMUM_PRICE).toFixed(2)] : []),
    ]
      .map(csvField)
      .join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** Over/Under goals market code for a line: 1.5 -> OVER_UNDER_15. Null for anything that isn't a clean x.5 line. */
export function overUnderMarket(line: number | null | undefined): { marketType: string; selectionName: string } | null {
  if (line === null || line === undefined || !Number.isFinite(line)) return null;
  if (line < 0.5 || line > 9.5 || Math.round(line * 2) !== line * 2 || line % 1 !== 0.5) return null;
  return { marketType: `OVER_UNDER_${String(Math.round(line * 10)).padStart(2, "0")}`, selectionName: `Over ${line} Goals` };
}

/**
 * The exchange market code and selection a pick is sent as, or why it can't be sent. Shared by the bet feed and the
 * Betfair price lookup (betfair/exchange.ts), so the price read is for exactly the bet that would be placed.
 */
export function feedMarket(p: LivePick, settings: SendingSettings, alias: (name: string) => string): { marketType: string; selectionName: string } | { error: string } {
  if (p.market === "NO_MORE_GOALS") {
    const m = overUnderMarket(p.detail?.targetLine ?? null);
    return m ? { marketType: m.marketType, selectionName: m.selectionName.replace(/^Over /, "Under ") } : { error: "Could not work out the Over/Under line." };
  }
  if (p.market === "NEXT_GOAL" || p.market === "OVER_1_5" || p.market === "TWO_MORE_GOALS") {
    return overUnderMarket(p.detail?.targetLine ?? null) ?? { error: "Could not work out the Over/Under line." };
  }
  if (p.market === "BOTH_TEAMS_TO_SCORE") return { marketType: settings.bttsMarketType, selectionName: settings.bttsSelection };
  if (p.market === "FIRST_HALF_GOALS") return { marketType: settings.firstHalfGoalsMarketType, selectionName: settings.firstHalfGoalsSelection };
  if (p.market === "FAVOURITE_TO_SCORE") {
    const side = p.detail?.favourite ?? null;
    if (side === null) return { error: "Could not tell which side is the favourite." };
    const code = side === "home" ? settings.favouriteScoresHomeMarketType : settings.favouriteScoresAwayMarketType;
    if (!code) return { error: "Set the favourite-to-score market codes under Betting → Limits → Bet wording first." };
    const line = p.detail?.targetLine ?? null;
    if (line === null) return { error: "Could not work out the favourite's goal line." };
    const fill = (t: string) => t.replace(/\{line\}/g, line.toFixed(1)).replace(/\{line10\}/g, String(Math.round(line * 10)).padStart(2, "0"));
    return { marketType: fill(code), selectionName: fill(settings.favouriteScoresSelection) };
  }
  if (p.market === "FIRST_HALF_CORNERS") {
    if (!settings.firstHalfCornersMarketType) return { error: "Set the first-half corners market code under Betting → Limits → Bet wording first." };
    const line = p.detail?.targetLine ?? null;
    if (line === null) return { error: "Could not work out the corner line." };
    const fill = (t: string) => t.replace(/\{line\}/g, line.toFixed(1)).replace(/\{line10\}/g, String(Math.round(line * 10)).padStart(2, "0"));
    return { marketType: fill(settings.firstHalfCornersMarketType), selectionName: fill(settings.firstHalfCornersSelection) };
  }
  if (p.market === "HOME_TO_WIN") {
    return { marketType: settings.favouriteMarketType, selectionName: settings.favouriteHomeSelection.replace(/\{home\}/g, alias(p.home ?? "")).replace(/\{away\}/g, alias(p.away ?? "")) };
  }
  if (p.market === "FAVOURITE_TO_WIN" || p.market === "UNDERDOG_DOUBLE_CHANCE") {
    const favourite = p.market === "FAVOURITE_TO_WIN";
    const side = favourite ? (p.detail?.favourite ?? null) : (p.detail?.underdog ?? null);
    if (side === null) return { error: favourite ? "Could not tell which side is the favourite." : "Could not tell which side is the underdog." };
    const template = favourite
      ? side === "home" ? settings.favouriteHomeSelection : settings.favouriteAwaySelection
      : side === "home" ? settings.underdogHomeSelection : settings.underdogAwaySelection;
    return {
      marketType: favourite ? settings.favouriteMarketType : settings.underdogMarketType,
      selectionName: template.replace(/\{home\}/g, alias(p.home ?? "")).replace(/\{away\}/g, alias(p.away ?? "")),
    };
  }
  if (p.market === "AWAY_WIN_LAY") {
    // Laid in Match Odds. Betfair's runner is the away team as Betfair names it: taken from Betfair's own event name
    // ("Raith v Queens Park") when the match was found there, otherwise the alert's name (with Match names).
    const fromEvent = p.exchange === "on" && p.exchangeEvent ? p.exchangeEvent.split(/ v /i)[1]?.trim() : null;
    const away = fromEvent || alias(p.away ?? "");
    if (!away) return { error: "Could not read the away team." };
    return { marketType: "MATCH_ODDS", selectionName: away };
  }
  if (p.market === "EDGE_VALUE") {
    // Best Value Cuppa (edge/value-strategy.ts): each pick carries its own Betfair market code and selection, as read
    // when its price was checked, so the bet sent is exactly the one priced.
    const e = (p.detail as { edge?: { marketType?: string; selectionName?: string } } | null)?.edge;
    if (!e?.marketType || !e.selectionName) return { error: "This pick has no Betfair market stored." };
    return { marketType: e.marketType, selectionName: e.selectionName };
  }
  return { error: "This market can't be sent yet." };
}

/**
 * Works out which picks go in the feed right now. With markSent = true (the
 * real feed) newly included picks are stamped as sent; with false (the admin
 * preview) nothing is changed.
 */
export function buildFeed(db: EngineDb, opts: { markSent: boolean; now?: Date; holdForExchangeMs?: number; direct?: boolean }): FeedResult {
  const now = opts.now ?? new Date();
  const settings = getSendingSettings(db);
  const bank = getBank(db);
  const empty = (blockedReason: string | null): FeedResult => ({
    rows: [],
    skipped: [],
    csv: toCsv([], Object.keys(settings.minOdds).length > 0),
    newlySent: 0,
    blockedReason,
  });

  const recent = db
    .listLivePicks(200)
    .filter((p) => now.getTime() <= betableUntil(p, settings.maxAgeMinutes))
    .sort((a, b) => a.id - b.id);

  if (!settings.enabled) {
    const r = empty("Betting is switched off.");
    r.skipped = recent.filter((p) => p.status !== "settled").map((p) => skip(p, "Betting is switched off."));
    return r;
  }

  const aliases = parseAliases(settings.aliases);
  const alias = (name: string) => aliases.get(name.trim().toLowerCase()) ?? name.trim();

  const today = ukDay.format(now);
  const stops = computeStopLoss(db, now);
  const noSend = db.noSendLeagues();
  const blocks = getLeagueBlocks(db);
  let sentToday = db.recentSentTimes().filter((t) => ukDay.format(new Date(t)) === today).length;

  const rows: FeedRow[] = [];
  const skipped: FeedSkip[] = [];
  const toMark: Array<{ id: number; rowJson: string }> = [];

  // The whole-account daily loss stop: once Live is down the limit today, no NEW picks go out (ones already handed over
  // are repeated as before). Worked out once per feed build.
  const lossStop = settings.dailyLossLimit > 0 ? dailyLossStopReason(db, settings.dailyLossLimit, now) : null;

  // Money already out on each match (picks handed over earlier), so a new pick can be held back by the match limit.
  const onMatch = new Map<string, number>();
  const matchOf = (p: LivePick) => `${p.leagueKey}|${(p.home ?? "").toLowerCase()}|${(p.away ?? "").toLowerCase()}`;
  if (settings.matchCap > 0) {
    for (const p of recent) {
      if (p.sentAt === null || p.excluded) continue;
      const frozen = parseFrozenRow(p);
      if (frozen) onMatch.set(matchOf(p), (onMatch.get(matchOf(p)) ?? 0) + frozen.stake);
    }
  }

  for (const p of recent) {
    const label = strategyLabel(p.strategy);

    // Finished matches are left out quietly; listing them would only add noise.
    if (p.status === "settled") continue;
    // "Didn't actually bet" picks are never (re)sent, settled or not.
    if (p.excluded) continue;

    // A pick already handed over is repeated exactly as sent until it ages out, whatever the
    // switches say now. Otherwise turning a strategy off and on again could make its row vanish
    // and reappear, which betting software may read as a second tip.
    if (p.sentAt !== null) {
      // Handed to direct betting in Live (betfair/direct.ts), not to the betting software: never in the feed, even after
      // Live is switched off, or the betting software would place a pick GoalBrew already bet.
      if (db.getDirectBet(p.id)?.mode === "live") continue;
      const frozen = parseFrozenRow(p);
      if (frozen) {
        rows.push(frozen);
        continue;
      }
    }

    // A watched slice with its own betting (e.g. Second Pour's Golden alerts) is Live or Sim by its own switch.
    const seg = segmentBetFor(settings, p);
    if (seg ? !seg.cfg.live : !settings.strategies[label.toLowerCase()]) {
      skipped.push(skip(p, seg ? `${seg.label} alerts are in Sim (Strategies).` : "This strategy's switch is off."));
      continue;
    }
    // A league whose matches aren't on Betfair (marked on the Leagues page) is recorded but never sent.
    if (noSend.has(p.leagueKey)) {
      skipped.push(skip(p, "This league is marked as not on Betfair (Leagues page)."));
      continue;
    }
    // This strategy is stopped in this league (Leagues page, Profit): recorded in Sim instead (recordSimBets).
    if (isLeagueBlocked(blocks, label, p.leagueKey)) {
      skipped.push(skip(p, "This strategy is stopped in this league (Leagues → Profit): recorded in Sim."));
      continue;
    }
    if (!p.sendable) {
      skipped.push(skip(p, p.flags[0] ?? "Not sendable."));
      continue;
    }
    if (tooLate(p, settings)) {
      skipped.push(skip(p, `Alert at ${p.minute}', after the latest minute bet (${settings.latestMinute}').`));
      continue;
    }
    if (!p.home || !p.away) {
      skipped.push(skip(p, "Team names missing."));
      continue;
    }

    const alreadySent = p.sentAt !== null;

    // A new pick waits (briefly) for its Betfair match check, so it goes out under Betfair's own event name: the
    // betting software finds the match by that name, and a team spelt differently means no bet. The row is frozen
    // once sent, so it can't be corrected later. Past the wait it goes anyway, under the alert's names.
    const hold = opts.holdForExchangeMs ?? 0;
    if (!alreadySent && hold > 0 && p.exchange === null && now.getTime() - alertTime(p) < hold) {
      skipped.push(skip(p, "Finding the match on Betfair (a few seconds)."));
      continue;
    }
    // Not on Betfair: the betting software can't find it either, so it isn't sent (and doesn't use up the daily limit).
    if (!alreadySent && p.exchange === "off") {
      skipped.push(skip(p, "Not on Betfair: the match wasn't found there."));
      continue;
    }

    if (!alreadySent && lossStop) {
      skipped.push(skip(p, lossStop));
      continue;
    }

    // Stop loss: no NEW picks once a strategy has hit its limit today. Rows already handed over
    // are repeated above and are never affected.
    if (!alreadySent) {
      const stop = stops.get(label.toLowerCase());
      if (stop?.stopped) {
        skipped.push(skip(p, `Stopped: ${stop.reason}`));
        continue;
      }
    }

    const market = feedMarket(p, settings, alias);
    if ("error" in market) {
      skipped.push(skip(p, market.error));
      continue;
    }
    // A lay is only ever placed by GoalBrew's own direct betting, never handed to other betting software.
    const lay = p.market === "AWAY_WIN_LAY";
    if (lay && !opts.direct) {
      skipped.push(skip(p, "Lay bets are placed only by GoalBrew's direct betting (Betting → Limits, Live)."));
      continue;
    }

    // A flat stake, or a percentage of the Betfair balance turned into pounds now (kept with the row, so it never changes).
    const staked = resolveStake(seg ? withSegmentStake(settings, label.toLowerCase(), seg.cfg) : settings, label.toLowerCase(), bank, { now, live: true });
    if (staked.stake === null) {
      skipped.push(skip(p, staked.reason ?? "No stake set for this strategy."));
      continue;
    }
    const stake = staked.stake;
    // Betfair's price below the strategy's minimum odds: the betting software would turn it down. Held, and the price
    // is read again each Betfair poll (betfair/exchange.ts repriceHeld); it goes out once the price reaches the minimum.
    const minPrice = lay ? null : (settings.minOdds[label.toLowerCase()] ?? null);
    // A lay waits while the price is above the strategy's maximum lay price (laying high risks a lot to win a little).
    const maxPrice = lay ? (settings.maxLayOdds[label.toLowerCase()] ?? null) : null;
    if (!alreadySent && maxPrice !== null && p.exchangeOdds !== null && p.exchangeOdds > maxPrice) {
      skipped.push(skip(p, `Betfair price ${p.exchangeOdds.toFixed(2)} is above the maximum lay price ${maxPrice.toFixed(2)}: waiting for it to fall.`));
      continue;
    }
    if (!alreadySent && minPrice !== null && p.exchangeOdds !== null && p.exchangeOdds < minPrice) {
      skipped.push(skip(p, `Betfair price ${p.exchangeOdds.toFixed(2)} is below the minimum odds ${minPrice.toFixed(2)}: waiting for it to rise.`));
      continue;
    }
    if (stake > settings.maxStake) {
      skipped.push(skip(p, `Stake £${stake.toFixed(2)} is above the highest allowed (£${settings.maxStake}).`));
      continue;
    }

    if (!alreadySent) {
      if (sentToday >= settings.dailyCap) {
        skipped.push(skip(p, "Daily limit reached."));
        continue;
      }
      if (settings.matchCap > 0) {
        const out = onMatch.get(matchOf(p)) ?? 0;
        if (out + stake > settings.matchCap) {
          skipped.push(skip(p, `Match limit: £${out.toFixed(2)} is already on this match and the limit is £${settings.matchCap}.`));
          continue;
        }
        onMatch.set(matchOf(p), out + stake);
      }
      sentToday++;
    }

    const row: FeedRow = {
      pickId: p.id,
      provider: providerName(p.strategy),
      marketType: market.marketType,
      selectionName: market.selectionName,
      // Betfair's exact event name when both teams were found there; otherwise the alert's names (with Match names).
      eventName: p.exchange === "on" && p.exchangeEvent ? p.exchangeEvent : `${alias(p.home)} v ${alias(p.away)}`,
      betType: lay ? "LAY" : "BACK",
      stake,
      minPrice,
      ...(lay ? { maxPrice } : {}),
    };
    rows.push(row);
    if (!alreadySent) toMark.push({ id: p.id, rowJson: JSON.stringify(row) });
  }

  if (opts.markSent) db.markSent(toMark);

  return { rows, skipped, csv: toCsv(rows, Object.keys(settings.minOdds).length > 0), newlySent: toMark.length, blockedReason: null };
}

/**
 * Live tab, "Bet this for real": hands one Sim pick to GoalBrew's direct betting now, at its strategy's stake (£1 if
 * it has none). The same safety checks as any Live bet: fresh enough to bet, on Betfair, the latest minute, the daily
 * loss stop, the highest stake and the match limit. Its minimum odds still apply (direct betting waits for the price).
 * The pick then counts as a Live bet; its Sim record is dropped. Throws, with the reason, when it can't be bet.
 */
export function betPickNow(db: EngineDb, pickId: number, deps: { directLive: boolean }, now = new Date()): FeedRow {
  const p = db.getLivePick(pickId);
  if (!p || p.excluded) throw new Error("That pick was removed.");
  if (p.sentAt) throw new Error("That pick has already been handed to betting.");
  if (p.status === "settled" || p.result) throw new Error("That pick has already settled.");
  if (!deps.directLive) throw new Error("GoalBrew's direct betting isn't Live (Betting → Limits), so it can't place bets.");
  const settings = getSendingSettings(db);
  if (now.getTime() > betableUntil(p, settings.maxAgeMinutes))
    throw new Error(`Too late: alerts are only bet within ${settings.maxAgeMinutes} minutes (pre-match picks until kick-off).`);
  if (tooLate(p, settings)) throw new Error(`The alert was at ${p.minute}', after your latest minute to bet (${settings.latestMinute}').`);
  if (!p.home || !p.away) throw new Error("The alert has no team names.");
  if (p.exchange === "off") throw new Error("The match wasn't found on Betfair.");
  if (settings.dailyLossLimit > 0) {
    const stop = dailyLossStopReason(db, settings.dailyLossLimit, now);
    if (stop) throw new Error(stop);
  }
  const aliases = parseAliases(settings.aliases);
  const alias = (name: string) => aliases.get(name.trim().toLowerCase()) ?? name.trim();
  const market = feedMarket(p, settings, alias);
  if ("error" in market) throw new Error(market.error);
  const key = strategyLabel(p.strategy).toLowerCase();
  const lay = p.market === "AWAY_WIN_LAY";
  const staked = resolveStake(settings, key, getBank(db), { now, live: true });
  const stake = staked.stake ?? 1;
  if (stake > settings.maxStake) throw new Error(`Its stake £${stake.toFixed(2)} is above your highest stake allowed (£${settings.maxStake}).`);
  if (settings.matchCap > 0) {
    const same = (x: LivePick) => x.leagueKey === p.leagueKey && (x.home ?? "").toLowerCase() === p.home!.toLowerCase() && (x.away ?? "").toLowerCase() === p.away!.toLowerCase();
    const out = db.listLivePicks(300).filter((x) => x.sentAt && !x.excluded && same(x)).reduce((t, x) => t + (parseFrozenRow(x)?.stake ?? 0), 0);
    if (out + stake > settings.matchCap) throw new Error(`Match limit: £${out.toFixed(2)} is already on this match and the limit is £${settings.matchCap}.`);
  }
  const row: FeedRow = {
    pickId: p.id,
    provider: providerName(p.strategy),
    marketType: market.marketType,
    selectionName: market.selectionName,
    eventName: p.exchange === "on" && p.exchangeEvent ? p.exchangeEvent : `${alias(p.home)} v ${alias(p.away)}`,
    betType: lay ? "LAY" : "BACK",
    stake,
    minPrice: lay ? null : (settings.minOdds[key] ?? null),
    ...(lay ? { maxPrice: settings.maxLayOdds[key] ?? null } : {}),
    byHand: true,
  };
  // Its Sim bet first (if not recorded yet), so it stays in the strategy's Sim record.
  recordSimBets(db, now);
  db.markSent([{ id: p.id, rowJson: JSON.stringify(row) }]);
  return row;
}

// ---------------------------------------------------------------------------
// Simulation

const SIM_SINCE_KEY = "sim_recording_since";

/** The price the alert printed for the bet it describes, read from the parsed alert (see alertOddsOf). */
export function alertOddsOfPick(p: LivePick): number | null {
  const d = p.detail;
  if (!d) return null;
  const live = d.odds?.live1x2 ?? null;
  // Underdog win or draw: the alert's own price, from its live 1X2 (1 / (1/underdog + 1/draw)). These alerts fire just
  // after the underdog goes ahead, when the real price is often 1.01-1.10 while a delayed Betfair price still shows the
  // pre-goal 1.3-1.5 (16 Oct 2026: 10 of 12 such bets went unmatched). With this, direct betting waits instead of asking a
  // phantom price, and the minimum odds hold the near-certainties back in Live and Sim alike.
  if (p.market === "UNDERDOG_DOUBLE_CHANCE") {
    if (!live || !d.underdog || live.some((x) => !(x > 1))) return null;
    const win = d.underdog === "home" ? live[0] : live[2];
    return Math.round((1 / (1 / win + 1 / live[1])) * 100) / 100;
  }
  const favouriteOdds = d.favourite && live ? (d.favourite === "home" ? live[0] : live[2]) : null;
  return alertOddsOf({
    market: p.market,
    targetLine: d.targetLine ?? null,
    overLine: d.odds?.overUnderLine ?? null,
    overOdds: d.odds?.over ?? null,
    favouriteOdds: typeof favouriteOdds === "number" ? favouriteOdds : null,
    layOdds: p.market === "AWAY_WIN_LAY" ? (d.odds?.preMatch1x2?.[2] ?? null) : null,
  });
}

/**
 * Records a simulated bet on every new pick that isn't being sent, as the bet it would have been if its
 * strategy were Live. It is stored on the pick (never sent anywhere), and Sim profit is then worked out from it,
 * so a Sim strategy is judged by the same rules as a Live one:
 *   - the stake set for the strategy at the time (changing it later doesn't rewrite the past),
 *   - the minimum odds: a pick whose alert price is below the minimum wouldn't have been matched,
 *   - the per-strategy stop loss, run on the strategy's own simulated results,
 *   - the daily limit, counting live and simulated bets together,
 *   - the age limit: an alert that arrived too late wouldn't have been sent.
 * Unlike the real feed it doesn't need the market to be one the exchange feed can name, so strategies that
 * can't be sent yet (such as corners) can still be tried out in Sim.
 *
 * A pick of a Live strategy is left to the bet feed while it can still be sent. If it ages out without being
 * sent (stop loss, daily limit, the feed wasn't read...), it is recorded here as not placed.
 * Returns how many picks were recorded.
 */
/** An in-play alert later than the latest minute allowed (Sending: latestMinute). Pre-match picks have no minute. */
export function tooLate(p: Pick<LivePick, "minute">, settings: Pick<SendingSettings, "latestMinute">): boolean {
  return settings.latestMinute > 0 && p.minute !== null && p.minute > settings.latestMinute;
}

export function recordSimBets(db: EngineDb, now = new Date()): number {
  // Only picks that arrive after recording first started: older ones keep being priced at the strategy's
  // stake, rather than being judged now as if they had arrived late.
  let since = db.getSetting(SIM_SINCE_KEY);
  if (!since) {
    since = now.toISOString();
    db.setSetting(SIM_SINCE_KEY, since);
  }
  const window = new Date(now.getTime() - 36 * 3_600_000).toISOString();
  const candidates = db.listSimCandidates(since > window ? since : window).sort((a, b) => a.id - b.id);
  if (candidates.length === 0) return 0;

  const settings = getSendingSettings(db);
  const bank = getBank(db);
  const today = ukDay.format(now);
  const stops = computeStopLoss(db, now, "sim");
  const noSend = db.noSendLeagues();
  const blocks = getLeagueBlocks(db);
  let betsToday = [...db.recentSentTimes(), ...db.recentSimBetTimes()].filter((t) => ukDay.format(new Date(t)) === today).length;

  const items: Array<{ id: number; rowJson: string }> = [];
  for (const p of candidates) {
    const key = strategyLabel(p.strategy).toLowerCase();
    const fresh = now.getTime() <= betableUntil(p, settings.maxAgeMinutes);
    // Stopped in this league: never bet there, so it's simulated like a Sim strategy's pick.
    const seg = segmentBetFor(settings, p);
    const liveNow = settings.enabled && (seg ? seg.cfg.live : settings.strategies[key] === true) && !isLeagueBlocked(blocks, key, p.leagueKey);
    if (liveNow && fresh) continue; // the bet feed decides this one

    const staked = resolveStake(seg ? withSegmentStake(settings, key, seg.cfg) : settings, key, bank, { now, live: false });
    const stake = staked.stake;
    const minPrice = settings.minOdds[key] ?? null;
    const odds = alertOddsOfPick(p);
    let skipped: string | null = null;
    if (noSend.has(p.leagueKey)) skipped = "This league is marked as not on Betfair.";
    else if (liveNow) skipped = "Not sent by the bet feed in time.";
    else if (!fresh) skipped = "The alert arrived too late to bet.";
    else if (tooLate(p, settings)) skipped = `Alert at ${p.minute}', after the latest minute bet (${settings.latestMinute}').`;
    else if (stake === null) skipped = staked.reason ?? "No stake set for this strategy.";
    else if (stake > settings.maxStake) skipped = `Stake £${stake.toFixed(2)} is above the highest allowed (£${settings.maxStake}).`;
    else if (p.market !== "AWAY_WIN_LAY" && minPrice !== null && odds !== null && odds < minPrice) skipped = `Odds ${odds.toFixed(2)} were below the minimum ${minPrice.toFixed(2)}.`;
    else if (p.market === "AWAY_WIN_LAY" && settings.maxLayOdds[key] !== undefined && (p.detail?.odds?.preMatch1x2?.[2] ?? 0) > settings.maxLayOdds[key]!)
      skipped = `The away price ${p.detail!.odds.preMatch1x2![2].toFixed(2)} was above the maximum lay price ${settings.maxLayOdds[key]!.toFixed(2)}.`;
    else if (stops.get(key)?.stopped) skipped = `Stopped: ${stops.get(key)!.reason}`;
    else if (betsToday >= settings.dailyCap) skipped = "Daily limit reached.";

    if (skipped === null) betsToday++;
    items.push({ id: p.id, rowJson: JSON.stringify({ stake: skipped === null ? stake : null, minPrice, skipped }) });
  }
  db.setSimRows(items, now.toISOString());
  return items.length;
}

/** A pre-match pick's estimated kick-off (alert time + "Kickoff: In 1 hour"; an hour if the wording isn't known), else null. */
export function kickoffAt(p: LivePick): number | null {
  // Best Value Cuppa picks know their real kick-off.
  if (p.market === "EDGE_VALUE") {
    const ko = Date.parse((p.detail as { edge?: { kickoff?: string } } | null)?.edge?.kickoff ?? "");
    return Number.isFinite(ko) ? ko : null;
  }
  if (p.market !== "FIRST_HALF_GOALS" && p.market !== "AWAY_WIN_LAY") return null;
  return alertTime(p) + (kickoffMinutes(p.detail?.kickoffRaw) ?? 60) * 60_000;
}

/** Minutes after the estimated kick-off a pre-match pick stays in the feed ("In 1 hour" is rounded). */
const AFTER_KICKOFF_MIN = 5;

/**
 * Until when a pick may be in the feed: the alert time + the maximum age for an in-play pick, or for a pre-match pick
 * until shortly after kick-off, since the betting software may place it any time before the start.
 */
export function betableUntil(p: LivePick, maxAgeMinutes: number): number {
  const ko = kickoffAt(p);
  return ko !== null ? ko + AFTER_KICKOFF_MIN * 60_000 : alertTime(p) + maxAgeMinutes * 60_000;
}

/** When the alert was posted: Telegram's time if known, otherwise when it was received. */
function alertTime(p: LivePick): number {
  const posted = p.messageAt ? Date.parse(p.messageAt) : NaN;
  return Number.isFinite(posted) ? posted : Date.parse(p.firstSeenAt);
}

function parseFrozenRow(p: LivePick): FeedRow | null {
  if (!p.sentRowJson) return null;
  try {
    const r = JSON.parse(p.sentRowJson) as Partial<FeedRow>;
    if (
      typeof r.provider === "string" &&
      typeof r.marketType === "string" &&
      typeof r.selectionName === "string" &&
      typeof r.eventName === "string" &&
      typeof r.stake === "number"
    ) {
      const minPrice = typeof r.minPrice === "number" && Number.isFinite(r.minPrice) ? r.minPrice : null;
      return { pickId: p.id, provider: r.provider, marketType: r.marketType, selectionName: r.selectionName, eventName: r.eventName, betType: "BACK", stake: r.stake, minPrice };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Why the whole-account daily loss stop is on today, or null when it isn't. */
export function dailyLossStopReason(db: EngineDb, limit: number, now = new Date()): string | null {
  if (limit <= 0) return null;
  const { net } = accountToday(db, now, "live");
  return net <= -limit ? `Daily loss stop: Live is down £${Math.abs(net).toFixed(2)} today (limit £${limit}). No new bets until tomorrow.` : null;
}

function skip(p: LivePick, reason: string): FeedSkip {
  return { pickId: p.id, strategy: strategyLabel(p.strategy), match: `${p.home ?? "?"} v ${p.away ?? "?"}`, reason };
}

// The last time the feed was fetched, and by what (its User-Agent). Kept in memory only.
// Every fetch counts picks as handed over, so a fetcher you don't recognise here (a browser,
// a chat app previewing the link) is worth knowing about.
let lastFeedFetchAt: string | null = null;
let lastFeedFetcher: string | null = null;
export function noteFeedFetched(userAgent?: string | null): void {
  lastFeedFetchAt = new Date().toISOString();
  lastFeedFetcher = userAgent ? userAgent.slice(0, 120) : null;
}
export function getLastFeedFetchAt(): string | null {
  return lastFeedFetchAt;
}
export function getLastFeedFetcher(): string | null {
  return lastFeedFetcher;
}