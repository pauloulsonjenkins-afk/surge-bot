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
import { kickoffMinutes } from "./parse-alert";
import { computeStopLoss } from "./stop-loss";
import { alertOddsOf } from "../server/pricing";

export interface SendingSettings {
  /** Master switch. */
  enabled: boolean;
  /** Per-strategy switches, keyed by lower-case strategy name. Missing = off. */
  strategies: Record<string, boolean>;
  /** Stake in pounds per strategy, keyed by lower-case strategy name. Missing = cannot be sent. */
  stakes: Record<string, number>;
  /** Minimum back odds per strategy, keyed by lower-case strategy name. Missing = no minimum. Sent as the MinPrice column. */
  minOdds: Record<string, number>;
  /** Hard ceiling. A stake above this is never sent, whatever is saved. */
  maxStake: number;
  /** Picks older than this are never sent. */
  maxAgeMinutes: number;
  /** Most NEW picks handed over per UK day. */
  dailyCap: number;
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

export const DEFAULT_SENDING: SendingSettings = {
  enabled: false,
  strategies: {},
  stakes: {},
  minOdds: {},
  maxStake: 5,
  maxAgeMinutes: 10,
  dailyCap: 30,
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
  const stakes: Record<string, number> = {};
  if (raw.stakes && typeof raw.stakes === "object") {
    for (const [k, v] of Object.entries(raw.stakes)) {
      const st = cleanStake(v);
      if (st !== null) stakes[k.toLowerCase()] = st;
    }
  }
  const minOdds: Record<string, number> = {};
  if (raw.minOdds && typeof raw.minOdds === "object") {
    for (const [k, v] of Object.entries(raw.minOdds)) {
      const m = cleanMinOdds(v);
      if (m !== null) minOdds[k.toLowerCase()] = m;
    }
  }
  return {
    enabled: raw.enabled === true,
    strategies,
    stakes,
    minOdds,
    maxStake: clampInt(raw.maxStake, 1, 500, DEFAULT_SENDING.maxStake),
    maxAgeMinutes: clampInt(raw.maxAgeMinutes, 1, 60, DEFAULT_SENDING.maxAgeMinutes),
    dailyCap: clampInt(raw.dailyCap, 0, 500, DEFAULT_SENDING.dailyCap),
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

/** Applies a partial update from the admin page and saves the merged, validated result. */
export function saveSendingSettings(db: EngineDb, patch: Record<string, unknown>): SendingSettings {
  const current = getSendingSettings(db);
  const next: SendingSettings = { ...current, strategies: { ...current.strategies }, stakes: { ...current.stakes }, minOdds: { ...current.minOdds } };

  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  // Stakes first, so a request can set a stake and switch the strategy on together.
  if (patch.stakes && typeof patch.stakes === "object") {
    for (const [k, v] of Object.entries(patch.stakes as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (v === null) delete next.stakes[key];
      else {
        const st = cleanStake(v);
        if (st !== null) next.stakes[key] = st;
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
  if (patch.maxStake !== undefined) next.maxStake = clampInt(patch.maxStake, 1, 500, current.maxStake);
  if (patch.strategies && typeof patch.strategies === "object") {
    for (const [k, v] of Object.entries(patch.strategies as Record<string, unknown>)) {
      if (typeof v === "boolean") next.strategies[k.toLowerCase()] = v;
    }
  }
  if (patch.maxAgeMinutes !== undefined) next.maxAgeMinutes = clampInt(patch.maxAgeMinutes, 1, 60, current.maxAgeMinutes);
  if (patch.dailyCap !== undefined) next.dailyCap = clampInt(patch.dailyCap, 0, 500, current.dailyCap);
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
    if (next.strategies[k] && next.stakes[k] === undefined) next.strategies[k] = false;
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
  betType: "BACK";
  /** Stake in pounds, sent in the Size column. */
  stake: number;
  /** Minimum back odds for this pick, sent in the MinPrice column. Null = none set. */
  minPrice: number | null;
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
  if (next.length > 5000) throw new Error("Match names is full (5,000 characters). Tidy it on the Sending page first.");
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

function csvField(v: string): string {
  return `"${v.replace(/"/g, "")}"`;
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
  if (p.market === "NEXT_GOAL") {
    return overUnderMarket(p.detail?.targetLine ?? null) ?? { error: "Could not work out the Over/Under line." };
  }
  if (p.market === "BOTH_TEAMS_TO_SCORE") return { marketType: settings.bttsMarketType, selectionName: settings.bttsSelection };
  if (p.market === "FIRST_HALF_GOALS") return { marketType: settings.firstHalfGoalsMarketType, selectionName: settings.firstHalfGoalsSelection };
  if (p.market === "FAVOURITE_TO_SCORE") {
    const side = p.detail?.favourite ?? null;
    if (side === null) return { error: "Could not tell which side is the favourite." };
    const code = side === "home" ? settings.favouriteScoresHomeMarketType : settings.favouriteScoresAwayMarketType;
    if (!code) return { error: "Set the favourite-to-score market codes on the Sending page (Bet wording) first." };
    const line = p.detail?.targetLine ?? null;
    if (line === null) return { error: "Could not work out the favourite's goal line." };
    const fill = (t: string) => t.replace(/\{line\}/g, line.toFixed(1)).replace(/\{line10\}/g, String(Math.round(line * 10)).padStart(2, "0"));
    return { marketType: fill(code), selectionName: fill(settings.favouriteScoresSelection) };
  }
  if (p.market === "FIRST_HALF_CORNERS") {
    if (!settings.firstHalfCornersMarketType) return { error: "Set the first-half corners market code on the Sending page (Bet wording) first." };
    const line = p.detail?.targetLine ?? null;
    if (line === null) return { error: "Could not work out the corner line." };
    const fill = (t: string) => t.replace(/\{line\}/g, line.toFixed(1)).replace(/\{line10\}/g, String(Math.round(line * 10)).padStart(2, "0"));
    return { marketType: fill(settings.firstHalfCornersMarketType), selectionName: fill(settings.firstHalfCornersSelection) };
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
  return { error: "This market can't be sent yet." };
}

/**
 * Works out which picks go in the feed right now. With markSent = true (the
 * real feed) newly included picks are stamped as sent; with false (the admin
 * preview) nothing is changed.
 */
export function buildFeed(db: EngineDb, opts: { markSent: boolean; now?: Date }): FeedResult {
  const now = opts.now ?? new Date();
  const settings = getSendingSettings(db);
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
    const r = empty("Sending is switched off.");
    r.skipped = recent.filter((p) => p.status !== "settled").map((p) => skip(p, "Sending is switched off."));
    return r;
  }

  const aliases = parseAliases(settings.aliases);
  const alias = (name: string) => aliases.get(name.trim().toLowerCase()) ?? name.trim();

  const today = ukDay.format(now);
  const stops = computeStopLoss(db, now);
  const noSend = db.noSendLeagues();
  let sentToday = db.recentSentTimes().filter((t) => ukDay.format(new Date(t)) === today).length;

  const rows: FeedRow[] = [];
  const skipped: FeedSkip[] = [];
  const toMark: Array<{ id: number; rowJson: string }> = [];

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
      const frozen = parseFrozenRow(p);
      if (frozen) {
        rows.push(frozen);
        continue;
      }
    }

    if (!settings.strategies[label.toLowerCase()]) {
      skipped.push(skip(p, "This strategy's switch is off."));
      continue;
    }
    // A league whose matches aren't on Betfair (marked on the Leagues page) is recorded but never sent.
    if (noSend.has(p.leagueKey)) {
      skipped.push(skip(p, "This league is marked as not on Betfair (Leagues page)."));
      continue;
    }
    if (!p.sendable) {
      skipped.push(skip(p, p.flags[0] ?? "Not sendable."));
      continue;
    }
    if (!p.home || !p.away) {
      skipped.push(skip(p, "Team names missing."));
      continue;
    }

    const alreadySent = p.sentAt !== null;

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

    const stake = settings.stakes[label.toLowerCase()];
    if (stake === undefined) {
      skipped.push(skip(p, "No stake set for this strategy."));
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
      sentToday++;
    }

    const row: FeedRow = {
      pickId: p.id,
      provider: providerName(p.strategy),
      marketType: market.marketType,
      selectionName: market.selectionName,
      eventName: `${alias(p.home)} v ${alias(p.away)}`,
      betType: "BACK",
      stake,
      minPrice: settings.minOdds[label.toLowerCase()] ?? null,
    };
    rows.push(row);
    if (!alreadySent) toMark.push({ id: p.id, rowJson: JSON.stringify(row) });
  }

  if (opts.markSent) db.markSent(toMark);

  return { rows, skipped, csv: toCsv(rows, Object.keys(settings.minOdds).length > 0), newlySent: toMark.length, blockedReason: null };
}

// ---------------------------------------------------------------------------
// Simulation

const SIM_SINCE_KEY = "sim_recording_since";

/** The price the alert printed for the bet it describes, read from the parsed alert (see alertOddsOf). */
function alertOddsOfPick(p: LivePick): number | null {
  const d = p.detail;
  if (!d) return null;
  const live = d.odds?.live1x2 ?? null;
  const favouriteOdds = d.favourite && live ? (d.favourite === "home" ? live[0] : live[2]) : null;
  return alertOddsOf({
    market: p.market,
    targetLine: d.targetLine ?? null,
    overLine: d.odds?.overUnderLine ?? null,
    overOdds: d.odds?.over ?? null,
    favouriteOdds: typeof favouriteOdds === "number" ? favouriteOdds : null,
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
  const today = ukDay.format(now);
  const stops = computeStopLoss(db, now, "sim");
  const noSend = db.noSendLeagues();
  let betsToday = [...db.recentSentTimes(), ...db.recentSimBetTimes()].filter((t) => ukDay.format(new Date(t)) === today).length;

  const items: Array<{ id: number; rowJson: string }> = [];
  for (const p of candidates) {
    const key = strategyLabel(p.strategy).toLowerCase();
    const fresh = now.getTime() <= betableUntil(p, settings.maxAgeMinutes);
    const liveNow = settings.enabled && settings.strategies[key] === true;
    if (liveNow && fresh) continue; // the bet feed decides this one

    const stake = settings.stakes[key] ?? null;
    const minPrice = settings.minOdds[key] ?? null;
    const odds = alertOddsOfPick(p);
    let skipped: string | null = null;
    if (noSend.has(p.leagueKey)) skipped = "This league is marked as not on Betfair.";
    else if (liveNow) skipped = "Not sent by the bet feed in time.";
    else if (!fresh) skipped = "The alert arrived too late to bet.";
    else if (stake === null) skipped = "No stake set for this strategy.";
    else if (stake > settings.maxStake) skipped = `Stake £${stake.toFixed(2)} is above the highest allowed (£${settings.maxStake}).`;
    else if (minPrice !== null && odds !== null && odds < minPrice) skipped = `Odds ${odds.toFixed(2)} were below the minimum ${minPrice.toFixed(2)}.`;
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
  if (p.market !== "FIRST_HALF_GOALS") return null;
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