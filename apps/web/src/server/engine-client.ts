/**
 * Server-only call to the engine's /internal/picks endpoint.
 *
 * Never imported into client code — ENGINE_BASE_URL and ADMIN_INTERNAL_KEY
 * stay on the server, same principle as auth.ts and ADMIN_PASSWORD.
 */

export interface EnginePick {
  id: number;
  receivedAt: string;
  bodySha256: string;
  contentType: string | null;
  signatureVerified: boolean;
  body: string;
}

export async function fetchRecentPicks(limit = 50): Promise<EnginePick[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  console.log(`[picks] ENGINE_BASE_URL=${baseUrl ?? "MISSING"} ADMIN_INTERNAL_KEY=${internalKey ? "set" : "MISSING"}`);

  if (!baseUrl || !internalKey) {
    throw new Error(
      "ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component " +
        "(ADMIN_INTERNAL_KEY must match the same value set on the engine component).",
    );
  }

  const url = `${baseUrl}/internal/picks?limit=${limit}`;
  console.log(`[picks] fetching ${url} ...`);
  const started = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    console.log(`[picks] got status ${res.status} after ${Date.now() - started}ms`);

    if (!res.ok) {
      throw new Error(`Engine responded ${res.status} when fetching picks.`);
    }

    const data = (await res.json()) as { picks: EnginePick[] };
    console.log(`[picks] parsed ${data.picks?.length ?? 0} picks`);
    return data.picks;
  } catch (err) {
    console.log(`[picks] fetch FAILED after ${Date.now() - started}ms: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** One Telegram alert, parsed. Mirrors LivePick in the engine's engine-db.ts. */
/** How a settled pick was bet: matched on Betfair, placed by hand, sent before Betfair was checked, sent but never placed, or Sim. */
export type PickPlacement = "betfair" | "manual" | "legacy" | "notPlaced" | "sim";

export interface LivePick {
  id: number;
  marketCheck?: "ok" | "noMarket" | "noSelection" | null;
  marketCheckDetail?: string | null;
  /** When the admin cleared it from Live's "Waiting for a result" without a result (missing on an older engine). */
  waitingClearedAt?: string | null;
  /** Not found on Betfair: the nearest events its search returned, to choose from (missing on an older engine). */
  exchangeCandidates?: Array<{ name: string; id: string }> | null;
  exchange?: "on" | "nameDiffers" | "off" | null;
  exchangeEvent?: string | null;
  /** Betfair's back price for the bet the feed sends, read when the match was checked (admin only). */
  exchangeOdds?: number | null;
  chatId: string;
  messageId: number;
  firstSeenAt: string;
  updatedAt: string;
  strategy: string;
  market: string | null;
  selection: string | null;
  competition: string | null;
  home: string | null;
  away: string | null;
  minute: number | null;
  timerRaw: string | null;
  goalsHome: number | null;
  goalsAway: number | null;
  htScore: string | null;
  ftScore: string | null;
  result: "hit" | "miss" | null;
  /** True when the result was set by hand rather than taken from the alert. */
  resultOverridden: boolean;
  /** What the alert itself said, even when amended. */
  originalResult: "hit" | "miss" | null;
  /** True when marked "didn't actually bet" — left out of stats and Win/Loss. */
  excluded: boolean;
  status: "captured" | "settled" | "unmapped" | "flagged";
  sendable: boolean;
  /** When the pick was first handed to the bet feed, or null. */
  sentAt: string | null;
  /**
   * Admin list only, once settled: stake and profit in pounds as Win/Loss works it out, how it was bet, and whether the
   * figure is real (from the matched Betfair bet). "notPlaced": sent but never placed, so nothing was staked.
   * placement and real are missing from an older engine.
   */
  pnl?: { stake: number; profit: number; placement?: PickPlacement; real?: boolean; assumed?: boolean } | null;
  flags: string[];
  detail: {
    stats: Record<string, [number, number]>;
    positions: string | null;
    lastGoal: string | null;
    matched: number | null;
    strikeRate: number | null;
    /** A pre-match alert's kick-off wording ("In 1 hour"). */
    kickoffRaw?: string | null;
    /** The result worked out by the app, what the alert's own tick said, and which one was used. */
    result: "hit" | "miss" | null;
    alertResult: "hit" | "miss" | null;
    resultSource: "score" | "alert" | null;
  } | null;
}

/**
 * The shape sent to the public pages. It deliberately leaves out the raw alert
 * text, Telegram ids, stakes and anything about what was handed to the bet feed.
 */
export interface PublicPick {
  id: number;
  firstSeenAt: string;
  strategy: string;
  market: string | null;
  selection: string | null;
  competition: string | null;
  home: string | null;
  away: string | null;
  minute: number | null;
  timerRaw: string | null;
  goalsHome: number | null;
  goalsAway: number | null;
  htScore: string | null;
  ftScore: string | null;
  result: "hit" | "miss" | null;
  resultOverridden: boolean;
  status: "captured" | "settled" | "unmapped" | "flagged";
  sentAt: string | null;
  /** Whether the match was on Betfair when the alert arrived; null when not checked. Missing on an older engine. */
  exchange?: "on" | "nameDiffers" | "off" | null;
  /** The Betfair event found when a team is spelled differently there. */
  exchangeEvent?: string | null;
  /** Betfair's back price for the bet the feed sends, read when the match was checked. */
  exchangeOdds?: number | null;
  /** Whether Betfair had the exact market and selection the feed sends, and what was found (admin only). */
  marketCheck?: "ok" | "noMarket" | "noSelection" | null;
  marketCheckDetail?: string | null;
  /** When the admin cleared it from Live's "Waiting for a result" without a result. */
  waitingClearedAt?: string | null;
  /** Not found on Betfair: the nearest events its search returned (admin only). */
  exchangeCandidates?: Array<{ name: string; id: string }> | null;
  flags: string[];
  detail: {
    stats: Record<string, [number, number]>;
    positions: string | null;
    lastGoal: string | null;
    matched: number | null;
    strikeRate: number | null;
    /** A pre-match alert's kick-off wording ("In 1 hour"). */
    kickoffRaw?: string | null;
  } | null;
}

export function toPublicPick(p: LivePick): PublicPick {
  return {
    id: p.id,
    firstSeenAt: p.firstSeenAt,
    strategy: p.strategy,
    market: p.market,
    selection: p.selection,
    competition: p.competition,
    home: p.home,
    away: p.away,
    minute: p.minute,
    timerRaw: p.timerRaw,
    goalsHome: p.goalsHome,
    goalsAway: p.goalsAway,
    htScore: p.htScore,
    ftScore: p.ftScore,
    result: p.result,
    resultOverridden: p.resultOverridden,
    status: p.status,
    sentAt: p.sentAt,
    exchange: p.exchange ?? null,
    exchangeEvent: p.exchangeEvent ?? null,
    exchangeOdds: p.exchangeOdds ?? null,
    marketCheck: p.marketCheck ?? null,
    marketCheckDetail: p.marketCheckDetail ?? null,
    waitingClearedAt: p.waitingClearedAt ?? null,
    exchangeCandidates: p.exchangeCandidates ?? null,
    flags: p.flags,
    detail: p.detail
      ? {
          stats: p.detail.stats,
          positions: p.detail.positions,
          lastGoal: p.detail.lastGoal,
          matched: p.detail.matched,
          strikeRate: p.detail.strikeRate,
          kickoffRaw: p.detail.kickoffRaw ?? null,
        }
      : null,
  };
}

/** Admin view: everything the Results page needs, still without the raw alert text. */
export function toAdminPick(p: LivePick): LivePick {
  const { rawText: _raw, sentRowJson: _row, ...rest } = p as LivePick & { rawText?: string; sentRowJson?: string | null };
  void _raw;
  void _row;
  return rest as LivePick;
}

/** Which picks to fetch: the latest ones, the last N hours, or one UK day (YYYY-MM-DD). */
export type PickWindow = { hours: number } | { date: string } | null;

export async function fetchLivePicks(limit = 50, window: PickWindow = null): Promise<LivePick[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    if (window && "hours" in window) query.set("hours", String(window.hours));
    if (window && "date" in window) query.set("date", window.date);
    const res = await fetch(`${baseUrl}/internal/live?${query.toString()}`, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when fetching live picks.`);
    const data = (await res.json()) as { picks: LivePick[] };
    return data.picks;
  } finally {
    clearTimeout(timeout);
  }
}

