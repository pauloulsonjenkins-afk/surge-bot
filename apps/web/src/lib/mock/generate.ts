import { BOTS, League, LEAGUES, OpenPosition, Timeframe, Trade, TradeOutcome } from "@/domain/dashboard";
import { pick, randInt, randRange, seededRandom } from "./rng";

const TEAMS: Record<League, string[]> = {
  "Premier League": ["Arsenal", "Liverpool", "Man City", "Aston Villa", "Newcastle", "Brighton"],
  Bundesliga: ["Bayern", "Leverkusen", "Dortmund", "Stuttgart", "Leipzig", "Frankfurt"],
  "Serie A": ["Inter", "Juventus", "Milan", "Napoli", "Roma", "Atalanta"],
  "La Liga": ["Real Madrid", "Barcelona", "Girona", "Atletico", "Sociedad", "Betis"],
  "Ligue 1": ["PSG", "Monaco", "Brest", "Lille", "Nice", "Lens"],
};

const WINDOW_MS: Record<Timeframe, number> = {
  "1D": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

/** Number of buckets a timeframe is chopped into for time-series charts. */
export const BUCKET_COUNT: Record<Timeframe, number> = { "1D": 24, "7D": 7, "1M": 30 };

function stableNow(): number {
  // Round to the minute so re-renders within a session don't drift the window.
  return Math.floor(Date.now() / 60000) * 60000;
}

/** The [start, end) bounds used for a given timeframe + offset (0 = current, 1 = prior window). */
export function getWindow(timeframe: Timeframe, offset: 0 | 1 = 0): { start: number; end: number } {
  const windowMs = WINDOW_MS[timeframe];
  const now = stableNow();
  const end = now - offset * windowMs;
  return { start: end - windowMs, end };
}

/**
 * Leagues/bots deliberately idle in the current window, so the empty-state
 * paths in the UI are exercised by realistic-looking gaps rather than only
 * by a hand-built fixture. Ligue 1 has no matches inside "today"; the
 * break-even hedge bot hasn't fired yet this week.
 */
function isLeagueIdle(league: League, timeframe: Timeframe, offset: number): boolean {
  return league === "Ligue 1" && timeframe === "1D" && offset === 0;
}
/**
 * Distinct from a paused bot (which never trades): this is an *active*
 * strategy that simply hasn't fired in the current window, so the bot
 * performance chart's empty-row state gets exercised for a live bot too,
 * not only for the permanently-paused one.
 */
function isBotIdle(botId: string, timeframe: Timeframe, offset: number): boolean {
  return botId === "late-surge" && timeframe === "1D" && offset === 0;
}

function makeOutcome(rand: () => number): TradeOutcome {
  const r = rand();
  if (r < 0.46) return "win";
  if (r < 0.52) return "void";
  return "loss";
}

function makeTrade(rand: () => number, league: League, botId: string, at: number, idx: number): Trade {
  const outcome = makeOutcome(rand);
  const stake = Math.round(randRange(rand, 8, 40) * 2) / 2;
  const odds = randRange(rand, 1.6, 3.4);
  const pnl =
    outcome === "win" ? Math.round(stake * (odds - 1) * 100) / 100 : outcome === "loss" ? -stake : 0;
  const points = outcome === "win" ? Math.round(stake * 0.6) : outcome === "loss" ? -Math.round(stake * 0.2) : 0;
  const teams = TEAMS[league];
  const home = pick(rand, teams);
  let away = pick(rand, teams);
  while (away === home) away = pick(rand, teams);

  return {
    id: `${league}-${botId}-${at}-${idx}`,
    fixture: `${home} vs ${away}`,
    league,
    botId,
    settledAt: at,
    stake,
    pnl,
    points,
    outcome,
  };
}

/** offset 0 = the current window; offset 1 = the equivalent window immediately before it (for trend %). */
export function generateTrades(timeframe: Timeframe, offset: 0 | 1 = 0): Trade[] {
  const rand = seededRandom(`trades:${timeframe}:${offset}`);
  const { start: windowStart, end: windowEnd } = getWindow(timeframe, offset);

  const slots = BUCKET_COUNT[timeframe];
  const slotMs = (windowEnd - windowStart) / slots;

  const activeBots = BOTS.filter((b) => b.status === "active");
  const trades: Trade[] = [];

  for (let s = 0; s < slots; s++) {
    const slotStart = windowStart + s * slotMs;
    for (const league of LEAGUES) {
      if (isLeagueIdle(league, timeframe, offset)) continue;
      // Fewer trades per slot on the 1D view (hourly) than on 7D/1M (daily).
      const maxPerSlot = timeframe === "1D" ? 1 : timeframe === "7D" ? 3 : 2;
      const count = randInt(rand, 0, maxPerSlot);
      for (let i = 0; i < count; i++) {
        const eligibleBots = activeBots.filter((b) => !isBotIdle(b.id, timeframe, offset));
        if (eligibleBots.length === 0) continue;
        const bot = pick(rand, eligibleBots);
        const at = Math.round(slotStart + rand() * slotMs);
        trades.push(makeTrade(rand, league, bot.id, at, trades.length));
      }
    }
  }

  return trades.sort((a, b) => a.settledAt - b.settledAt);
}

/** Currently-open bets, independent of the selected timeframe — feeds Active Exposure. */
export function generateOpenPositions(): OpenPosition[] {
  const rand = seededRandom("open-positions");
  const now = stableNow();
  const activeBots = BOTS.filter((b) => b.status === "active");
  const count = randInt(rand, 2, 6);

  return Array.from({ length: count }, (_, i) => {
    const league = pick(rand, LEAGUES);
    const bot = pick(rand, activeBots);
    const teams = TEAMS[league];
    const home = pick(rand, teams);
    let away = pick(rand, teams);
    while (away === home) away = pick(rand, teams);
    return {
      id: `open-${i}`,
      fixture: `${home} vs ${away}`,
      league,
      botId: bot.id,
      stake: Math.round(randRange(rand, 10, 50) * 2) / 2,
      openedAt: now - randInt(rand, 1, 40) * 60000,
    };
  });
}
