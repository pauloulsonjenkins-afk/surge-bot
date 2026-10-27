/**
 * The clash check before a strategy goes Live (added 24 Oct 2026): over the last 30 days, how often its picks were on
 * the same match as a pick from what is Live now (strategies and Golden slices switched Live, LAYs included), and how
 * the two bets would have related (inplayguru/clash.ts). "Cancels" are the ones the clash guard would now block.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { getSendingSettings, segmentBetFor, strategyLabel } from "../inplayguru/bet-feed";
import { clashOf, exposureOf, type ClashKind } from "../inplayguru/clash";
import { displayName } from "../inplayguru/strategy-names";

interface ClashRow {
  key: string;
  name: string;
  cancels: number;
  offsets: number;
  doubles: number;
  unrelated: number;
}

export interface ClashCheck {
  key: string;
  days: number;
  /** Its picks in the window, and how many shared a match with something Live now. */
  picks: number;
  shared: number;
  totals: Record<ClashKind, number>;
  /** By the Live strategy met, most clashes first. */
  against: ClashRow[];
}

const DAY_MS = 86_400_000;

export function clashCheck(db: EngineDb, strategyKey: string, now = new Date(), days = 30): ClashCheck {
  const key = strategyKey.toLowerCase();
  const settings = getSendingSettings(db);
  const keyOf = (p: LivePick) => strategyLabel(p.strategy).toLowerCase();
  const liveNow = (p: LivePick) => {
    if (!settings.enabled || keyOf(p) === key) return false;
    const seg = segmentBetFor(settings, p);
    return seg ? seg.cfg.live : settings.strategies[keyOf(p)] === true;
  };
  const picks = db.listLivePicks(10_000, { from: new Date(now.getTime() - days * DAY_MS).toISOString(), to: now.toISOString() }).filter((p) => !p.excluded && p.home && p.away);
  // A match is its teams on its day.
  const matchOf = (p: LivePick) => `${(p.home ?? "").toLowerCase()}|${(p.away ?? "").toLowerCase()}|${(p.messageAt ?? p.firstSeenAt).slice(0, 10)}`;
  const live = new Map<string, LivePick[]>();
  for (const p of picks) if (liveNow(p)) live.set(matchOf(p), [...(live.get(matchOf(p)) ?? []), p]);

  const mine = picks.filter((p) => keyOf(p) === key);
  const totals: Record<ClashKind, number> = { cancels: 0, offsets: 0, doubles: 0, unrelated: 0 };
  const rows = new Map<string, ClashRow>();
  let shared = 0;
  for (const p of mine) {
    const others = live.get(matchOf(p)) ?? [];
    if (others.length === 0) continue;
    shared++;
    for (const o of others) {
      const kind = clashOf(exposureOf(p), exposureOf(o));
      totals[kind]++;
      const k = keyOf(o);
      const row = rows.get(k) ?? { key: k, name: displayName(db, k), cancels: 0, offsets: 0, doubles: 0, unrelated: 0 };
      row[kind]++;
      rows.set(k, row);
    }
  }
  const weight = (r: ClashRow) => r.cancels * 1000 + r.offsets * 100 + r.doubles * 10 + r.unrelated;
  return { key, days, picks: mine.length, shared, totals, against: [...rows.values()].sort((a, b) => weight(b) - weight(a)) };
}
