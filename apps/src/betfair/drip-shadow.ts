/**
 * DRIP SHADOW TEST (29 Oct 2026, the owner's request): a silent, read-only record of what a drip of staggered back
 * orders would have done on the four half-time strategies (Away Super Fav 1 Goal / 2 Goals, OG 1 Goal SH / OG 2 SHG).
 *
 * For each alert from those strategies, this keeps reading the best back and lay price of the very bet the alert is for
 * (every poll, about 45 seconds, for WATCH_MS after the alert). Nothing is placed, nothing is shown on any page and no
 * setting changes: it is only a table of prices. server/drip-shadow-report.ts later replays a ladder of resting back
 * orders against those prices and the goal times (fixtures/goal-times.ts) and says what it would have made or lost.
 *
 * A resting back order at price P is counted as matched once the best price available to back reaches P or more: by
 * then a layer is offering P or better, which the resting order would have matched first. Prices are read about every
 * 45 seconds, so a spike between two reads is missed and fills are slightly under-counted.
 *
 * Betfair calls: one market look-up per pick (the first time), then one price read per pick per poll, for 30 minutes.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import type { BetfairReader } from "./exchange";
import { exchangeNamer, feedMarket, getSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { ukDateOf } from "../server/uk-time";

/** The strategies being watched (lower case, as strategyLabel gives them). */
export const DRIP_STRATEGIES = ["away super fav 1 goal", "away super fav 2 goals", "og 1 goal sh", "og 2 shg"];
/** Recording stops after this UK day (the report is due on 15 Nov 2026). */
export const DRIP_LAST_DAY = "2026-11-16";
/** Each alert's price is read for this long. */
const WATCH_MS = 30 * 60_000;
/** At most this many Betfair reads per poll, so the bet check stays quick. */
const PER_POLL = 8;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS drip_shadow_picks (
    pick_id      INTEGER PRIMARY KEY,
    strategy     TEXT NOT NULL,
    entry        REAL NOT NULL,
    alert_at     TEXT NOT NULL,
    minute       INTEGER,
    market_id    TEXT NOT NULL,
    selection_id INTEGER NOT NULL,
    started_at   TEXT NOT NULL,
    finished     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS drip_shadow_ticks (
    pick_id INTEGER NOT NULL,
    at      TEXT NOT NULL,
    back    REAL,
    lay     REAL,
    status  TEXT
  );
  CREATE INDEX IF NOT EXISTS drip_shadow_ticks_pick ON drip_shadow_ticks (pick_id);
`;

const ready = new WeakSet<EngineDb>();
export function dripSql(db: EngineDb) {
  if (!ready.has(db)) {
    db.sqlite.exec(SCHEMA);
    ready.add(db);
  }
  return db.sqlite;
}

export function isDripStrategy(strategy: string): boolean {
  return DRIP_STRATEGIES.includes(strategyLabel(strategy).toLowerCase());
}

// ---------------------------------------------------------------------------------------------------- the ladder

/** Betfair's price steps: 0.01 up to 2, 0.02 to 3, 0.05 to 4, 0.1 to 6, 0.2 to 10, 0.5 to 20, 1 to 30, 2 to 50, 5 to 100, 10 beyond. */
function tickAt(price: number): number {
  if (price < 2) return 0.01;
  if (price < 3) return 0.02;
  if (price < 4) return 0.05;
  if (price < 6) return 0.1;
  if (price < 10) return 0.2;
  if (price < 20) return 0.5;
  if (price < 30) return 1;
  if (price < 50) return 2;
  if (price < 100) return 5;
  return 10;
}

/** A price moved up by `n` Betfair ticks (capped at 1000). */
export function moveTicks(price: number, n: number): number {
  let p = price;
  for (let i = 0; i < n && p < 1000; i++) p = Math.round((p + tickAt(p)) * 100) / 100;
  return p;
}

export interface LadderConfig {
  /** The stake of each leg, first to last. */
  stakes: number[];
  /** How many ticks above the one before each later leg sits. 0 = every leg at the alert price, taken at once (no drip). */
  gapTicks: number;
}

/** The £1 / £2.50 pattern the group describes: six legs. */
export const GROUP_STAKES = [1, 2.5, 1, 2.5, 1, 2.5];

export interface Tick {
  atMs: number;
  back: number | null;
}

export interface LegFill {
  price: number;
  stake: number;
  filled: boolean;
  atMs: number | null;
}

/**
 * The legs of a ladder against the prices that followed an alert. The first leg is taken at the alert price at once; each
 * later leg rests `gapTicks` above the one before and is matched at its own price at the first read where the best back
 * price reaches it. Reads from the first goal on (when known) cannot match anything: the bet has won or the price has collapsed.
 */
export function simulateLadder(entry: number, alertMs: number, ticks: Tick[], goalMs: number | null, cfg: LadderConfig): LegFill[] {
  return cfg.stakes.map((stake, k) => {
    if (k === 0 || cfg.gapTicks === 0) return { price: entry, stake, filled: true, atMs: alertMs };
    const price = moveTicks(entry, k * cfg.gapTicks);
    const hit = ticks.find((t) => t.atMs >= alertMs && (goalMs === null || t.atMs < goalMs) && t.back !== null && t.back >= price);
    return { price, stake, filled: hit !== undefined, atMs: hit?.atMs ?? null };
  });
}

/** What a ladder made or lost once the bet is known to have won or lost: the filled legs only. Commission comes off winnings. */
export function settleLadder(legs: LegFill[], won: boolean, commission: number): { staked: number; profit: number; legs: number } {
  let staked = 0;
  let profit = 0;
  let n = 0;
  for (const l of legs) {
    if (!l.filled) continue;
    n++;
    staked += l.stake;
    profit += won ? l.stake * (l.price - 1) * (1 - commission) : -l.stake;
  }
  return { staked, profit, legs: n };
}

// ---------------------------------------------------------------------------------------------------- recording

function alertMsOf(p: Pick<LivePick, "messageAt" | "firstSeenAt">): number {
  const t = p.messageAt ? Date.parse(p.messageAt) : NaN;
  return Number.isFinite(t) ? t : Date.parse(p.firstSeenAt);
}

/** One poll: reads the price of each watched alert's bet and keeps it. Never throws; returns the Betfair reads made. */
export async function runDripShadow(db: EngineDb, reader: Pick<BetfairReader, "checkBet" | "quote">, now = Date.now()): Promise<number> {
  if (ukDateOf(new Date(now)) > DRIP_LAST_DAY) return 0;
  const picks = db
    .listLivePicks(200)
    .filter((p) => isDripStrategy(p.strategy) && !p.excluded && p.exchange === "on" && p.exchangeEventId && p.exchangeOdds !== null && now - alertMsOf(p) < WATCH_MS && now >= alertMsOf(p));
  if (picks.length === 0) return 0;
  const s = dripSql(db);
  const settings = getSendingSettings(db);
  const namer = exchangeNamer(db);
  const find = s.prepare(`SELECT market_id, selection_id, finished FROM drip_shadow_picks WHERE pick_id = ?`);
  const addPick = s.prepare(
    `INSERT OR IGNORE INTO drip_shadow_picks (pick_id, strategy, entry, alert_at, minute, market_id, selection_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const addTick = s.prepare(`INSERT INTO drip_shadow_ticks (pick_id, at, back, lay, status) VALUES (?, ?, ?, ?, ?)`);
  const finish = s.prepare(`UPDATE drip_shadow_picks SET finished = 1 WHERE pick_id = ?`);
  let calls = 0;
  for (const p of picks) {
    let row = find.get(p.id) as { market_id: string; selection_id: number; finished: number } | undefined;
    if (row?.finished) continue;
    if (calls >= PER_POLL) break;
    if (!row) {
      const market = feedMarket(p, settings, namer);
      if ("error" in market) continue;
      calls++;
      const b = await reader.checkBet(p.exchangeEventId!, market.marketType, market.selectionName).catch(() => null);
      if (!b || b.status !== "ok" || !b.marketId || b.selectionId === undefined) continue;
      addPick.run(p.id, strategyLabel(p.strategy).toLowerCase(), p.exchangeOdds, new Date(alertMsOf(p)).toISOString(), p.minute, b.marketId, b.selectionId, new Date(now).toISOString());
      row = { market_id: b.marketId, selection_id: b.selectionId, finished: 0 };
    }
    if (calls >= PER_POLL) break;
    calls++;
    const q = await reader.quote(row.market_id, row.selection_id).catch(() => null);
    if (!q) continue;
    addTick.run(p.id, new Date(now).toISOString(), q.back, q.lay, q.marketStatus === "CLOSED" ? "CLOSED" : (q.runnerStatus ?? q.marketStatus));
    if (q.marketStatus === "CLOSED") finish.run(p.id);
  }
  return calls;
}
