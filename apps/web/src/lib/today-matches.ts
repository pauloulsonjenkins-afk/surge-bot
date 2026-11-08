/**
 * Today's matches from the Schedule (API-Football, pulled at 06:00 and 15:00 UK), counted for the top of Live: how many
 * are in play now and how many are still to kick off today. The pull doesn't follow the games, so its status is stale
 * once they start: "in play" is judged by the clock (kicked off within the last IN_PLAY_MS), and postponed, cancelled
 * or abandoned games never count.
 */
export const IN_PLAY_MS = 115 * 60_000;
const OFF = new Set(["PST", "CANC", "ABD", "AWD", "WO", "SUSP"]);
const DONE = new Set(["FT", "AET", "PEN"]);

export interface TodayMatchCounts {
  inPlay: number;
  toPlay: number;
  /** The next kick-off still to come today (ISO), or null. */
  nextKickoff: string | null;
}

export function countTodayMatches(fixtures: ReadonlyArray<{ kickoff: string; status: string }>, now: number): TodayMatchCounts {
  let inPlay = 0;
  let toPlay = 0;
  let next: number | null = null;
  for (const f of fixtures) {
    if (OFF.has(f.status)) continue;
    const t = Date.parse(f.kickoff);
    if (!Number.isFinite(t)) continue;
    if (t > now) {
      toPlay++;
      if (next === null || t < next) next = t;
    } else if (!DONE.has(f.status) && now - t < IN_PLAY_MS) inPlay++;
  }
  return { inPlay, toPlay, nextKickoff: next === null ? null : new Date(next).toISOString() };
}
