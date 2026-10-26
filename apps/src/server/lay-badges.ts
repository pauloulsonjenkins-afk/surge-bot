/**
 * LAY badges: the same idea as Golden (golden.ts), for LAY groups (lay-groups.ts).
 *
 * A LAY group is "proved" once it has PROVE_FROM (50) priced picks, making +3% or more per £1 of liability in BOTH
 * halves of its record (older and newer) — not just overall, since a group that only works in one half is likely
 * luck, same as the Golden finder's own test for a new idea. It keeps the badge on the same strict rule as Golden:
 * lost at once if its last 30 picks lose more than 5% per £1, only won back after 30 more at +3% or better.
 *
 * One notification when a group is first proved (with a "Put Live" suggestion — real money stays the admin's call),
 * and one when it loses the badge.
 */
import type { EngineDb } from "../storage/engine-db";
import { strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { pricingInputs } from "./winloss";
import { layGroups, type LayGroup } from "../inplayguru/lay-groups";
import { sendPush } from "./push";
import { log } from "./log";

export const PROVE_FROM = 50;
export const KEEP = { recent: 30, worstRoi: -0.05, regainFrom: 30, regainRoi: 0.03 };
const BADGES_KEY = "lay_badges";

export type LayBadgeStatus = "candidate" | "proved" | "not holding up";

interface Row {
  at: string;
  stake: number;
  profit: number;
}

function tally(rows: Row[]): { n: number; roi: number | null } {
  const staked = rows.reduce((t, r) => t + r.stake, 0);
  return { n: rows.length, roi: staked > 0 ? rows.reduce((t, r) => t + r.profit, 0) / staked : null };
}

export interface LayGroupRecord {
  header: string;
  key: string;
  lays: string | null;
  n: number;
  roi: number | null;
  /** The older and newer half of the record (null until there are picks in that half). */
  halves: [number | null, number | null];
  recent: { n: number; roi: number | null };
  status: LayBadgeStatus;
  why: string | null;
}

interface Badge {
  proved: boolean;
  lostAt?: string;
}
function badges(db: EngineDb): Record<string, Badge> {
  try {
    return JSON.parse(db.getSetting(BADGES_KEY) ?? "{}") as Record<string, Badge>;
  } catch {
    return {};
  }
}

const pctOf = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`);

/** Every LAY group's record and badge status, from its own priced picks (NEXT_GOAL_LAY / HOME_WIN_LAY results). */
export function layGroupRecords(db: EngineDb, now = new Date()): LayGroupRecord[] {
  const { price } = pricingInputs(db);
  const held = badges(db);
  const groups = layGroups(db);
  const rowsOf = new Map<string, Row[]>();
  for (const r of db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")) {
    if (r.market !== "NEXT_GOAL_LAY" && r.market !== "HOME_WIN_LAY") continue;
    const { priced } = price(r);
    if (priced.kind !== "priced") continue;
    const key = strategyLabel(r.strategy).toLowerCase();
    (rowsOf.get(key) ?? rowsOf.set(key, []).get(key)!).push({ at: r.firstSeenAt, stake: priced.stake, profit: priced.profit });
  }
  for (const list of rowsOf.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  return groups.map((g: LayGroup) => {
    const key = g.header.toLowerCase();
    const rows = rowsOf.get(key) ?? [];
    const all = tally(rows);
    const mid = rows.length > 0 ? rows[Math.floor(rows.length / 2)]!.at : null;
    const older = mid === null ? null : tally(rows.filter((r) => r.at < mid));
    const newer = mid === null ? null : tally(rows.filter((r) => r.at >= mid));
    const recent = tally(rows.slice(-KEEP.recent));
    const was = held[key];
    const lostAt = was?.lostAt ?? null;
    const regain = lostAt ? tally(rows.filter((r) => r.at >= lostAt)) : null;

    const bothHalves = older !== null && newer !== null && older.roi !== null && older.roi >= 0.03 && newer.roi !== null && newer.roi >= 0.03;
    let status: LayBadgeStatus = "proved";
    let why: string | null = null;
    if (all.n < PROVE_FROM) status = "candidate";
    else if (!(all.roi !== null && all.roi >= 0.03 && bothHalves)) {
      status = "not holding up";
      why = `${pctOf(all.roi)} per £1 of liability since it started`;
    } else if (recent.n >= KEEP.recent && recent.roi !== null && recent.roi < KEEP.worstRoi) {
      status = "not holding up";
      why = `its last ${recent.n} picks are ${pctOf(recent.roi)} per £1`;
    } else if (regain && !(regain.n >= KEEP.regainFrom && regain.roi !== null && regain.roi >= KEEP.regainRoi)) {
      status = "not holding up";
      why = `re-proving after losing the badge: ${regain.n} of ${KEEP.regainFrom} picks, ${pctOf(regain.roi)} per £1 (needs ${pctOf(KEEP.regainRoi)})`;
    }
    return { header: g.header, key, lays: g.lays, n: all.n, roi: all.roi, halves: [older?.roi ?? null, newer?.roi ?? null], recent, status, why };
  });
}

/** Hourly: notifies once when a LAY group proves itself, and once when it loses the badge (same rule as Golden). */
export async function monitorLayBadges(db: EngineDb, now = new Date()): Promise<void> {
  const first = db.getSetting(BADGES_KEY) === null;
  const held = badges(db);
  const records = layGroupRecords(db, now);
  const tell: Array<{ title: string; body: string; tag: string }> = [];
  for (const r of records) {
    const was = held[r.key];
    const name = r.lays ? `${displayName(db, r.lays)}: ${r.header}` : r.header;
    if (r.status === "proved") {
      if (!first && !was?.proved)
        tell.push({
          title: was?.lostAt ? "LAY proved again" : "LAY group proved",
          body: `${name} has ${was?.lostAt ? "won its badge back" : "proved itself"}: ${PROVE_FROM}+ picks at +3% or better per £1 of liability, in both halves. Worth putting Live — the stake and switch are yours to set.`,
          tag: `lay-badge-${r.key}`,
        });
      held[r.key] = { proved: true };
    } else if (r.status === "not holding up") {
      if (was?.proved) {
        held[r.key] = { proved: false, lostAt: now.toISOString() };
        if (!first) tell.push({ title: "LAY badge lost", body: `${name} has lost its badge: ${r.why ?? "it stopped beating the rule"}. It has to prove itself again on new picks.`, tag: `lay-badge-${r.key}` });
      } else held[r.key] = { proved: false, ...(was?.lostAt ? { lostAt: was.lostAt } : {}) };
    }
  }
  db.setSetting(BADGES_KEY, JSON.stringify(held));
  for (const t of tell) {
    log.info(`LAY badge: ${t.body}`);
    await sendPush(db, { title: t.title, body: t.body, url: "/more/admin/strategies", tag: t.tag });
  }
}
