/**
 * Price check: did a strategy get a better price than the market a little later?
 *
 * Beating the later price, again and again, is the earliest dependable sign that a strategy knows something the market
 * hasn't priced yet, long before hundreds of results prove it. For every pick whose match is on Betfair, this reads the
 * price of the same bet again:
 *   - in-play picks: 2 and 5 minutes after the alert;
 *   - pre-match picks (First Half Goal): at kick-off, the true "closing" price.
 * Edge = alert price / later price - 1. Positive = the alert's price was better than the market's later price.
 *
 * In-play goal prices drift out on their own as minutes pass without a goal, so every in-play pick looks a little worse
 * later. The fair comparison there is against the average of all picks at the same check ("vs typical").
 * A later price under 1.06 means a goal has already settled the bet (or the market was suspended), so those checks
 * are kept out of the figures.
 *
 * READ ONLY: it uses the same reader as the bet check (listMarketCatalogue, listMarketBook).
 */
import type { EngineDb } from "../storage/engine-db";
import type { BetfairReader } from "./exchange";
import { exchangeNamer, feedMarket, getSendingSettings, kickoffAt, strategyLabel } from "../inplayguru/bet-feed";

export type CheckKind = "t2" | "t5" | "ko";

/** At most this many Betfair look-ups per poll, so the bet check stays quick. */
const PER_POLL = 6;
const MIN = 60_000;
/** When each check is due after the alert (in-play), and how long it stays worth doing. */
const INPLAY: Array<{ kind: CheckKind; after: number; until: number }> = [
  { kind: "t2", after: 2 * MIN, until: 6 * MIN },
  { kind: "t5", after: 5 * MIN, until: 10 * MIN },
];
/** Below this the bet has as good as won already (a goal went in), so it says nothing about the price. */
const SETTLED_PRICE = 1.06;

function alertTime(p: { messageAt: string | null; firstSeenAt: string }): number {
  const t = p.messageAt ? Date.parse(p.messageAt) : NaN;
  return Number.isFinite(t) ? t : Date.parse(p.firstSeenAt);
}

/** The checks due now for a pick, in order. */
export function dueChecks(p: Parameters<typeof kickoffAt>[0], now: number, done: Set<string>): CheckKind[] {
  const ko = kickoffAt(p);
  if (ko !== null) {
    return now >= ko - 2 * MIN && now <= ko + 3 * MIN && !done.has(`${p.id}:ko`) ? ["ko"] : [];
  }
  const at = alertTime(p);
  return INPLAY.filter((c) => now >= at + c.after && now <= at + c.until && !done.has(`${p.id}:${c.kind}`)).map((c) => c.kind);
}

/** One poll's worth of price checks. Never throws: a failed look-up is tried again next poll while it's still due. */
export async function runPriceChecks(db: EngineDb, reader: Pick<BetfairReader, "checkBet">, now = Date.now()): Promise<number> {
  const settings = getSendingSettings(db);
  const namer = exchangeNamer(db);
  const picks = db
    .listLivePicks(200)
    .filter((p) => !p.excluded && p.exchange === "on" && p.exchangeEventId && p.exchangeOdds !== null && now - alertTime(p) < 6 * 3_600_000);
  if (picks.length === 0) return 0;
  const done = db.priceChecksDone(picks.map((p) => p.id));
  let calls = 0;
  for (const p of picks) {
    for (const kind of dueChecks(p, now, done)) {
      if (calls >= PER_POLL) return calls;
      const market = feedMarket(p, settings, namer);
      if ("error" in market) continue;
      calls++;
      const bet = await reader.checkBet(p.exchangeEventId!, market.marketType, market.selectionName).catch(() => null);
      if (!bet) continue;
      db.savePriceCheck({ pickId: p.id, kind, strategy: strategyLabel(p.strategy), entry: p.exchangeOdds!, later: bet.price, at: new Date(now).toISOString() });
      done.add(`${p.id}:${kind}`);
    }
  }
  return calls;
}

export interface PriceCheckRow {
  strategy: string;
  kind: CheckKind;
  picks: number;
  /** Average of alert price / later price - 1, as a percentage. */
  edge: number;
  avgEntry: number;
  avgLater: number;
}

export interface PriceCheckReport {
  days: number;
  rows: PriceCheckRow[];
  /** The all-strategies average for each check, the baseline for "vs typical". */
  typical: Partial<Record<CheckKind, number>>;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** The figures by strategy and check, from the last `days` days. Checks where a goal had already settled the bet are left out. */
export function priceCheckReport(db: EngineDb, days = 30, now = new Date()): PriceCheckReport {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const usable = db.listPriceChecks(since).filter((c) => c.later !== null && c.later >= SETTLED_PRICE && c.entry > 1);
  const groups = new Map<string, typeof usable>();
  for (const c of usable) {
    const k = `${c.strategy.toLowerCase()}|${c.kind}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
  }
  const rows: PriceCheckRow[] = [...groups.values()].map((list) => ({
    strategy: list[0]!.strategy,
    kind: list[0]!.kind,
    picks: list.length,
    edge: round((100 * list.reduce((s, c) => s + c.entry / c.later! - 1, 0)) / list.length),
    avgEntry: round(list.reduce((s, c) => s + c.entry, 0) / list.length, 2),
    avgLater: round(list.reduce((s, c) => s + c.later!, 0) / list.length, 2),
  }));
  const typical: Partial<Record<CheckKind, number>> = {};
  for (const kind of ["t2", "t5", "ko"] as const) {
    const list = usable.filter((c) => c.kind === kind);
    if (list.length) typical[kind] = round((100 * list.reduce((s, c) => s + c.entry / c.later! - 1, 0)) / list.length);
  }
  return { days, rows: rows.sort((a, b) => a.strategy.localeCompare(b.strategy) || a.kind.localeCompare(b.kind)), typical };
}
