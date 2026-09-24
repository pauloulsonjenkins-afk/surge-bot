/**
 * Dev-only sanity check for the mock data pipeline — prints what each
 * timeframe's summary/series/league/bot derivations produce, and confirms
 * repeated calls are deterministic (so the UI doesn't jitter on refetch).
 * Run with: npm run verify:mock-data
 */
import { generateTrades, generateOpenPositions, getWindow } from "../src/lib/mock/generate";
import { deriveSummary, deriveSeries, deriveLeagueBreakdown, deriveBotPerformance } from "../src/lib/mock/derive";
import { Timeframe } from "../src/domain/dashboard";

const timeframes: Timeframe[] = ["1D", "7D", "1M"];

for (const tf of timeframes) {
  const trades = generateTrades(tf, 0);
  const prevTrades = generateTrades(tf, 1);
  const openPositions = generateOpenPositions();
  const summary = deriveSummary(trades, prevTrades, openPositions);
  const { start, end } = getWindow(tf, 0);
  const series = deriveSeries(trades, tf, start, end);
  const leagues = deriveLeagueBreakdown(trades, prevTrades);
  const bots = deriveBotPerformance(trades, tf, start, end, undefined, prevTrades);

  console.log(`\n=== ${tf} ===`);
  console.log("trade count:", trades.length, "| prev-period trade count:", prevTrades.length);
  console.log("summary:", JSON.stringify(summary));
  console.log(
    "series: points=",
    series.length,
    "first=",
    JSON.stringify(series[0]),
    "last=",
    JSON.stringify(series[series.length - 1])
  );
  console.log("leagues:");
  for (const l of leagues) console.log("  ", JSON.stringify(l));
  console.log("bots:");
  for (const b of bots)
    console.log(
      "  ",
      JSON.stringify({
        name: b.bot.name,
        status: b.bot.status,
        trades: b.trades,
        pnl: b.totalPnl,
        roi: b.roi,
        winRate: b.winRate,
        changePct: b.changePct,
      })
    );
}

console.log("\n=== open positions (live, timeframe-independent) ===");
console.log(JSON.stringify(generateOpenPositions()));

// Determinism check: same key => identical output across repeated calls.
const a = generateTrades("7D", 0);
const b = generateTrades("7D", 0);
console.log("\ndeterminism check (7D called twice):", JSON.stringify(a) === JSON.stringify(b) ? "PASS identical" : "FAIL differs");
