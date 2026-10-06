/**
 * Every pick ever received, one row each, as a CSV file for Excel (Settings page: "Download every pick"). Built for
 * analysis in pivot tables: when the alert came (date, weekday, hour), which strategy, Live or Sim and how it was bet,
 * the match and every stat the alert carried, the prices, the result, and the money, priced exactly as the Dashboard,
 * Strategies and Win/Loss pages price it (pricingInputs), so totals in Excel match the app.
 *
 * Picks removed as "didn't actually bet" are included with Excluded = yes, and the fresh start is ignored, so
 * nothing is missing; filter them in Excel if wanted.
 */
import type { EngineDb, LivePick, Placement } from "../storage/engine-db";
import { pricingInputs } from "./winloss";
import { listStrategyNames, strategyKey } from "../inplayguru/strategy-names";
import { strategyLabel } from "../inplayguru/bet-feed";
import { excelTime, toExcelCsv, ukParts } from "./excel";

type Cell = string | number | boolean | null | undefined;

const PLACEMENT: Record<Placement, string> = {
  betfair: "Betfair bet",
  manual: "placed by hand",
  legacy: "sent (before bet checks)",
  notPlaced: "sent, not placed",
  sim: "Sim",
};

const secondsBetween = (from: string | null, to: string | null): number | null =>
  from && to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) ? Math.round((Date.parse(to) - Date.parse(from)) / 1000) : null;

function goalsOf(score: string | null): number | null {
  const m = score?.match(/^(\d+)\s*-\s*(\d+)$/);
  return m ? Number(m[1]) + Number(m[2]) : null;
}