/** Mirrors HitRateStats in the engine's engine-db.ts. */
export interface HitRateRow {
  label: string;
  alerts: number;
  hits: number;
  misses: number;
  hitRate: number | null;
}
export interface StrategyStats extends HitRateRow {
  market: string | null;
  lastAlertAt: string;
}
export interface HitRateStats {
  days: number | null;
  totals: { alerts: number; hits: number; misses: number; pending: number; needsReview: number; hitRate: number | null };
  byStrategy: StrategyStats[];
  byLeague: HitRateRow[];
  byMinute: HitRateRow[];
  daily: Array<{ date: string; hits: number; misses: number; hitRate: number | null }>;
  /** What the hit rate needs beside it to be judged (missing on an older engine). roi is only sent to the admin. */
  context?: HitRateContext;
}

/** Mirrors HitRateContext in the engine's winloss.ts. */
export interface HitRateContext {
  settled: number;
  hits: number;
  /** 95% range of the true hit rate, percents. */
  range: { low: number; high: number } | null;
  oddsKnown: number;
  avgOdds: number | null;
  /** Hit rate needed to break even at avgOdds after commission, percent. */
  breakeven: number | null;
  counted: number;
  /** Return per £1 staked; null for anyone but the admin. */
  roi: number | null;
  /** Profit and stakes in £ over the priced picks; null for anyone but the admin (missing on an older engine). */
  profit?: number | null;
  staked?: number | null;
  /** Of the priced picks, how many were priced at an assumed price (missing on an older engine). */
  assumed?: number;
}

/**
 * Live or simulation. A pick is live when it was actually handed to the bet feed, and a simulation pick
 * otherwise. Mirrors PickMode in the engine's engine-db.ts. "all" means both.
 */
export type PickMode = "live" | "sim" | "all";

export function parsePickMode(v: unknown): PickMode {
  return v === "live" || v === "sim" ? v : "all";
}

/** `since` (an ISO time, e.g. UK midnight for "Today") takes the place of `days` when given. */
export async function fetchHitRateStats(days: number | null, strategy: string | null = null, mode: PickMode = "all", since: string | null = null): Promise<HitRateStats> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const query = new URLSearchParams();
    if (since) query.set("since", since);
    else if (days) query.set("days", String(days));
    if (strategy) query.set("strategy", strategy);
    if (mode !== "all") query.set("mode", mode);
    const qs = query.toString();
    const res = await fetch(`${baseUrl}/internal/stats${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when fetching stats.`);
    return (await res.json()) as HitRateStats;
  } finally {
    clearTimeout(timeout);
  }
}

