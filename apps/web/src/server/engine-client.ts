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
export interface LivePick {
  id: number;
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
  flags: string[];
  detail: {
    stats: Record<string, [number, number]>;
    positions: string | null;
    lastGoal: string | null;
    matched: number | null;
    strikeRate: number | null;
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
  flags: string[];
  detail: {
    stats: Record<string, [number, number]>;
    positions: string | null;
    lastGoal: string | null;
    matched: number | null;
    strikeRate: number | null;
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
    flags: p.flags,
    detail: p.detail
      ? {
          stats: p.detail.stats,
          positions: p.detail.positions,
          lastGoal: p.detail.lastGoal,
          matched: p.detail.matched,
          strikeRate: p.detail.strikeRate,
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
}

export async function fetchHitRateStats(days: number | null, strategy: string | null = null): Promise<HitRateStats> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const query = new URLSearchParams();
    if (days) query.set("days", String(days));
    if (strategy) query.set("strategy", strategy);
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
  maxStake: number;
  maxAgeMinutes: number;
  dailyCap: number;
  bttsMarketType: string;
  bttsSelection: string;
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
  strategies: Array<{ label: string; market: string | null; enabled: boolean; stake: number | null; alerts?: number; sent?: number; stopLoss: StopLossStatus | null }>;
  feedTokenConfigured: boolean;
  lastFeedFetchAt: string | null;
  /** The User-Agent of the last feed fetch, to spot fetchers that aren't the betting software. */
  lastFeedFetcher?: string | null;
  preview: {
    rows: Array<{ pickId: number; provider: string; marketType: string; selectionName: string; eventName: string; stake: number }>;
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
  hiddenFromResults?: number;
  ignoring?: boolean;
}

export async function removeStrategy(label: string, ignoreFuture = false): Promise<RemoveStrategyResult> {
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
      body: JSON.stringify({ label, ignoreFuture }),
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
}
/** One line on the Profit and loss table and the strategy graph (strategies merged on the Strategies page appear once). */
export interface WinLossReported {
  key: string;
  label: string;
  members: string[];
}
export interface WinLossState {
  today: string;
  settings: WinLossSettings;
  maxStake: number;
  strategies: WinLossStrategy[];
  /** Missing only while the engine is still on an older version. */
  reported?: WinLossReported[];
  periods: { d1: WinLossPeriod; d7: WinLossPeriod; mtd: WinLossPeriod; ytd: WinLossPeriod };
  series: { d1: WinLossPoint[]; d7: WinLossPoint[]; mtd: WinLossPoint[]; ytd: WinLossPoint[] };
}
export interface WinLossPatch {
  commission?: number;
  assumedOdds?: Record<string, number | null>;
  expenditure?: { enabled?: boolean; monthly?: number; startMonth?: string };
}

async function winLossRequest(method: "GET" | "PUT", body?: WinLossPatch): Promise<WinLossState> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${baseUrl}/internal/winloss`, {
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

export const fetchWinLoss = () => winLossRequest("GET");
export const saveWinLoss = (patch: WinLossPatch) => winLossRequest("PUT", patch);

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

export async function fetchPerformanceCells(days: number | null): Promise<EnginePerformanceCell[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/performance${days ? `?days=${days}` : ""}`, {
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
}

/** What can be changed on one league. Mirrors LeaguePatch in the engine's engine-db.ts. */
export interface LeaguePatch {
  hidden?: boolean;
  reset?: boolean;
  country?: string | null;
  tier?: number | null;
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
  alerts: number;
  hits: number;
  misses: number;
  sent: number;
  lastAlertAt: string;
  mergedInto: string | null;
  sendingOn: boolean;
  stake: number | null;
}

export interface AdminStrategies {
  strategies: AdminStrategy[];
  /** Strategies whose new alerts are being ignored. */
  ignored: string[];
}

export async function fetchAdminStrategies(): Promise<AdminStrategies> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/strategies`, {
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
