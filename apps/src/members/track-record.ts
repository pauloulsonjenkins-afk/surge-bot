/**
 * The Track Record: every house alert, graded automatically, in the open (for signed-in members; not public yet).
 *
 *   - Every settled alert of every strategy offered to members is listed, winners and losers alike. Nothing is picked.
 *   - Graded from the full-time score / the alert's result, as everywhere else; a result the admin amended is marked
 *     "amended". Alerts GoalBrew voided (abandoned, bad data) don't count, and the page says so.
 *   - Money is shown next to the hit rate (a good hit rate at short prices can still lose): a level £1 on every alert
 *     at its recorded price, after commission.
 *   - When a strategy's rules changed (RECORD_FROM), its figures count from that date, and the date is shown with the
 *     record from before it, so a fresh start can't hide anything.
 *   - "Why this fired" (why.ts) only on picks the member's access already shows in full.
 */
import type { EngineDb } from "../storage/engine-db";
import { RECORD_FROM } from "../storage/engine-db";
import { pickOdds } from "../server/pricing";
import { listCatalogue, memberStrategyKey, marketName } from "./catalogue";
import { hitRate, MoneyTally, type WinLoss } from "./house";
import { strategyAllowed } from "./permissions";
import { whyFired } from "./why";
import type { MemberContext } from "./service";

const PAGE = 50;

export interface RecordSummary extends WinLoss {
  /** Profit to £1 level stakes, after commission, over the priced alerts. */
  profit: number;
  roi: number | null;
  priced: number;
  avgOdds: number | null;
}

interface RecordStrategy {
  key: string;
  name: string;
  /** Since the rules last changed (or all time, when they never have). */
  current: RecordSummary;
  /** When the rules changed, and the record from before then; null when they never have. */
  changed: { at: string; before: RecordSummary } | null;
  firstAt: string | null;
}

interface RecordRow {
  id: number;
  at: string;
  strategyKey: string;
  strategyName: string;
  home: string | null;
  away: string | null;
  competition: string | null;
  minute: number | null;
  score: string | null;
  market: string | null;
  selection: string | null;
  odds: number | null;
  result: "hit" | "miss";
  ftScore: string | null;
  amended: boolean;
  /** Before this strategy's rules changed: shown, but not in its current figures. */
  beforeChange: boolean;
  /** £1 level stake, after commission; null without a price. */
  profit: number | null;
  why: string | null;
}

function summary(t: MoneyTally, wins: number, losses: number): RecordSummary {
  const m = t.result();
  return { wins, losses, hitRate: hitRate(wins, losses), profit: m.profit, roi: m.roi, priced: m.priced, avgOdds: m.avgOdds };
}

export function trackRecordView(db: EngineDb, ctx: MemberContext, opts: { strategy?: string; page?: number } = {}) {
  const commission = ctx.config.commissionPct / 100;
  const catalogue = new Map(listCatalogue(db, ctx.config).map((c) => [c.key, c]));
  const merges = db.getStrategyMerges();
  const acc = new Map<string, { now: MoneyTally; before: MoneyTally; w: [number, number]; bw: [number, number]; changedAt: string | null; firstAt: string | null }>();
  const rows: Array<{ id: number; key: string; at: string; before: boolean; profit: number | null; odds: number | null; result: "hit" | "miss" }> = [];

  // Oldest first, so the money tallies run in order; the list is shown newest first.
  const results = db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
  for (const r of results) {
    const key = memberStrategyKey(merges, r.strategy);
    if (!catalogue.has(key)) continue;
    // A fresh start is set on the strategy's own name (before any merge).
    const changedAt = RECORD_FROM[memberStrategyKey({}, r.strategy)] ?? RECORD_FROM[key] ?? null;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { now: new MoneyTally(), before: new MoneyTally(), w: [0, 0], bw: [0, 0], changedAt, firstAt: r.firstSeenAt }));
    if (changedAt && (!a.changedAt || changedAt > a.changedAt)) a.changedAt = changedAt;
    const before = changedAt !== null && r.firstSeenAt < changedAt;
    const won = r.result === "hit";
    (before ? a.bw : a.w)[won ? 0 : 1]++;
    const found = pickOdds(r, null);
    const profit = found ? (before ? a.before : a.now).add(1, found.odds, won, commission) : null;
    rows.push({ id: r.id, key, at: r.firstSeenAt, before, profit: profit === null ? null : Math.round(profit * 100) / 100, odds: found?.odds ?? null, result: r.result });
  }

  const strategies: RecordStrategy[] = [...acc.entries()]
    .map(([key, a]) => ({
      key,
      name: catalogue.get(key)!.name,
      current: summary(a.now, a.w[0], a.w[1]),
      changed: a.changedAt ? { at: a.changedAt, before: summary(a.before, a.bw[0], a.bw[1]) } : null,
      firstAt: a.firstAt,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const wanted = opts.strategy && catalogue.has(opts.strategy) ? opts.strategy : null;
  const list = rows.filter((r) => !wanted || r.key === wanted).reverse();
  const page = Math.max(0, Math.min(opts.page ?? 0, 1000));
  const shown: RecordRow[] = [];
  for (const r of list.slice(page * PAGE, page * PAGE + PAGE)) {
    const p = db.getLivePick(r.id);
    if (!p) continue;
    const name = catalogue.get(r.key)!.name;
    shown.push({
      id: r.id,
      at: p.messageAt ?? r.at,
      strategyKey: r.key,
      strategyName: name,
      home: p.home,
      away: p.away,
      competition: p.competition,
      minute: p.minute,
      score: p.goalsHome !== null && p.goalsAway !== null ? `${p.goalsHome}-${p.goalsAway}` : null,
      market: marketName(p.market),
      selection: p.selection,
      odds: r.odds,
      result: r.result,
      ftScore: p.ftScore,
      amended: p.resultOverridden,
      beforeChange: r.before,
      profit: r.profit,
      why: strategyAllowed(ctx.access, "viewSelections", r.key) ? whyFired(p) : null,
    });
  }

  return {
    strategies,
    rows: shown,
    page,
    more: list.length > (page + 1) * PAGE,
    total: list.length,
    commissionPct: ctx.config.commissionPct,
  };
}