/** Mirrors the engine's bet-feed settings and the /internal/sending reply. */
export interface SendingSettings {
  enabled: boolean;
  strategies: Record<string, boolean>;
  /** Stake in pounds per strategy (lower-case name). Send null to clear one. */
  stakes: Record<string, number | null>;
  /** Minimum back odds per strategy (lower-case name), sent to the betting software as MinPrice. Send null to clear one. */
  minOdds: Record<string, number | null>;
  maxStake: number;
  maxAgeMinutes: number;
  dailyCap: number;
  bttsMarketType: string;
  bttsSelection: string;
  underdogMarketType: string;
  underdogHomeSelection: string;
  underdogAwaySelection: string;
  favouriteMarketType: string;
  favouriteHomeSelection: string;
  favouriteAwaySelection: string;
  firstHalfGoalsMarketType: string;
  firstHalfGoalsSelection: string;
  /** Favourite to score again (Pass Master 1st half): codes per side, empty = not sent yet. Missing on an older engine. */
  favouriteScoresHomeMarketType?: string;
  favouriteScoresAwayMarketType?: string;
  favouriteScoresSelection?: string;
  /** Empty = First Half Corner Race isn't sent yet. Missing on an older engine. */
  firstHalfCornersMarketType?: string;
  firstHalfCornersSelection?: string;
  aliases: string;
}

/** Where a strategy stands against its stop loss limits today. Null when it has no limits. Mirrors StopLossStatus in the engine's stop-loss.ts. */
export interface StopLossStatus {
  key: string;
  dailyLoss: number | null;
  lossRun: number | null;
  resumedAt: string | null;
  settledToday: number;
  todayNet: number;
  todayRun: number;
  stopped: boolean;
  reason: string | null;
}

/** What can be changed on one strategy's stop loss. null clears a limit; resume restarts today's count. */
export interface StopLossPatch {
  dailyLoss?: number | null;
  lossRun?: number | null;
  resume?: boolean;
}

export interface SendingState {
  settings: SendingSettings;
  strategies: Array<{ label: string; market: string | null; enabled: boolean; stake: number | null; minOdds: number | null; alerts?: number; sent?: number; stopLoss: StopLossStatus | null; /** The same limits run on its simulated bets (missing on an older engine). */ simStopLoss?: StopLossStatus | null }>;
  feedTokenConfigured: boolean;
  lastFeedFetchAt: string | null;
  /** The User-Agent of the last feed fetch, to spot fetchers that aren't the betting software. */
  lastFeedFetcher?: string | null;
  preview: {
    rows: Array<{ pickId: number; provider: string; marketType: string; selectionName: string; eventName: string; stake: number; minPrice: number | null }>;
    skipped: Array<{ pickId: number; strategy: string; match: string; reason: string }>;
    csv: string;
    blockedReason: string | null;
  };
}

export type SendingPatch = Partial<SendingSettings> & { stopLoss?: Record<string, StopLossPatch> };

