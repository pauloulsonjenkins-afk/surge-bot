/**
 * FootballBin predictions (15 Nov 2026), for the Live tab's featured match. A free public endpoint (no key) with
 * Premier League and Champions League pre-match predictions: half-time and full-time score, next scorer, corners.
 *
 * It is only ever shown when it is current. On 15 Nov 2026 it held a single matchweek, from 10-12 Oct, all marked
 * finished, every prediction at the same 75 confidence, so a match is used only if it has not finished and kicks off
 * between three hours ago and two days ahead. Today that is nothing, and the slot on Live stays empty. Nothing sent
 * to the endpoint but a league name. Read only: no prediction changes a bet, a stake or a setting.
 */
const ENDPOINT = "https://ru7m5svay1.execute-api.eu-central-1.amazonaws.com/prod/mcp";
const LEAGUES = ["premier_league", "champions_league"] as const;
const CACHE_MS = 30 * 60_000;
const BEHIND_MS = 3 * 3_600_000;
const AHEAD_MS = 48 * 3_600_000;

export interface Prediction {
  home: string;
  away: string;
  kickoff: string;
  league: string;
  /** "2:1", "1:0", "Home,Saka", "6:4" as the service gives them. */
  fullTime: string | null;
  halfTime: string | null;
  nextGoal: string | null;
  corners: string | null;
  confidence: number | null;
}

interface RawMatch {
  home_team?: string;
  away_team?: string;
  kickoff_time?: string;
  status?: string;
  predictions?: Array<{ type?: string; value?: string; confidence?: number }>;
}

/** The service's matches as predictions worth showing at `now`: not finished, close to kick-off. */
export function currentPredictions(league: string, matches: RawMatch[], now = Date.now()): Prediction[] {
  const out: Prediction[] = [];
  for (const m of matches) {
    const ko = Date.parse(m.kickoff_time ?? "");
    if (!m.home_team || !m.away_team || !Number.isFinite(ko)) continue;
    if ((m.status ?? "").toLowerCase() === "finished") continue;
    if (ko < now - BEHIND_MS || ko > now + AHEAD_MS) continue;
    const get = (type: string) => m.predictions?.find((p) => p.type === type);
    out.push({
      home: m.home_team,
      away: m.away_team,
      kickoff: new Date(ko).toISOString(),
      league,
      fullTime: get("Full Time Result")?.value ?? null,
      halfTime: get("Half Time Result")?.value ?? null,
      nextGoal: get("Next Goal")?.value ?? null,
      corners: get("Corner Count")?.value ?? null,
      confidence: get("Full Time Result")?.confidence ?? null,
    });
  }
  return out;
}

async function fetchLeague(league: string): Promise<RawMatch[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_match_predictions", arguments: { league } } }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { result?: { isError?: boolean; structuredContent?: { matches?: RawMatch[] } } };
  return body.result?.isError ? [] : (body.result?.structuredContent?.matches ?? []);
}

let cache: { at: number; list: Prediction[] } | null = null;

/** Current predictions across both leagues, kept for half an hour. Any failure is an empty list: this is only ever extra. */
export async function getPredictions(now = Date.now()): Promise<Prediction[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.list;
  const list: Prediction[] = [];
  for (const league of LEAGUES) {
    try {
      list.push(...currentPredictions(league, await fetchLeague(league), now));
    } catch {
      // The service being down or slow must never touch the Live page.
    }
  }
  cache = { at: now, list };
  return list;
}
