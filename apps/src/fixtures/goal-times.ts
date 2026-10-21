/**
 * GOAL TIMES for the admin's Trade Log: when the goals in each alert's match were scored, from API-Football.
 *
 *   link    each new alert is matched to an API-Football fixture from the Schedule tab's daily pull (schedule_fixtures,
 *           already stored: costs no calls), by both team names and the kick-off the alert implies.
 *   fetch   once a linked match should be over, its goal minutes come from /fixtures?ids=… (20 matches per call).
 *
 * BUDGET: API-Football's free plan allows 100 calls a day. The daily pull uses about 4. This module makes at most
 * MAX_CALLS_PER_DAY (30) a UK day, counted in the setting "goal_times_usage", and none at all once API-Football says
 * fewer than KEEP_SPARE (40) calls are left today. So the two together stay well under 100 whatever happens.
 *
 * Read only: nothing here touches betting.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { judgeExchange } from "../betfair/exchange";
import { kickoffAt } from "../inplayguru/bet-feed";
import { log } from "../server/log";
import { addDays, ukDateOf } from "./daily-pull";
import { settleFromApiFootball } from "./result-fallback";

const BASE = "https://v3.football.api-sports.io";
export const MAX_CALLS_PER_DAY = 30;
const KEEP_SPARE = 40;
const USAGE_KEY = "goal_times_usage";
const PER_CALL = 20;
const CALLS_PER_RUN = 3;
/** A match is fetched this long after kick-off (time for 90 minutes, half-time and stoppages). */
const FETCH_AFTER_MS = 2.5 * 3_600_000;
/** An unfinished match (delayed, extra time) is tried again after this, at most MAX_ATTEMPTS times. */
const RETRY_AFTER_MS = 2 * 3_600_000;
const MAX_ATTEMPTS = 3;
const RUN_EVERY_MS = 20 * 60_000;
const FINISHED = new Set(["FT", "AET", "PEN"]);
const GAVE_UP = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pick_fixture (
    pick_id     INTEGER PRIMARY KEY,
    fixture_id  INTEGER,
    kickoff_ts  INTEGER,
    linked_at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fixture_goals (
    fixture_id  INTEGER PRIMARY KEY,
    status      TEXT,
    goals_json  TEXT NOT NULL DEFAULT '[]',
    score       TEXT,
    fetched_at  TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0
  );
`;

const ready = new WeakSet<EngineDb>();
function sql(db: EngineDb) {
  if (!ready.has(db)) {
    db.sqlite.exec(SCHEMA);
    ready.add(db);
  }
  return db.sqlite;
}

/** One goal: the minute (with any added time), which side it counts for, and how it was scored. */
export interface GoalEvent {
  minute: number;
  extra: number | null;
  side: "home" | "away";
  kind: "goal" | "penalty" | "own goal";
}

// ---------------------------------------------------------------------------------------------------- linking

/** When the alert's match kicked off, as far as the alert tells: pre-match picks say; in-play ones count back. */
export function estimatedKickoff(p: LivePick): number {
  const pre = kickoffAt(p);
  if (pre !== null) return pre;
  const at = Date.parse(p.messageAt ?? p.firstSeenAt);
  const m = p.minute ?? 0;
  return at - (m + (m > 45 ? 15 : 0)) * 60_000;
}

/** Links unlinked picks of the last 36 hours to fixtures. Picks with no match are marked, so they're not tried again. */
export function linkPicks(db: EngineDb, now = new Date()): number {
  const s = sql(db);
  const done = new Set((s.prepare(`SELECT pick_id FROM pick_fixture`).all() as Array<{ pick_id: number }>).map((r) => r.pick_id));
  const picks = db.listLivePicks(1000, { from: new Date(now.getTime() - 36 * 3_600_000).toISOString(), to: now.toISOString() }).filter((p) => !done.has(p.id) && p.home && p.away);
  if (picks.length === 0) return 0;
  const today = ukDateOf(now);
  const fixtures = [addDays(today, -1), today, addDays(today, 1)].flatMap((d) => db.getScheduleDay(d).fixtures);
  if (fixtures.length === 0) return 0;
  const ins = s.prepare(`INSERT OR REPLACE INTO pick_fixture (pick_id, fixture_id, kickoff_ts, linked_at) VALUES (?, ?, ?, ?)`);
  let linked = 0;
  for (const p of picks) {
    const ko = estimatedKickoff(p);
    const near = fixtures.filter((f) => Math.abs(f.timestamp * 1000 - ko) <= 3 * 3_600_000);
    const judged = judgeExchange(p.home!, p.away!, near.map((f) => ({ id: String(f.id), name: `${f.home} v ${f.away}` })));
    const f = judged.eventId ? near.find((x) => String(x.id) === judged.eventId) : undefined;
    // Both names, or one name and a kick-off within half an hour of what the alert implies.
    const ok = f && (judged.result === "on" || (judged.result === "nameDiffers" && Math.abs(f.timestamp * 1000 - ko) <= 30 * 60_000));
    if (ok) {
      ins.run(p.id, f!.id, f!.timestamp, now.toISOString());
      linked++;
    } else if (now.getTime() - ko > 4 * 3_600_000) {
      ins.run(p.id, null, null, now.toISOString()); // no fixture found: stop trying
    }
  }
  return linked;
}

// ---------------------------------------------------------------------------------------------------- fetching

interface Usage {
  day: string;
  calls: number;
  /** API-Football's own count of calls left today, from its last reply. */
  remaining: number | null;
}

export function goalTimesUsage(db: EngineDb, now = new Date()): Usage {
  try {
    const u = JSON.parse(db.getSetting(USAGE_KEY) ?? "") as Usage;
    if (u.day === ukDateOf(now)) return u;
  } catch {
    // new day
  }
  return { day: ukDateOf(now), calls: 0, remaining: null };
}

/** Turns API-Football's events into goals, sides checked against the final score (own goals can be listed either way). */
export function goalsFrom(
  events: Array<{ type?: string; detail?: string; time?: { elapsed?: number | null; extra?: number | null }; team?: { id?: number } }>,
  homeId: number | undefined,
  finalScore: { home: number | null; away: number | null },
): GoalEvent[] {
  const goals: GoalEvent[] = [];
  for (const e of events) {
    if (e.type !== "Goal" || /missed/i.test(e.detail ?? "") || typeof e.time?.elapsed !== "number") continue;
    const kind: GoalEvent["kind"] = /own/i.test(e.detail ?? "") ? "own goal" : /penalty/i.test(e.detail ?? "") ? "penalty" : "goal";
    goals.push({ minute: e.time.elapsed, extra: e.time.extra ?? null, side: e.team?.id === homeId ? "home" : "away", kind });
  }
  const count = (side: "home" | "away") => goals.filter((g) => g.side === side).length;
  if (finalScore.home !== null && finalScore.away !== null && (count("home") !== finalScore.home || count("away") !== finalScore.away)) {
    for (const g of goals) if (g.kind === "own goal") g.side = g.side === "home" ? "away" : "home";
  }
  return goals.sort((a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0));
}

/** Matches whose goals are due: linked, should be over, and not finished fetching. */
function due(db: EngineDb, now: Date): number[] {
  const rows = sql(db)
    .prepare(
      `SELECT DISTINCT pf.fixture_id AS id, g.status, g.fetched_at, g.attempts
       FROM pick_fixture pf LEFT JOIN fixture_goals g ON g.fixture_id = pf.fixture_id
       WHERE pf.fixture_id IS NOT NULL AND pf.kickoff_ts * 1000 <= ?
       ORDER BY pf.kickoff_ts DESC`,
    )
    .all(now.getTime() - FETCH_AFTER_MS) as Array<{ id: number; status: string | null; fetched_at: string | null; attempts: number | null }>;
  return rows
    .filter((r) => {
      if (r.status && (FINISHED.has(r.status) || GAVE_UP.has(r.status))) return false;
      if ((r.attempts ?? 0) >= MAX_ATTEMPTS) return false;
      return !r.fetched_at || now.getTime() - Date.parse(r.fetched_at) >= RETRY_AFTER_MS;
    })
    .map((r) => r.id);
}

/** One pass: fetches due matches' goals, within the day's budget. Returns how many calls it made. */
export async function fetchGoalTimes(db: EngineDb, apiKey: string, now = new Date(), fetcher: typeof fetch = fetch): Promise<number> {
  const ids = due(db, now);
  let calls = 0;
  const save = sql(db).prepare(
    `INSERT INTO fixture_goals (fixture_id, status, goals_json, score, fetched_at, attempts) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(fixture_id) DO UPDATE SET status = excluded.status, goals_json = excluded.goals_json, score = excluded.score,
       fetched_at = excluded.fetched_at, attempts = fixture_goals.attempts + 1`,
  );
  for (let i = 0; i < ids.length && calls < CALLS_PER_RUN; i += PER_CALL) {
    const usage = goalTimesUsage(db, now);
    if (usage.calls >= MAX_CALLS_PER_DAY || (usage.remaining !== null && usage.remaining < KEEP_SPARE)) break;
    const batch = ids.slice(i, i + PER_CALL);
    // Counted before the call, so a failure still counts against the day.
    db.setSetting(USAGE_KEY, JSON.stringify({ ...usage, calls: usage.calls + 1 }));
    calls++;
    const res = await fetcher(`${BASE}/fixtures?ids=${batch.join("-")}`, { headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(30_000) });
    const left = Number(res.headers.get("x-ratelimit-requests-remaining"));
    if (Number.isFinite(left)) db.setSetting(USAGE_KEY, JSON.stringify({ ...goalTimesUsage(db, now), remaining: left }));
    const body = (await res.json().catch(() => ({}))) as {
      errors?: unknown;
      response?: Array<{
        fixture?: { id?: number; status?: { short?: string } };
        teams?: { home?: { id?: number } };
        goals?: { home?: number | null; away?: number | null };
        events?: Parameters<typeof goalsFrom>[0];
      }>;
    };
    const errs = body.errors && typeof body.errors === "object" ? Object.values(body.errors as Record<string, unknown>) : [];
    if (!res.ok || errs.length > 0) throw new Error(`API-Football: ${errs.map(String).join("; ") || `HTTP ${res.status}`}`);
    const at = now.toISOString();
    for (const f of body.response ?? []) {
      if (typeof f.fixture?.id !== "number") continue;
      const score = { home: f.goals?.home ?? null, away: f.goals?.away ?? null };
      const goals = goalsFrom(f.events ?? [], f.teams?.home?.id, score);
      save.run(f.fixture.id, f.fixture.status?.short ?? null, JSON.stringify(goals), score.home !== null && score.away !== null ? `${score.home}-${score.away}` : null, at);
    }
  }
  return calls;
}

/** The goals of a pick's match, when known. */
export function goalsForPick(db: EngineDb, pickId: number): { linked: "no" | "notFound" | "yes"; status: string | null; goals: GoalEvent[] | null } {
  const r = sql(db)
    .prepare(`SELECT pf.fixture_id, g.status, g.goals_json FROM pick_fixture pf LEFT JOIN fixture_goals g ON g.fixture_id = pf.fixture_id WHERE pf.pick_id = ?`)
    .get(pickId) as { fixture_id: number | null; status: string | null; goals_json: string | null } | undefined;
  if (!r) return { linked: "no", status: null, goals: null };
  if (r.fixture_id === null) return { linked: "notFound", status: null, goals: null };
  let goals: GoalEvent[] | null = null;
  try {
    goals = r.goals_json ? (JSON.parse(r.goals_json) as GoalEvent[]) : null;
  } catch {
    goals = null;
  }
  return { linked: "yes", status: r.status, goals: r.status ? goals : null };
}

let running = false;

/** Every 20 minutes: link new alerts (free), fetch due goal times (within the budget), then settle alerts left without a result. */
export function startGoalTimes(db: EngineDb, apiKey: string): void {
  const run = async () => {
    if (running) return;
    running = true;
    try {
      linkPicks(db);
      const calls = await fetchGoalTimes(db, apiKey);
      if (calls > 0) log.info(`Goal times: ${calls} API-Football call${calls === 1 ? "" : "s"} (${goalTimesUsage(db).calls} of ${MAX_CALLS_PER_DAY} today).`);
      // Alerts InPlayGuru never sent a full-time result for: settled from the scores just fetched (no extra calls).
      settleFromApiFootball(db);
    } catch (err) {
      log.warn(`Goal times: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), 4 * 60_000).unref?.();
  setInterval(() => void run(), RUN_EVERY_MS).unref?.();
}