async function sendingRequest(method: "GET" | "PUT", body?: SendingPatch): Promise<SendingState> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/sending`, {
      method,
      headers: { Authorization: `Bearer ${internalKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} for sending options.`);
    return (await res.json()) as SendingState;
  } finally {
    clearTimeout(timeout);
  }
}

export interface RemoveStrategyResult {
  removed: number;
  /** Picks already sent to bet. They are never deleted, only taken out of results once over 2 hours old. */
  keptBecauseSent: number;
  /** Sent records permanently deleted (only when asked for). Ones sent today are kept until tomorrow. */
  sentRecordsDeleted?: number;
  hiddenFromResults?: number;
  ignoring?: boolean;
}

export async function removeStrategy(label: string, ignoreFuture = false, includeSent = false): Promise<RemoveStrategyResult> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/strategies/remove`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label, ignoreFuture, includeSent }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Engine responded ${res.status} when removing the strategy.`);
    }
    return (await res.json()) as RemoveStrategyResult;
  } finally {
    clearTimeout(timeout);
  }
}

export async function setPickResult(id: number, result: "hit" | "miss" | null): Promise<void> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/picks/result`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, result }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when saving the result.`);
  } finally {
    clearTimeout(timeout);
  }
}

/** Clears a pick from Live's "Waiting for a result" without a result, or (cleared = false) puts it back. */
export async function setPickWaitingCleared(id: number, cleared: boolean): Promise<void> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/picks/clear-waiting`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, cleared }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when clearing the pick.`);
  } finally {
    clearTimeout(timeout);
  }
}

async function accessRequest(method: "GET" | "PUT", publicView?: boolean): Promise<boolean> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/access`, {
      method,
      headers: {
        Authorization: `Bearer ${internalKey}`,
        ...(publicView !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: publicView !== undefined ? JSON.stringify({ publicView }) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} for the public view setting.`);
    return ((await res.json()) as { publicView: boolean }).publicView === true;
  } finally {
    clearTimeout(timeout);
  }
}

export const fetchPublicView = () => accessRequest("GET");
export const savePublicView = (enabled: boolean) => accessRequest("PUT", enabled);

export async function setPickExcluded(id: number, excluded: boolean): Promise<void> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/picks/exclude`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, excluded }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when saving.`);
  } finally {
    clearTimeout(timeout);
  }
}

export const fetchSending = () => sendingRequest("GET");
export const saveSending = (patch: SendingPatch) => sendingRequest("PUT", patch);

/** Mirrors the engine's Win/Loss reply (winloss.ts). */
export interface WinLossSettings {
  commission: number;
  assumedOdds: Record<string, number | null>;
  expenditure: { enabled: boolean; monthly: number; startMonth: string | null };
}
export interface WinLossPoint {
  label: string;
  total: number;
  totalAfter: number;
  s: Record<string, number>;
}
export interface WinLossPeriod {
  strategies: Record<string, number>;
  total: number;
  expenditure: number;
  totalAfter: number;
  picks: number;
}
export interface WinLossStrategy {
  label: string;
  key: string;
  market: string | null;
  stake: number | null;
  assumedOdds: number | null;
  settled: number;
  counted: number;
  noStake: number;
  noOdds: number;
  usedAlertOdds: number;
  /** Simulation picks the feed's rules would have held back, so not priced (missing on an older engine). */
  notPlaced?: number;
}
/** One line on the Profit and loss table and the strategy graph (strategies merged on the Strategies page appear once). */
export interface WinLossReported {
  key: string;
  label: string;
  members: string[];
}
export interface WinLossState {
  /** Which picks the figures cover (missing only while the engine is still on an older version). */
  mode?: PickMode;
  today: string;
  settings: WinLossSettings;
  maxStake: number;
  strategies: WinLossStrategy[];
  /** Missing only while the engine is still on an older version. */
  reported?: WinLossReported[];
  /** Month to date, one figure per UK day (missing only while the engine is still on an older version). */
  mtdDaily?: Array<{ date: string; pnl: number }>;
  periods: { d1: WinLossPeriod; d7: WinLossPeriod; mtd: WinLossPeriod; ytd: WinLossPeriod };
  series: { d1: WinLossPoint[]; d7: WinLossPoint[]; mtd: WinLossPoint[]; ytd: WinLossPoint[] };
}
export interface WinLossPatch {
  commission?: number;
  assumedOdds?: Record<string, number | null>;
  expenditure?: { enabled?: boolean; monthly?: number; startMonth?: string };
}

async function winLossRequest(method: "GET" | "PUT", body?: WinLossPatch, mode: PickMode = "all"): Promise<WinLossState> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${baseUrl}/internal/winloss${mode !== "all" ? `?mode=${mode}` : ""}`, {
      method,
      headers: { Authorization: `Bearer ${internalKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} for the win/loss figures.`);
    return (await res.json()) as WinLossState;
  } finally {
    clearTimeout(timeout);
  }
}

export const fetchWinLoss = (mode: PickMode = "all") => winLossRequest("GET", undefined, mode);
export const saveWinLoss = (patch: WinLossPatch, mode: PickMode = "all") => winLossRequest("PUT", patch, mode);

/** Totals for one league / strategy / minute bucket. Mirrors PerformanceCell in the engine's engine-db.ts. */
export interface EnginePerformanceCell {
  leagueKey: string;
  league: string;
  country: string | null;
  countryOverride: string | null;
  tierOverride: number | null;
  strategy: string;
  bucket: number | null;
  alerts: number;
  hits: number;
  misses: number;
}

export async function fetchPerformanceCells(days: number | null, mode: PickMode = "all", since: string | null = null): Promise<EnginePerformanceCell[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const query = new URLSearchParams();
    if (since) query.set("since", since);
    else if (days) query.set("days", String(days));
    if (mode !== "all") query.set("mode", mode);
    const qs = query.toString();
    const res = await fetch(`${baseUrl}/internal/performance${qs ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when fetching the breakdown.`);
    const data = (await res.json()) as { cells: EnginePerformanceCell[] };
    return data.cells;
  } finally {
    clearTimeout(timeout);
  }
}

/** One league on the admin Leagues page. Mirrors AdminLeagueRow in the engine's engine-db.ts. */
export interface AdminLeagueRow {
  key: string;
  league: string;
  country: string | null;
  alerts: number;
  hits: number;
  misses: number;
  earlierAlerts: number;
  lastAlertAt: string;
  hidden: boolean;
  resetAt: string | null;
  countryOverride: string | null;
  tierOverride: number | null;
  /** Whether its alerts' matches were on Betfair when they arrived (missing on an older engine). */
  exchange?: { checked: number; on: number; nameDiffers: number; off: number; lastOffAt: string | null };
  /** Marked "don't send": alerts are recorded but never sent to the betting software. */
  noSend?: boolean;
}

/** What can be changed on one league. Mirrors LeaguePatch in the engine's engine-db.ts. */
export interface LeaguePatch {
  hidden?: boolean;
  reset?: boolean;
  country?: string | null;
  tier?: number | null;
  noSend?: boolean;
}

export async function fetchAdminLeagues(): Promise<AdminLeagueRow[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/leagues`, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when fetching leagues.`);
    return ((await res.json()) as { leagues: AdminLeagueRow[] }).leagues;
  } finally {
    clearTimeout(timeout);
  }
}

