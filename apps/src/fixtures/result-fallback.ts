/**
 * RESULTS FROM API-FOOTBALL when InPlayGuru's full-time edit never comes: an alert still without a result four hours
 * after kick-off is settled from the final score goal-times.ts already fetched for its match (no extra API calls).
 *
 * Only when it's safe:
 *   - the alert was linked to the fixture by both team names in order, or one name and the kick-off (goal-times.ts);
 *   - API-Football calls the match finished in normal time ("FT": after extra time or penalties the score isn't the
 *     90-minute one Betfair settles on);
 *   - the final score is at least the score in the alert, side by side (else it's another match);
 *   - the bet is one a score decides (not First Half Corner Race); First Half Goal needs the half-time score, worked
 *     out from the goal minutes when they add up to the final score.
 * The alert's text is kept as InPlayGuru sent it; the score is stored with score_source "api-football". A full-time
 * edit that arrives later replaces it, and a pick with a result set by hand is never touched.
 */
import type { EngineDb } from "../storage/engine-db";
import { EDGE_CHAT, withScoreSummary } from "../storage/engine-db";
import { parseAlert } from "../inplayguru/parse-alert";
import type { GoalEvent } from "./goal-times";
import { log } from "../server/log";

/** How long after kick-off InPlayGuru's own full-time edit is waited for. */
const WAIT_AFTER_KICKOFF_MS = 4 * 3_600_000;
const SOURCE = "api-football";

/** The half-time score from the goal minutes, or null when they don't add up to the final score. */
export function halfTimeFrom(goals: GoalEvent[], ft: [number, number]): string | null {
  const home = goals.filter((g) => g.side === "home");
  const away = goals.filter((g) => g.side === "away");
  if (home.length !== ft[0] || away.length !== ft[1]) return null;
  const first = (list: GoalEvent[]) => list.filter((g) => g.minute <= 45).length;
  return `${first(home)}-${first(away)}`;
}

/** One pass: settles every alert that qualifies. Returns how many were settled. */
export function settleFromApiFootball(db: EngineDb, now = new Date()): number {
  let rows: Array<{ id: number; raw_text: string; goals_home: number | null; goals_away: number | null; score: string; goals_json: string }>;
  try {
    rows = db.sqlite
      .prepare(
        `SELECT p.id, p.raw_text, p.goals_home, p.goals_away, g.score, g.goals_json
         FROM live_picks p
         JOIN pick_fixture pf ON pf.pick_id = p.id
         JOIN fixture_goals g ON g.fixture_id = pf.fixture_id
         WHERE p.ft_score IS NULL AND p.result IS NULL AND p.result_override IS NULL AND p.excluded = 0
           AND p.chat_id <> ? AND g.status = 'FT' AND g.score IS NOT NULL AND pf.kickoff_ts * 1000 <= ?`,
      )
      .all(EDGE_CHAT, now.getTime() - WAIT_AFTER_KICKOFF_MS) as typeof rows;
  } catch {
    return 0; // goal-times.ts hasn't made its tables yet
  }
  let settled = 0;
  for (const r of rows) {
    const m = r.score.match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const ft: [number, number] = [Number(m[1]), Number(m[2])];
    // Fewer goals than the alert already showed: not this match.
    if ((r.goals_home !== null && ft[0] < r.goals_home) || (r.goals_away !== null && ft[1] < r.goals_away)) continue;
    let goals: GoalEvent[] = [];
    try {
      goals = JSON.parse(r.goals_json) as GoalEvent[];
    } catch {
      goals = [];
    }
    const parsed = parseAlert(withScoreSummary(r.raw_text, r.score, halfTimeFrom(goals, ft)));
    if (parsed.market === "FIRST_HALF_CORNERS" || parsed.resultSource !== "score") continue;
    if (db.settleFromScore(r.id, parsed, SOURCE)) {
      settled++;
      log.info(`Result from API-Football for pick ${r.id} (${parsed.home} v ${parsed.away}): ${r.score}, ${parsed.result}.`);
    }
  }
  return settled;
}
