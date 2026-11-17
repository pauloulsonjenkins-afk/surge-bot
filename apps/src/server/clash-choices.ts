/**
 * The clash chooser's Sim record (wired in 16 Nov 2026): for each pick the clash guard held back (bet-feed.ts notes it),
 * which side inplayguru/clash-choice.ts would have placed, from both strategies' records. Nothing is placed or changed:
 * the first bet to arrive still wins, as before. The record is there to judge the chooser against results first.
 *
 * Each side's record is its strategy's settled return per £1 (Live and Sim together) from the Strategies report, which is
 * kept warm (report-cache.ts) and worked out on the report worker when it is running.
 */
import type { EngineDb } from "../storage/engine-db";
import { chooseClash, type TrackRecord } from "../inplayguru/clash-choice";
import { strategyLabel } from "../inplayguru/bet-feed";
import { cachedReportVia } from "./report-cache";
import { log } from "./log";

type ReturnsByKey = (key: string) => TrackRecord | null;

/** Records from the Strategies report rows: { label, returns: { all: { counted|settled, roi } } }. */
export function recordsFromReport(body: Record<string, unknown>): ReturnsByKey {
  const rows = (body.strategies ?? []) as Array<{ label: string; returns?: { all?: { counted?: number; settled?: number; roi?: number | null } } | null }>;
  const byKey = new Map(rows.map((r) => [r.label.toLowerCase(), r.returns?.all ?? null]));
  return (key) => {
    const all = byKey.get(key);
    if (!all || all.roi === null || all.roi === undefined) return null;
    return { bets: all.counted ?? all.settled ?? 0, roi: all.roi };
  };
}

/**
 * Fills in the chooser's verdict for clashes not yet judged. Returns how many were. The Strategies report comes through
 * the report worker when it is running (17 Nov 2026: worked out here, it held the engine's thread for about 1 s every
 * 10 minutes).
 */
export async function fillClashChoices(db: EngineDb, recordOf?: ReturnsByKey, now = new Date()): Promise<number> {
  const open = db.listClashChoices({ unchosen: true });
  if (open.length === 0) return 0;
  const records = recordOf ?? recordsFromReport(await cachedReportVia(db, "strategies:null", "strategies", [null]));
  let n = 0;
  for (const c of open) {
    const pick = db.getLivePick(c.pickId);
    const against = db.getLivePick(c.againstId);
    if (!pick || !against) {
      db.setClashChoice(c.pickId, "first", "A pick is no longer stored.", now);
      continue;
    }
    const mine = records(strategyLabel(pick.strategy).toLowerCase());
    const theirs = records(strategyLabel(against.strategy).toLowerCase());
    const [back, lay] = c.pickSide === "back" ? [mine, theirs] : [theirs, mine];
    const choice = chooseClash(back, lay);
    db.setClashChoice(c.pickId, choice.side, choice.reason, now);
    log.info(
      `Clash choice (Sim, nothing changed): ${strategyLabel(pick.strategy)} (${c.pickSide}) against ${strategyLabel(against.strategy)}: would place ${choice.side === "first" ? "the first to arrive" : `the ${choice.side}`}. ${choice.reason}`,
    );
    n++;
  }
  return n;
}