export async function updateAdminLeague(key: string, patch: LeaguePatch): Promise<void> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/leagues/update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key, ...patch }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when saving the league.`);
  } finally {
    clearTimeout(timeout);
  }
}

/** One match on the Schedule tab. Mirrors ScheduleFixture in the engine's fixtures/api-football.ts. */
export interface ScheduleFixture {
  id: number;
  kickoff: string;
  timestamp: number;
  status: string;
  statusLong: string;
  leagueId: number;
  league: string;
  country: string;
  round: string | null;
  home: string;
  away: string;
  venue: string | null;
}

/** The engine's /internal/schedule reply. */
export interface ScheduleDay {
  date: string;
  today: string;
  tomorrow: string;
  pulledAt: string | null;
  fixtures: ScheduleFixture[];
  pull: { configured: boolean; lastSuccessAt: string | null; lastError: string | null };
}

export async function fetchSchedule(date: string | null): Promise<ScheduleDay> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/schedule${date ? `?date=${encodeURIComponent(date)}` : ""}`, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when fetching the schedule.`);
    return (await res.json()) as ScheduleDay;
  } finally {
    clearTimeout(timeout);
  }
}

/** One strategy on the admin Strategies page. Mirrors AdminStrategyRow in the engine's engine-db.ts. */
export interface AdminStrategy {
  label: string;
  market: string | null;
  /** Every stored alert (what deleting the strategy removes). */
  alerts: number;
  /** Stored alerts since the "fresh start" date; the hit and miss counts below are also since then. */
  alertsSince: number;
  hits: number;
  misses: number;
  /** The same hits and misses, split into picks that were sent (live) and not (simulation). */
  liveHits: number;
  liveMisses: number;
  simHits: number;
  simMisses: number;
  sent: number;
  lastAlertAt: string;
  mergedInto: string | null;
  sendingOn: boolean;
  /** Live when its switch and the master switch are both on; its new picks are simulated otherwise. */
  mode: "live" | "sim";
  stake: number | null;
  /** Money figures, all time, split into live and sim (missing on an older engine). */
  returns?: { live: StrategyReturn; sim: StrategyReturn; all?: StrategyReturn } | null;
}

/** Mirrors StrategyReturn in the engine's winloss.ts. The fields after roi are missing on an older engine. */
export interface StrategyReturn {
  settled: number;
  hits?: number;
  counted: number;
  staked: number;
  profit: number;
  /** Profit per pound staked (0.12 = 12p back for every £1), or null when nothing was staked. */
  roi: number | null;
  avgOdds?: number | null;
  /** Hit rate needed to break even at avgOdds after commission, percent. */
  breakeven?: number | null;
  range?: { low: number; high: number } | null;
  /** Biggest fall in £ from a high point of running profit. */
  maxDrawdown?: number;
  longestLosingRun?: number;
  worstDay?: { day: string; profit: number } | null;
  /** Most losses in a row within one UK day. */
  worstDayRun?: number;
  /** Of the priced picks, how many were priced at the strategy's assumed odds. */
  assumed?: number;
}

/** One pick on a strategy's equity curve. Mirrors EquityPoint in the engine's winloss.ts. */
export interface EquityPoint {
  at: string;
  result: "hit" | "miss";
  profit: number;
  total: number;
}

export interface StrategyEquity {
  label: string;
  points: EquityPoint[];
  summary: StrategyReturn;
}

/** GET or POST to an /internal route on the engine, as the admin site. */
async function engineCall<T>(path: string, what: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${internalKey}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(body.message ?? body.error ?? `Engine responded ${res.status} for ${what}.`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchStrategyEquity(label: string, mode: PickMode): Promise<StrategyEquity> {
  const q = new URLSearchParams({ label });
  if (mode !== "all") q.set("mode", mode);
  return engineCall<StrategyEquity>(`/internal/strategies/equity?${q}`, "the equity curve");
}

export interface AdminStrategies {
  strategies: AdminStrategy[];
  /** Strategies whose new alerts are being ignored. */
  ignored: string[];
}

/** The "fresh start" time (ISO), or null when every figure counts from the beginning. */
export async function fetchFreshStart(): Promise<{ at: string | null }> {
  return freshStartRequest("GET");
}

/** start = true counts everything from now; false undoes it. Nothing is deleted either way. */
export async function saveFreshStart(start: boolean): Promise<{ at: string | null }> {
  return freshStartRequest("POST", { start });
}

async function freshStartRequest(method: "GET" | "POST", body?: { start: boolean }): Promise<{ at: string | null }> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/fresh-start`, {
      method,
      headers: { Authorization: `Bearer ${internalKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} for the fresh start setting.`);
    const data = (await res.json()) as { at?: string | null };
    return { at: data.at ?? null };
  } finally {
    clearTimeout(timeout);
  }
}

/** Every strategy; with `since` (an ISO date), hits, misses and returns count only picks from then on. */
export async function fetchAdminStrategies(since: string | null = null): Promise<AdminStrategies> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/strategies${since ? `?since=${encodeURIComponent(since)}` : ""}`, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when fetching strategies.`);
    const data = (await res.json()) as { strategies: AdminStrategy[]; ignored?: string[] };
    return { strategies: data.strategies, ignored: data.ignored ?? [] };
  } finally {
    clearTimeout(timeout);
  }
}

