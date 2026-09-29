/**
 * Reads the day's fixtures from API-Football (api-sports.io).
 *
 * One request (`/fixtures?date=YYYY-MM-DD&timezone=Europe/London`) returns every
 * match on that UK day across every league, so a daily pull costs one request per
 * day fetched. The free plan allows 100 requests a day and 10 a minute.
 *
 * The key is read from API_FOOTBALL_KEY by the caller and sent in the
 * x-apisports-key header. It is never logged.
 */

const BASE_URL = "https://v3.football.api-sports.io";

/** One match as the Schedule tab shows it. */
export interface ScheduleFixture {
  id: number;
  /** Kick-off, ISO with the UK offset, e.g. "2026-09-29T19:45:00+01:00". */
  kickoff: string;
  /** Kick-off as Unix seconds. */
  timestamp: number;
  /** API-Football's short status: NS (not started), PST (postponed), CANC, TBD, FT, ... */
  status: string;
  statusLong: string;
  leagueId: number;
  league: string;
  /** Country name as API-Football gives it; "World" for international competitions. */
  country: string;
  round: string | null;
  home: string;
  away: string;
  venue: string | null;
}

export interface FixturePullResult {
  fixtures: ScheduleFixture[];
  /** Requests left today on the API-Football plan, when the reply says. */
  remainingToday: number | null;
}

interface ApiFixture {
  fixture?: {
    id?: number;
    date?: string;
    timestamp?: number;
    status?: { short?: string; long?: string };
    venue?: { name?: string | null };
  };
  league?: { id?: number; name?: string; country?: string; round?: string | null };
  teams?: { home?: { name?: string }; away?: { name?: string } };
}

interface ApiReply {
  errors?: unknown;
  results?: number;
  response?: ApiFixture[];
}

function errorText(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) return errors.length ? errors.map(String).join("; ") : null;
  if (typeof errors === "object") {
    const entries = Object.entries(errors as Record<string, unknown>);
    return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join("; ") : null;
  }
  return String(errors);
}

export async function fetchFixturesForDate(apiKey: string, ukDate: string): Promise<FixturePullResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${BASE_URL}/fixtures?date=${encodeURIComponent(ukDate)}&timezone=Europe/London`, {
      headers: { "x-apisports-key": apiKey },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API-Football responded ${res.status}.`);

    const remainingHeader = res.headers.get("x-ratelimit-requests-remaining");
    const remaining = remainingHeader === null ? NaN : Number(remainingHeader);

    const body = (await res.json()) as ApiReply;
    // API-Football reports problems (bad key, plan limits, quota used up) in `errors` with a 200 status.
    const problem = errorText(body.errors);
    if (problem) throw new Error(`API-Football said: ${problem}`);

    const fixtures: ScheduleFixture[] = [];
    for (const item of body.response ?? []) {
      const f = item.fixture;
      const id = f?.id;
      const home = item.teams?.home?.name?.trim();
      const away = item.teams?.away?.name?.trim();
      if (typeof id !== "number" || !f?.date || !home || !away) continue;
      fixtures.push({
        id,
        kickoff: f.date,
        timestamp: typeof f.timestamp === "number" && f.timestamp > 0 ? f.timestamp : Math.floor(Date.parse(f.date) / 1000),
        status: f.status?.short ?? "NS",
        statusLong: f.status?.long ?? "Not Started",
        leagueId: item.league?.id ?? 0,
        league: item.league?.name?.trim() || "Unknown league",
        country: item.league?.country?.trim() || "Other",
        round: item.league?.round ?? null,
        home,
        away,
        venue: f.venue?.name ?? null,
      });
    }
    return { fixtures, remainingToday: Number.isFinite(remaining) ? remaining : null };
  } finally {
    clearTimeout(timeout);
  }
}
