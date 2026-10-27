/**
 * LAY stages: the same idea as Golden (golden.ts), for LAY groups (lay-groups.ts).
 *
 * STAGE, from the LAY group's own priced picks (NEXT_GOAL_LAY / HOME_WIN_LAY results):
 *   quiet            fewer than CANDIDATE_FROM (100) so far
 *   candidate        CANDIDATE_FROM+, in profit per £1 of liability (one notification)
 *   trial            TRIAL_FROM+ (300), in profit in BOTH halves of its record: a small Live trial is suggested
 *                    (1% liability, with a stop loss — never switched automatically; the admin's call)
 *   full             FULL_FROM+ (500), AND its own Live bets are in profit: full stake suggested
 *   not holding up   it reached candidate or further, but its last 30 priced picks lost more than 5% per £1
 * The strict loss rule applies at every stage from candidate on: lost at once on a bad last 30, and only regained
 * after 30 more picks back in profit. A notification goes out once per stage first reached, and once when it's lost.
 */
import type { EngineDb } from "../storage/engine-db";
import { isLivePlacement } from "../storage/engine-db";
import { strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { pricingInputs } from "./winloss";
import { layGroups, type LayGroup } from "../inplayguru/lay-groups";
import { sendPush } from "./push";
import { log } from "./log";

/** Below this many priced picks a LAY group is shown as still being watched, not yet a candidate. */
export const CANDIDATE_FROM = 100;
/** A small Live trial (1% liability, with a stop loss) is suggested from here, if in profit in both halves. */
export const TRIAL_FROM = 300;
/** Full stake is suggested from here, once its own Live bets are in profit too. */
export const FULL_FROM = 500;
/** Keeping a stage: the last `recent` priced picks may not lose more than `worstRoi`; once lost, `regainFrom` picks
 * after the loss back above `regainRoi` win it back. */
const KEEP = { recent: 30, worstRoi: -0.05, regainFrom: 30, regainRoi: 0 };
const BADGES_KEY = "lay_badges";
const STAGE_RANK = { candidate: 1, trial: 2, full: 3 } as const;
type ToldStage = keyof typeof STAGE_RANK;

type LayBadgeStatus = "quiet" | "candidate" | "trial" | "full" | "not holding up";

interface Row {
  at: string;
  stake: number;
  profit: number;
  live: boolean;
}

function tally(rows: Array<{ stake: number; profit: number }>): { n: number; roi: number | null } {
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
  /** The highest stage ever notified for (never goes down, even while the stage is currently lost). */
  stage: ToldStage | null;
  /** When it last fell to "not holding up"; cleared once it's back to a real stage. */
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

/** The stage its picks alone would earn, ignoring the last-30 and re-proving rules (see layGroupRecords). */
function rawStage(n: number, roi: number | null, older: { roi: number | null }, newer: { roi: number | null }, ownLive: { n: number; roi: number | null }): LayBadgeStatus {
  if (n < CANDIDATE_FROM) return "quiet";
  if (!(roi !== null && roi > 0)) return "not holding up";
  if (n >= TRIAL_FROM) {
    const bothHalves = older.roi !== null && older.roi > 0 && newer.roi !== null && newer.roi > 0;
    if (bothHalves && n >= FULL_FROM && ownLive.n > 0 && ownLive.roi !== null && ownLive.roi > 0) return "full";
    if (bothHalves) return "trial";
  }
  return "candidate";
}

/** Every LAY group's record and stage, from its own priced picks (NEXT_GOAL_LAY / HOME_WIN_LAY results). */
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
    (rowsOf.get(key) ?? rowsOf.set(key, []).get(key)!).push({ at: r.firstSeenAt, stake: priced.stake, profit: priced.profit, live: isLivePlacement(r.placement) });
  }
  for (const list of rowsOf.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  return groups.map((g: LayGroup) => {
    const key = g.header.toLowerCase();
    const rows = rowsOf.get(key) ?? [];
    const all = tally(rows);
    const mid = rows.length > 0 ? rows[Math.floor(rows.length / 2)]!.at : null;
    const older = mid === null ? { roi: null } : tally(rows.filter((r) => r.at < mid));
    const newer = mid === null ? { roi: null } : tally(rows.filter((r) => r.at >= mid));
    const recent = tally(rows.slice(-KEEP.recent));
    const ownLive = tally(rows.filter((r) => r.live));
    const was = held[key];
    const lostAt = was?.lostAt ?? null;
    const regain = lostAt ? tally(rows.filter((r) => r.at >= lostAt)) : null;

    const raw = rawStage(all.n, all.roi, older, newer, ownLive);
    let status: LayBadgeStatus = raw;
    let why: string | null = null;
    if (raw !== "quiet") {
      if (raw === "not holding up") {
        why = `${pctOf(all.roi)} per £1 of liability since it started`;
      } else if (recent.n >= KEEP.recent && recent.roi !== null && recent.roi < KEEP.worstRoi) {
        status = "not holding up";
        why = `its last ${recent.n} picks are ${pctOf(recent.roi)} per £1`;
      } else if (regain && !(regain.n >= KEEP.regainFrom && regain.roi !== null && regain.roi > KEEP.regainRoi)) {
        status = "not holding up";
        why = `re-proving after losing its stage: ${regain.n} of ${KEEP.regainFrom} picks, ${pctOf(regain.roi)} per £1 (needs to be in profit)`;
      }
    }
    return { header: g.header, key, lays: g.lays, n: all.n, roi: all.roi, halves: [older.roi, newer.roi], recent, status, why };
  });
}

const STAGE_MESSAGE: Record<ToldStage, (name: string) => { title: string; body: string }> = {
  candidate: (name) => ({ title: "LAY candidate", body: `${name} has made ${CANDIDATE_FROM}+ priced picks in profit per £1 of liability — worth a look.` }),
  trial: (name) => ({
    title: "LAY: small Live trial suggested",
    body: `${name} has made ${TRIAL_FROM}+ priced picks, in profit in both halves of its record. Worth a small Live trial — 1% liability, with a stop loss — the choice is yours.`,
  }),
  full: (name) => ({
    title: "LAY: full stake suggested",
    body: `${name} has made ${FULL_FROM}+ priced picks and its own Live bets are in profit. Worth its full stake now — the choice is yours.`,
  }),
};

/**
 * Hourly: notes each LAY group's stage. Reaching a new stage (candidate, trial, full) is told once, ever; losing the
 * current stage on a bad last 30 is told once too, until it's won back.
 */
export async function monitorLayBadges(db: EngineDb, now = new Date()): Promise<void> {
  const first = db.getSetting(BADGES_KEY) === null;
  const held = badges(db);
  const records = layGroupRecords(db, now);
  const tell: Array<{ title: string; body: string; tag: string }> = [];
  for (const r of records) {
    const was = held[r.key] ?? { stage: null };
    const name = r.lays ? `${displayName(db, r.lays)}: ${r.header}` : r.header;
    const wasRank = was.stage ? STAGE_RANK[was.stage] : 0;
    if (r.status === "not holding up") {
      if (was.stage !== null) {
        if (!first && !was.lostAt) tell.push({ title: "LAY stage lost", body: `${name} has slipped: ${r.why ?? "it stopped being profitable"}. It needs ${KEEP.regainFrom} new picks back in profit to be considered again.`, tag: `lay-stage-${r.key}` });
        held[r.key] = { stage: was.stage, lostAt: now.toISOString() };
      } else held[r.key] = { stage: null };
    } else if (r.status !== "quiet") {
      const rank = STAGE_RANK[r.status];
      if (rank > wasRank) {
        for (let lvl = wasRank + 1; lvl <= rank; lvl++) {
          const stageName = (Object.keys(STAGE_RANK) as ToldStage[]).find((n) => STAGE_RANK[n] === lvl)!;
          if (!first) tell.push({ ...STAGE_MESSAGE[stageName](name), tag: `lay-stage-${stageName}-${r.key}` });
        }
      }
      held[r.key] = { stage: rank > wasRank ? r.status : was.stage };
    }
  }
  db.setSetting(BADGES_KEY, JSON.stringify(held));
  for (const t of tell) {
    log.info(`LAY stage: ${t.body}`);
    await sendPush(db, { title: t.title, body: t.body, url: "/more/admin/strategies", tag: t.tag });
  }
}
