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
  } | null;
}

export async function fetchLivePicks(limit = 50): Promise<LivePick[]> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/live?limit=${limit}`, {
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

export async function fetchHitRateStats(days: number | null): Promise<HitRateStats> {
  const baseUrl = process.env.ENGINE_BASE_URL;
  const internalKey = process.env.ADMIN_INTERNAL_KEY;
  if (!baseUrl || !internalKey) {
    throw new Error("ENGINE_BASE_URL and ADMIN_INTERNAL_KEY must both be set on this component.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/internal/stats${days ? `?days=${days}` : ""}`, {
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

export interface SendingState {
  settings: SendingSettings;
  strategies: Array<{ label: string; market: string | null; enabled: boolean; stake: number | null }>;
  feedTokenConfigured: boolean;
  lastFeedFetchAt: string | null;
  preview: {
    rows: Array<{ pickId: number; provider: string; marketType: string; selectionName: string; eventName: string; stake: number }>;
    skipped: Array<{ pickId: number; strategy: string; match: string; reason: string }>;
    csv: string;
    blockedReason: string | null;
  };
}

async function sendingRequest(method: "GET" | "PUT", body?: Partial<SendingSettings>): Promise<SendingState> {
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

export async function removeStrategy(label: string): Promise<{ removed: number; keptBecauseSent: number }> {
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
      body: JSON.stringify({ label }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Engine responded ${res.status} when removing the strategy.`);
    return (await res.json()) as { removed: number; keptBecauseSent: number };
  } finally {
    clearTimeout(timeout);
  }
}

export const fetchSending = () => sendingRequest("GET");
export const saveSending = (patch: Partial<SendingSettings>) => sendingRequest("PUT", patch);