/** Reports one strategy under another's name (into = null undoes it). Throws the engine's reason if it refuses. */
export async function mergeAdminStrategy(from: string, into: string | null): Promise<void> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/strategies/merge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, into }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Engine responded ${res.status} when merging.`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** One UK day that has picks. Mirrors listPickDays in the engine's engine-db.ts. */
export interface PickDay {
  date: string;
  picks: number;
  hits: number;
  misses: number;
}

export async function fetchPickDays(): Promise<PickDay[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/live/days`, {
      headers: { Authorization: `Bearer ${internalKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when fetching the pick days.`);
    return ((await res.json()) as { days: PickDay[] }).days;
  } finally {
    clearTimeout(timeout);
  }
}

/** Starts or stops ignoring a strategy's new alerts. */
export async function setStrategyIgnored(label: string, ignored: boolean): Promise<void> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/strategies/ignore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label, ignored }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when saving.`);
  } finally {
    clearTimeout(timeout);
  }
}
// ---- Betfair reconciliation (mirrors betfair/reconcile.ts in the engine) ----

export interface BetImportSummary {
  at: string;
  source: string;
  rows: number;
  added: number;
  updated: number;
  skipped: number;
  linked: number;
  /** Which column of the file was read for each field. */
  columns: Record<string, string>;
  /** Columns in the file that weren't used. */
  unused: string[];
}

export interface ReconcileStrategy {
  label: string;
  sent: number;
  matched: number;
  unmatchedRate: number | null;
  compared: number;
  estimatedProfit: number;
  actualProfit: number;
  slippage: number | null;
  slippageBets: number;
  resultMismatches: number;
}

export interface ReconcileReport {
  lastImport: BetImportSummary | null;
  coverage: { from: string; to: string } | null;
  strategies: ReconcileStrategy[];
  totals: { sent: number; matched: number; compared: number; estimatedProfit: number; actualProfit: number };
  /** Bets with no pick that haven't been acknowledged. reason: why no pick fits (missing on an older engine). */
  unlinked: UnlinkedBet[];
  /** How many there are in all (the list stops at 100). Missing on an older engine. */
  unlinkedCount?: number;
  /** Unlinked bets acknowledged as not from the feed, kept out of the list above (missing on an older engine). */
  acknowledged?: Array<UnlinkedBet & { acknowledgedAt: string }>;
  acknowledgedCount?: number;
  importTokenConfigured: boolean;
  /** The live check of your bets on Betfair (missing on an older engine). */
  betfairLink?: BetfairLinkStatus;
  /** Corner markets Betfair offered for First Half Corner Race alerts, to choose the one to send (missing on an older engine). */
  cornerMarkets?: Array<{ name: string; code: string; selections: string[]; seenAt: string; example: string }>;
  /** Team goal markets Betfair offered for the favourite in Pass Master alerts (missing on an older engine). */
  teamMarkets?: Array<{ name: string; code: string; selections: string[]; seenAt: string; example: string }>;
}

/** Mirrors BetfairLinkStatus in the engine's betfair/exchange.ts. */
export interface BetfairLinkStatus {
  configured: boolean;
  missing: string[];
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastCount: number;
}

/** Where a sent pick stands on Betfair. Mirrors Placement in the engine's betfair/exchange.ts. */
export interface Placement {
  state: "checking" | "beforeKickoff" | "waiting" | "matched" | "won" | "lost" | "lapsed" | "notPlaced" | "manual";
  /** Logged on Live as placed by hand. */
  manual?: { stake: number; odds: number } | null;
  stake: number | null;
  matched: number;
  odds: number | null;
  profit: number | null;
  bets: number;
}

export function fetchPlacements(): Promise<{ link: BetfairLinkStatus; picks: Record<string, Placement> }> {
  return engineCall("/internal/betfair/placements", "bet placements");
}

export interface UnlinkedBet {
  /** A Match names line that would link it ("alert name = Betfair name"), when one team is spelled differently. */
  suggestion?: { from: string; to: string } | null;
  betId: string;
  placedAt: string | null;
  event: string;
  selection: string | null;
  status: string;
  profit: number | null;
  reason?: string;
}

/** Adds "alert name = Betfair name" to the Sending page's Match names and re-links bets. */
/** A pick not found on Betfair: use one of the events Betfair's search offered (Match names added, pick sent if in time). */
export function chooseBetfairMatch(id: number, event: string): Promise<{ added: string[]; sent: boolean; message: string }> {
  return engineCall("/internal/betfair/use-match", "using that match", { method: "POST", body: { id, event } });
}

/** Which Betfair competition a league is ("none": not on Betfair; null: back to matching by name). */
export function setLeagueOverride(league: string, competition: string | null): Promise<{ ok: true }> {
  return engineCall("/internal/betfair/coverage/override", "matching the league", { method: "POST", body: { league, competition } });
}

export function addMatchName(from: string, to: string): Promise<{ line: string; linked: number }> {
  return engineCall("/internal/betfair/match-name", "adding the match name", { method: "POST", body: { from, to } });
}

/** Marks unlinked bets as acknowledged (not from the feed), or puts them back in the list. */
export function acknowledgeBets(betIds: string[], acknowledged: boolean): Promise<{ changed: number }> {
  return engineCall<{ changed: number }>("/internal/betfair/acknowledge", "acknowledging bets", { method: "POST", body: { betIds, acknowledged } });
}

export function fetchReconcile(): Promise<ReconcileReport> {
  return engineCall<ReconcileReport>("/internal/betfair/reconcile", "the reconciliation");
}

/** Sends an exported bet history to the engine. Throws the engine's reason when the file can't be read. */
/** timeZone: the zone the file's times are written in, e.g. "Europe/Berlin", or null for UK time. */
export function importBetHistory(csv: string, source: string, timeZone: string | null = null): Promise<BetImportSummary> {
  return engineCall<BetImportSummary>("/internal/betfair/import", "the import", { method: "POST", body: { csv, source, timeZone }, timeoutMs: 30_000 });
}

// ---- Horses (mirrors server/horses.ts in the engine) ----

export interface HorseBet {
  id: number;
  /** UK date, YYYY-MM-DD. */
  day: string;
  /** 1 = NAP, 2 = Next best, 3 = 3rd choice, 4 = 4th choice. */
  rank: 1 | 2 | 3 | 4;
  horse: string | null;
  /** Per part: an each-way bet costs twice this. */
  stake: number;
  betType: "win" | "ew";
  /** Each-way: the place part pays 1/this of the odds (4 = 1/4, 5 = 1/5). */
  ewFraction: number | null;
  ewPlaces: number | null;
  /** Decimal odds. */
  odds: number;
  /** As typed, e.g. "5/2". */
  oddsText: string;
  result: "pending" | "won" | "placed" | "lost" | "void";
}

/** A day's EW Yankee unit stake (it costs 22 times this), or null for none. */
export interface HorseDay {
  day: string;
  yankeeStake: number | null;
}

export interface HorseEntryInput {
  rank: number;
  horse: string;
  stake: string;
  odds: string;
  betType: "win" | "ew";
  ewFraction: number | null;
  ewPlaces: string;
}

export function fetchHorseBets(): Promise<{ bets: HorseBet[]; days?: HorseDay[] }> {
  return engineCall("/internal/horses", "the horse bets");
}

/** Saves one day's choices; throws the engine's reason (e.g. "NAP: enter the odds...") when something can't be saved. */
export function saveHorseDay(day: string, entries: HorseEntryInput[], yankeeStake: string | null): Promise<{ bets: HorseBet[] }> {
  return engineCall("/internal/horses/day", "saving the day", { method: "PUT", body: { day, entries, yankeeStake } });
}

export function setHorseResult(id: number, result: HorseBet["result"]): Promise<{ ok: true }> {
  return engineCall("/internal/horses/result", "saving the result", { method: "POST", body: { id, result } });
}

// ---- Betfair coverage (mirrors betfair/competitions.ts in the engine) ----

export interface CoverageResult {
  name: string;
  country: string | null;
  /** on = a Betfair competition fits; maybe = same country, different name (check it); not = none fits. */
  status: "on" | "maybe" | "not";
  betfair: { name: string; region: string | null; lastSeen: string } | null;
  alertsOn?: number;
  alertsOff?: number;
  /** Matched by hand on the Leagues page rather than by name (missing on an older engine). */
  overridden?: boolean;
}

export interface CoverageReport {
  competitionCount: number;
  competitionsUpdatedAt: string | null;
  leagues: CoverageResult[];
  /** Every competition name Betfair has listed, to choose from when matching a league by hand (GET only). */
  competitions?: string[];
  /** A saved list (e.g. InPlayGuru's), re-checked each time (GET only; missing on an older engine). */
  saved?: { savedAt: string; leagues: CoverageResult[] } | null;
}

/** The leagues your alerts came from, checked against Betfair's competitions. */
export function fetchCoverage(): Promise<CoverageReport> {
  return engineCall("/internal/betfair/coverage", "the Betfair coverage");
}

/** A pasted list of league names (e.g. InPlayGuru's), checked against Betfair's competitions. */
export function checkCoverage(names: string[], save = false): Promise<CoverageReport> {
  return engineCall("/internal/betfair/coverage", "the Betfair coverage", { method: "POST", body: { names, save }, timeoutMs: 30_000 });
}

// ---- Bets placed by hand, and results to review ----

/** Logs a bet placed by hand on a pick (odds as 5/2, evens or 3.5), or with clear, removes it. */
export function setManualBet(id: number, bet: { stake: string; odds: string } | null): Promise<{ ok: true }> {
  return engineCall("/internal/picks/manual-bet", "logging the bet", { method: "POST", body: bet ? { id, ...bet } : { id, clear: true } });
}

/** Results the alert's own tick disagrees with, still to review (Amend results). */
export async function fetchDiscrepancies(): Promise<LivePick[]> {
  return (await engineCall<{ picks: LivePick[] }>("/internal/picks/discrepancies", "the results to review")).picks.map(toAdminPick);
}

/** Accepts a reviewed result so it leaves the Needs review list. */
export function reviewResult(id: number, ok: boolean): Promise<{ ok: true }> {
  return engineCall("/internal/picks/review", "saving the review", { method: "POST", body: { id, ok } });
}

/** A sent pick with no bet on Betfair 3 minutes after it was sent. Mirrors UnplacedPick in the engine's betfair/unplaced.ts. */
export interface UnplacedPick {
  id: number;
  strategy: string;
  match: string;
  competition: string | null;
  sentAt: string;
  /** The likely reason, from what the engine found on Betfair. */
  reason: string;
  /** When the admin was notified, or null. */
  alertedAt: string | null;
  /** Betfair's name for the match when only a team's spelling differs: the pick can then be fixed and re-sent. */
  betfairEvent: string | null;
  /** Betfair's back price for the bet as sent, and the minimum odds sent with it. Missing on an older engine. */
  price?: number | null;
  minPrice?: number | null;
}

export interface UnplacedReport {
  afterMinutes: number;
  /** False when the Betfair bet check isn't set up, so nothing can be listed. */
  configured: boolean;
  picks: UnplacedPick[];
}

export function fetchUnplaced(): Promise<UnplacedReport> {
  return engineCall("/internal/betfair/unplaced", "picks not placed");
}

/** What the app shows for a strategy. Mirrors StrategyInfo in the engine's inplayguru/strategy-names.ts. */
export interface StrategyNameInfo {
  name: string;
  description: string;
  /** InPlayGuru's rules, in short. */
  trigger: string;
  /** The bet sent. */
  bet: string;
  /** True when the admin has changed the name or description. */
  custom: boolean;
}

/** Keyed by InPlayGuru's strategy name without its bracketed note, lower-cased. */
export function fetchStrategyNames(): Promise<{ names: Record<string, StrategyNameInfo> }> {
  return engineCall("/internal/strategy-names", "strategy names");
}

/** Changes a strategy's name and description; empty values go back to the default. */
export function saveStrategyName(key: string, name: string, description: string): Promise<{ names: Record<string, StrategyNameInfo> }> {
  return engineCall("/internal/strategy-names", "saving the strategy name", { method: "POST", body: { key, name, description } });
}

/** Adds Betfair's team spelling to Match names and sends a Not placed pick again under Betfair's event name. */
export function fixUnplaced(id: number): Promise<{ ok: true; added: string[]; sent: boolean; message: string }> {
  return engineCall("/internal/betfair/unplaced/fix", "fixing the pick", { method: "POST", body: { id } });
}

/** Clears reviewed picks from the Not placed list. */
export function clearUnplaced(ids: number[]): Promise<{ ok: true; cleared: number }> {
  return engineCall("/internal/betfair/unplaced/clear", "clearing picks not placed", { method: "POST", body: { ids } });
}

export interface PushState {
  /** The key a browser subscribes with. */
  publicKey: string;
  devices: Array<{ label: string | null; createdAt: string }>;
}

export function fetchPushState(): Promise<PushState> {
  return engineCall("/internal/push", "notification settings");
}

export function pushAction(
  action: "subscribe" | "unsubscribe" | "test",
  body: Record<string, unknown> = {},
): Promise<{ ok?: boolean; reached?: number }> {
  return engineCall(`/internal/push/${action}`, action === "test" ? "the test notification" : "notification settings", { method: "POST", body, timeoutMs: 20_000 });
}

// ---- Direct betting (engine: betfair/direct.ts) ----

export type DirectMode = "off" | "shadow" | "live";
export interface DirectSettings {
  mode: DirectMode;
  since: string;
  maxSpreadPct: number;
  minOverround: number;
  maxOverround: number;
  strategyLimits: Record<string, { maxSpreadPct?: number; maxOverround?: number }>;
  cancelUnmatchedSeconds: number;
  dailyStakeLimit: number;
  acceptBelowPct: number;
  webhook: "record" | "use";
}
export interface DirectBetRow {
  pickId: number;
  mode: "shadow" | "live";
  state: "waiting" | "placing" | "placed" | "shadow" | "skipped" | "failed";
  createdAt: string;
  updatedAt: string;
  strategy: string;
  eventName: string;
  marketType: string;
  selectionName: string;
  stake: number;
  minPrice: number | null;
  price: number | null;
  bestLay: number | null;
  overround: number | null;
  betId: string | null;
  sizeMatched: number | null;
  avgPrice: number | null;
  cancelled: number | null;
  reason: string | null;
  home: string | null;
  away: string | null;
  /** What the betting software's own bet on this pick matched (Shadow comparison). */
  feedMatched: number | null;
  feedOdds: number | null;
}
export interface DirectStatus {
  settings: DirectSettings;
  effectiveMode: DirectMode;
  readiness: {
    betfairLinked: boolean;
    liveAllowed: boolean;
    loginOk: boolean | null;
    error: string | null;
    available: number | null;
    exposure: number | null;
    delayedKey: boolean | null;
    checkedAt: string | null;
  };
  stakedToday: number;
  sendingOn: boolean;
  strategies: string[];
  bets: DirectBetRow[];
  webhooks: Array<{ receivedAt: string; signatureVerified: boolean; understood: boolean; summary: string | null; sample: string }>;
  webhooksTotal: number;
}

export const fetchDirect = () => engineCall<DirectStatus>("/internal/direct", "direct betting", { timeoutMs: 15000 });
export const saveDirect = (patch: Partial<DirectSettings>) => engineCall<DirectStatus>("/internal/direct", "direct betting", { method: "PUT", body: patch, timeoutMs: 15000 });

/** Every direct betting record as CSV (for the Excel download). */
export async function fetchDirectExport(): Promise<string> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${baseUrl}/internal/direct/export`, { headers: { Authorization: `Bearer ${internalKey}` }, cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`Engine responded ${res.status} for the direct betting download.`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/** Every pick ever received as CSV (the Settings page's Excel download). */
export async function fetchPicksExport(): Promise<string> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${baseUrl}/internal/picks/export`, { headers: { Authorization: `Bearer ${internalKey}` }, cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`Engine responded ${res.status} for the picks download.`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}