export function picksExportCsv(db: EngineDb): string {
  const picks = db.listAllLivePicks();
  const names = listStrategyNames(db);

  // Money, priced pick by pick as everywhere else in the app.
  const { price } = pricingInputs(db);
  const money = new Map<number, { placement: Placement; stake: number | null; odds: number | null; source: string | null; profit: number | null; assumed: boolean; note: string | null }>();
  for (const r of db.listResultsForWinLoss("1970-01-01T00:00:00.000Z", { ignoreFreshStart: true, includeHiddenLeagues: true })) {
    const { priced, odds } = price(r);
    if (priced.kind === "priced") {
      money.set(r.id, { placement: r.placement, stake: priced.stake, odds: priced.odds, source: priced.oddsSource, profit: priced.profit, assumed: priced.oddsSource === "assumed", note: null });
    } else {
      const note = priced.kind === "noStake" ? "no stake set" : priced.kind === "noOdds" ? "no price known" : "Sim: wouldn't have been bet";
      money.set(r.id, { placement: r.placement, stake: null, odds, source: null, profit: r.placement === "notPlaced" ? 0 : null, assumed: false, note });
    }
  }

  // Betfair bets by pick, and which of them GoalBrew placed itself.
  const bets = new Map<number, Array<{ betId: string; matched: number; odds: number | null; profit: number | null; status: string }>>();
  for (const b of db.listBetfairBets()) {
    if (b.pickId === null) continue;
    const list = bets.get(b.pickId) ?? [];
    list.push({ betId: b.betId, matched: b.matched ?? 0, odds: b.odds ?? null, profit: b.profit ?? null, status: b.status });
    bets.set(b.pickId, list);
  }

  // Every stat label any alert has carried, so each gets its own home and away columns.
  const statLabels = [...new Set(picks.flatMap((p) => Object.keys(p.detail?.stats ?? {})))].sort();

  const header = [
    "Pick", "Alert time (UK)", "Date", "Time", "Weekday", "Hour", "Received (UK)", "Seconds to receive",
    "Strategy (InPlayGuru)", "Strategy (GoalBrew)", "Mode", "How bet", "Sent (UK)", "Seconds alert to sent",
    "League", "Country", "Home", "Away", "Positions", "Pre-match", "Kick-off", "Minute", "Home goals", "Away goals", "Goals at alert", "Last goal",
    "Market", "Selection", "Line", "Favourite", "Underdog",
    "Pre-match home", "Pre-match draw", "Pre-match away", "Live home", "Live draw", "Live away", "O/U line", "Over price", "Under price",
    "Betfair price at alert", "On Betfair", "Betfair event", "Betfair market check",
    "Strike rate %", "Matched £ (alert)", "Free pick",
    ...statLabels.flatMap((s) => [`${s} home`, `${s} away`]),
    "HT score", "FT score", "FT goals", "Goals after alert", "Result", "Alert's own result", "Result amended", "Excluded",
    "Stake £", "Odds", "Odds from", "Odds a guess", "Profit £", "Return per £1", "Not priced because",
    "Betfair bets", "Matched £", "Avg matched odds", "Betfair profit £", "Bet placed by", "Hand bet £", "Hand bet odds",
    "Direct betting", "Flags",
  ];

  const rows: Cell[][] = picks.map((p: LivePick) => {
    const alertAt = p.messageAt ?? p.firstSeenAt;
    const when = ukParts(alertAt);
    const d = p.detail;
    const m = money.get(p.id);
    const settled = p.result === "hit" || p.result === "miss";
    const placement: string = m ? PLACEMENT[m.placement] : p.manualBet ? "placed by hand" : p.sentAt ? "sent (open)" : "Sim (open)";
    const live = m ? m.placement !== "sim" : p.manualBet !== null || p.sentAt !== null;
    const pickBets = bets.get(p.id) ?? [];
    const matched = pickBets.reduce((t, b) => t + b.matched, 0);
    const avgOdds = matched > 0 ? pickBets.reduce((t, b) => t + b.matched * (b.odds ?? 0), 0) / matched : null;
    const allSettled = pickBets.length > 0 && pickBets.every((b) => b.status === "won" || b.status === "lost" || b.matched === 0);
    const bfProfit = allSettled ? pickBets.reduce((t, b) => t + (b.profit ?? 0), 0) : null;
    const direct = db.getDirectBet(p.id);
    const goalbrew = pickBets.some((b) => b.betId === direct?.betId && b.matched > 0);
    const others = pickBets.some((b) => b.betId !== direct?.betId && b.matched > 0);
    const placedBy = goalbrew && others ? "Both" : goalbrew ? "GoalBrew" : others ? "Bet feed" : p.manualBet ? "By hand" : "";
    const ftGoals = goalsOf(p.ftScore);
    const goalsAtAlert = p.goalsHome !== null && p.goalsAway !== null ? p.goalsHome + p.goalsAway : null;
    const pre = d?.odds.preMatch1x2 ?? null;
    const liveOdds = d?.odds.live1x2 ?? null;
    const label = strategyLabel(p.strategy);

    return [
      p.id,
      excelTime(alertAt),
      when.date,
      when.time,
      when.weekday,
      when.hour,
      excelTime(p.firstSeenAt),
      secondsBetween(alertAt, p.firstSeenAt),
      label,
      names[strategyKey(p.strategy)]?.name ?? label,
      live ? "Live" : "Sim",
      placement,
      excelTime(p.sentAt),
      secondsBetween(alertAt, p.sentAt),
      p.competition,
      d?.country ?? null,
      p.home,
      p.away,
      d?.positions ?? null,
      d?.kickoffRaw ? "yes" : "no",
      d?.kickoffRaw ?? null,
      p.minute,
      p.goalsHome,
      p.goalsAway,
      goalsAtAlert,
      d?.lastGoal ?? null,
      p.market,
      p.selection,
      d?.targetLine ?? null,
      d?.favourite ?? null,
      d?.underdog ?? null,
      pre?.[0] ?? null,
      pre?.[1] ?? null,
      pre?.[2] ?? null,
      liveOdds?.[0] ?? null,
      liveOdds?.[1] ?? null,
      liveOdds?.[2] ?? null,
      d?.odds.overUnderLine ?? null,
      d?.odds.over ?? null,
      d?.odds.under ?? null,
      p.exchangeOdds,
      p.exchange,
      p.exchangeEvent,
      p.marketCheck,
      d?.strikeRate ?? null,
      d?.matched ?? null,
      d?.freePick ? `${d.freePick.n} of ${d.freePick.of}` : null,
      ...statLabels.flatMap((s) => {
        const v = d?.stats[s];
        return v ? [v[0], v[1]] : [null, null];
      }),
      p.htScore,
      p.ftScore,
      ftGoals,
      ftGoals !== null && goalsAtAlert !== null ? ftGoals - goalsAtAlert : null,
      p.result ?? (p.ftScore ? "" : "open"),
      p.originalResult,
      p.resultOverridden,
      p.excluded,
      m?.stake ?? null,
      m?.odds ?? null,
      m?.source ?? null,
      m ? m.assumed : null,
      settled ? (m?.profit ?? null) : null,
      settled && m?.profit !== null && m?.profit !== undefined && m.stake ? m.profit / m.stake : null,
      m?.note ?? null,
      pickBets.length || null,
      matched || null,
      avgOdds,
      bfProfit,
      placedBy,
      p.manualBet?.stake ?? null,
      p.manualBet?.odds ?? null,
      direct ? `${direct.mode}: ${direct.state === "shadow" ? "would bet" : direct.state}` : null,
      p.flags.join("; ") || null,
    ];
  });

  return toExcelCsv(header, rows);
}
