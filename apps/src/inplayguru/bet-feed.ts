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
 *      be sent late.
 *   5. A daily limit on how many NEW picks can be handed over.
 *   6. Only markets whose exact code is known are sent. Corners are not.
 *   7. A stake must be set for the strategy, and it must not exceed the
 *      "highest stake allowed" ceiling. A strategy cannot be switched on
 *      without a stake.
 * A pick that fails any gate is simply left out and the reason is recorded so
 * the Sending page can show it.
 *
 * The feed says what to back and how much (the Size column). Price limits, loss
 * caps and the maximum liability stay in the betting software as the outer net.
 *
 * Once a pick has been handed over, its row is stored exactly as sent and every
 * later poll repeats that row unchanged. Changing a stake or a match-name fix
 * afterwards therefore can't make the betting software see a "new" tip for a
 * pick it already has, which could otherwise place a second bet.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";

export interface SendingSettings {
  /** Master switch. */
  enabled: boolean;
  /** Per-strategy switches, keyed by lower-case strategy name. Missing = off. */
  strategies: Record<string, boolean>;
  /** Stake in pounds per strategy, keyed by lower-case strategy name. Missing = cannot be sent. */
  stakes: Record<string, number>;
  /** Hard ceiling. A stake above this is never sent, whatever is saved. */
  maxStake: number;
  /** Picks older than this are never sent. */
  maxAgeMinutes: number;
  /** Most NEW picks handed over per UK day. */
  dailyCap: number;
  /** Market code and selection name used for Both Teams to Score. */
  bttsMarketType: string;
  bttsSelection: string;
  /** One "alert name = exchange name" per line, applied to each team name. */
  aliases: string;
}

export const DEFAULT_SENDING: SendingSettings = {
  enabled: false,
  strategies: {},
  stakes: {},
  maxStake: 5,
  maxAgeMinutes: 10,
  dailyCap: 30,
  bttsMarketType: "BOTH_TEAMS_TO_SCORE",
  bttsSelection: "Yes",
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
  return {
    enabled: raw.enabled === true,
    strategies,
    stakes,
    maxStake: clampInt(raw.maxStake, 1, 500, DEFAULT_SENDING.maxStake),
    maxAgeMinutes: clampInt(raw.maxAgeMinutes, 1, 60, DEFAULT_SENDING.maxAgeMinutes),
    dailyCap: clampInt(raw.dailyCap, 0, 500, DEFAULT_SENDING.dailyCap),
    bttsMarketType: cleanCode(raw.bttsMarketType, DEFAULT_SENDING.bttsMarketType),
    bttsSelection: cleanCode(raw.bttsSelection, DEFAULT_SENDING.bttsSelection),
    aliases: typeof raw.aliases === "string" ? raw.aliases.slice(0, 5000) : "",
  };
}

/** Applies a partial update from the admin page and saves the merged, validated result. */
export function saveSendingSettings(db: EngineDb, patch: Record<string, unknown>): SendingSettings {
  const current = getSendingSettings(db);
  const next: SendingSettings = { ...current, strategies: { ...current.strategies }, stakes: { ...current.stakes } };

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

export function toCsv(rows: FeedRow[]): string {
  const header = ["Provider", "MarketType", "SelectionName", "EventName", "BetType", "Size"].map(csvField).join(",");
  const lines = rows.map((r) =>
    [r.provider, r.marketType, r.selectionName, r.eventName, r.betType, r.stake.toFixed(2)].map(csvField).join(","),
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
    csv: toCsv([]),
    newlySent: 0,
    blockedReason,
  });

  const cutoff = now.getTime() - settings.maxAgeMinutes * 60 * 1000;
  const recent = db
    .listLivePicks(200)
    .filter((p) => new Date(p.firstSeenAt).getTime() >= cutoff)
    .sort((a, b) => a.id - b.id);

  if (!settings.enabled) {
    const r = empty("Sending is switched off.");
    r.skipped = recent.filter((p) => p.status !== "settled").map((p) => skip(p, "Sending is switched off."));
    return r;
  }

  const aliases = parseAliases(settings.aliases);
  const alias = (name: string) => aliases.get(name.trim().toLowerCase()) ?? name.trim();

  const today = ukDay.format(now);
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
    if (!settings.strategies[label.toLowerCase()]) {
      skipped.push(skip(p, "This strategy's switch is off."));
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

    // A pick that has already been handed over is repeated exactly as it was sent.
    if (alreadySent) {
      const frozen = parseFrozenRow(p);
      if (frozen) {
        rows.push(frozen);
        continue;
      }
    }

    let market: { marketType: string; selectionName: string } | null = null;
    if (p.market === "NEXT_GOAL") {
      market = overUnderMarket(p.detail?.targetLine ?? null);
      if (!market) {
        skipped.push(skip(p, "Could not work out the Over/Under line."));
        continue;
      }
    } else if (p.market === "BOTH_TEAMS_TO_SCORE") {
      market = { marketType: settings.bttsMarketType, selectionName: settings.bttsSelection };
    } else {
      skipped.push(skip(p, "This market can't be sent yet."));
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
    };
    rows.push(row);
    if (!alreadySent) toMark.push({ id: p.id, rowJson: JSON.stringify(row) });
  }

  if (opts.markSent) db.markSent(toMark);

  return { rows, skipped, csv: toCsv(rows), newlySent: toMark.length, blockedReason: null };
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
      return { pickId: p.id, provider: r.provider, marketType: r.marketType, selectionName: r.selectionName, eventName: r.eventName, betType: "BACK", stake: r.stake };
    }
  } catch {
    // fall through
  }
  return null;
}

function skip(p: LivePick, reason: string): FeedSkip {
  return { pickId: p.id, strategy: strategyLabel(p.strategy), match: `${p.home ?? "?"} v ${p.away ?? "?"}`, reason };
}

// The last time the betting software fetched the feed. Kept in memory only.
let lastFeedFetchAt: string | null = null;
export function noteFeedFetched(): void {
  lastFeedFetchAt = new Date().toISOString();
}
export function getLastFeedFetchAt(): string | null {
  return lastFeedFetchAt;
}
