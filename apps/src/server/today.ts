/**
 * The admin's "Today" page in one call, and two reports behind it:
 *   - not placed: picks handed over to bet that never got a matched Betfair bet, grouped by WHY, so the biggest leak
 *     can be fixed first (a price below the minimum is the strategy's rule working; a team spelt differently is a bug);
 *   - speed: how long each step took, from the alert being posted to the bet being placed on Betfair. In-play prices
 *     move by the second, so a slow step costs money.
 */
import type { EngineDb } from "../storage/engine-db";
import { getSendingSettings, dailyLossStopReason, strategyLabel, betableUntil } from "../inplayguru/bet-feed";
import { accountToday, computeStopLoss } from "../inplayguru/stop-loss";
import { getBank } from "../inplayguru/stake";
import { breakerStatus } from "../betfair/guard";
import { effectiveMode, getDirectSettings, liveAllowed } from "../betfair/direct";
import { getBetfairLinkStatus } from "../betfair/exchange";
import { reasonFor } from "../betfair/unplaced";
import { telegramHealth } from "./telegram-watchdog";
import { ukDateOf, ukDayBounds } from "./uk-time";

// --------------------------------------------------------------------------- not placed, by reason

const CATEGORIES: Array<{ test: RegExp; category: string; fix: string }> = [
  { test: /below the minimum|below this strategy's minimum/i, category: "Price below the minimum odds", fix: "The strategy's own rule working. Only worth changing if the minimum is set too high." },
  { test: /shortened from/i, category: "Price shortened since the alert", fix: "The market moved first. Faster alerts help; otherwise it's the price rule working." },
  { test: /Only £[\d.]+ on offer/i, category: "Not enough money on offer", fix: "A thin market. Smaller stakes, or skip that league." },
  { test: /apart \(limit|price gap/i, category: "Back and lay too far apart", fix: "A thin or nervous market. Raise the gap limit only for strategies that need it." },
  { test: /Overround/i, category: "Overround out of range", fix: "Check the overround limits on Direct betting for this market type." },
  { test: /not matched within|cancelled/i, category: "Not matched in time", fix: "The price moved away. A slightly bigger 'take down to' % may help." },
  { test: /spells a team|Match names|No selection called/i, category: "Team or selection name differs", fix: "A bug: add the name under Sending, Match names." },
  { test: /wasn't found on Betfair|no .+ market|isn't on Betfair|Finding the match/i, category: "Match or market not on Betfair", fix: "Mark the league 'not on Betfair' so it stops being sent." },
  { test: /suspended|has closed|MARKET_/i, category: "Market suspended or closed", fix: "Usually a goal just before the bet. Nothing to fix." },
  { test: /Daily stake limit|Daily limit|Match limit|Daily loss stop/i, category: "A daily or match limit", fix: "Your safety limits working." },
  { test: /Paused:/i, category: "Paused: Betfair problems", fix: "The circuit breaker. Check Betfair's status." },
  { test: /Not enough money in the Betfair account|INSUFFICIENT_FUNDS/i, category: "Not enough money in the account", fix: "Top up the Betfair account." },
  { test: /turned it down|betting software/i, category: "Betting software turned it down", fix: "Check BF Bot Manager's rules for that strategy (older picks)." },
  { test: /Too old/i, category: "Alert too late to bet", fix: "The alert arrived after the betting window. Check the Telegram delay." },
];

export function categorise(reason: string | null): { category: string; fix: string } {
  if (!reason) return { category: "No reason recorded", fix: "Look at the pick on Sending." };
  // "Too old to bet. <last reason>": the last reason it was waiting for is the real cause.
  const inner = reason.replace(/^Too old to bet\.\s*/i, "");
  for (const c of CATEGORIES) if (inner && c.test.test(inner)) return { category: c.category, fix: c.fix };
  if (/^Too old/i.test(reason)) return { category: "Alert too late to bet", fix: "The alert arrived after the betting window. Check the Telegram delay." };
  return { category: "Other", fix: "See the reason on the pick." };
}

export interface NotPlacedReport {
  days: number;
  sent: number;
  placed: number;
  notPlaced: number;
  byCategory: Array<{ category: string; fix: string; count: number; share: number; strategies: string[]; example: string }>;
  byStrategy: Array<{ strategy: string; sent: number; notPlaced: number; top: string | null }>;
}

export function notPlacedReport(db: EngineDb, days = 30, now = new Date()): NotPlacedReport {
  const since = now.getTime() - days * 86_400_000;
  const withBets = db.pickIdsWithBets();
  const maxAge = getSendingSettings(db).maxAgeMinutes;
  const rows: Array<{ strategy: string; placed: boolean; reason: string | null }> = [];
  for (const s of db.listSentPicks()) {
    if (s.viaFeed === false || s.manualBet || Date.parse(s.sentAt) < since) continue;
    const d = db.getDirectBet(s.id);
    const pick = db.getLivePick(s.id);
    if (!pick || pick.excluded) continue;
    // Still being worked on: not counted yet.
    if (d && (d.state === "waiting" || d.state === "placing") && now.getTime() <= betableUntil(pick, maxAge)) continue;
    let placed: boolean;
    let reason: string | null = null;
    if (d && d.mode === "live") {
      placed = d.state === "placed" && (d.sizeMatched ?? 0) > 0;
      if (!placed) reason = d.state === "placed" ? (d.reason ?? "Not matched in time (cancelled).") : d.reason;
    } else {
      placed = withBets.has(s.id);
      if (!placed) {
        let minPrice: number | null = null;
        try {
          const m = (JSON.parse(pick.sentRowJson ?? "{}") as { minPrice?: unknown }).minPrice;
          minPrice = typeof m === "number" ? m : null;
        } catch {
          minPrice = null;
        }
        reason = reasonFor(pick.exchange, pick.marketCheck, pick.marketCheckDetail, pick.exchangeOdds, minPrice);
      }
    }
    rows.push({ strategy: strategyLabel(s.strategy), placed, reason });
  }
  const missed = rows.filter((r) => !r.placed);
  const cats = new Map<string, { fix: string; count: number; strategies: Set<string>; example: string }>();
  for (const r of missed) {
    const c = categorise(r.reason);
    const e = cats.get(c.category) ?? { fix: c.fix, count: 0, strategies: new Set<string>(), example: r.reason ?? "" };
    e.count++;
    e.strategies.add(r.strategy);
    cats.set(c.category, e);
  }
  const strategies = new Map<string, { sent: number; notPlaced: number; cats: Map<string, number> }>();
  for (const r of rows) {
    const e = strategies.get(r.strategy) ?? { sent: 0, notPlaced: 0, cats: new Map<string, number>() };
    e.sent++;
    if (!r.placed) {
      e.notPlaced++;
      const c = categorise(r.reason).category;
      e.cats.set(c, (e.cats.get(c) ?? 0) + 1);
    }
    strategies.set(r.strategy, e);
  }
  return {
    days,
    sent: rows.length,
    placed: rows.length - missed.length,
    notPlaced: missed.length,
    byCategory: [...cats.entries()]
      .map(([category, e]) => ({ category, fix: e.fix, count: e.count, share: Math.round((1000 * e.count) / Math.max(1, missed.length)) / 10, strategies: [...e.strategies], example: e.example }))
      .sort((a, b) => b.count - a.count),
    byStrategy: [...strategies.entries()]
      .map(([strategy, e]) => ({ strategy, sent: e.sent, notPlaced: e.notPlaced, top: [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
      .sort((a, b) => b.notPlaced - a.notPlaced),
  };
}

// --------------------------------------------------------------------------- speed, alert to bet

export interface SpeedReport {
  picks: number;
  /** Medians in seconds; null when nothing to measure. */
  postedToReceived: number | null;
  receivedToSent: number | null;
  sentToPlaced: number | null;
  total: number | null;
  /** Share of placed bets that took over 30 seconds from the alert. */
  slowShare: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) * 10) / 10;
}

export function speedReport(db: EngineDb, sinceIso: string): SpeedReport {
  const rows = db.listBetTimings(sinceIso);
  const secs = (a: string | null, b: string | null) => {
    if (!a || !b) return null;
    const d = (Date.parse(b) - Date.parse(a)) / 1000;
    // Clock differences can make a step a second or two negative; anything wildly off isn't a real timing.
    return Number.isFinite(d) && d > -5 && d < 3600 ? Math.max(0, d) : null;
  };
  const pr = rows.map((r) => secs(r.postedAt, r.receivedAt)).filter((x): x is number => x !== null);
  const rs = rows.map((r) => secs(r.receivedAt, r.sentAt)).filter((x): x is number => x !== null);
  const sp = rows.map((r) => secs(r.sentAt, r.placedAt)).filter((x): x is number => x !== null);
  const tot = rows.map((r) => secs(r.postedAt ?? r.receivedAt, r.placedAt)).filter((x): x is number => x !== null);
  return {
    picks: rows.length,
    postedToReceived: median(pr),
    receivedToSent: median(rs),
    sentToPlaced: median(sp),
    total: median(tot),
    slowShare: tot.length ? Math.round((1000 * tot.filter((t) => t > 30).length) / tot.length) / 10 : null,
  };
}

// --------------------------------------------------------------------------- the Today page

export function todaySnapshot(db: EngineDb, now = new Date()) {
  const sending = getSendingSettings(db);
  const direct = getDirectSettings(db);
  const live = accountToday(db, now, "live");
  const sim = accountToday(db, now, "sim");
  const dayFrom = ukDayBounds(ukDateOf(now)).from;
  const recent = db.listLivePicks(200);
  const lastHour = recent.filter((p) => now.getTime() - Date.parse(p.firstSeenAt) < 3_600_000).length;

  // Money out on each match right now: picks handed over today whose match isn't settled yet.
  const onMatch = new Map<string, { match: string; stake: number }>();
  for (const p of recent) {
    if (!p.sentAt || p.sentAt < dayFrom || p.status === "settled" || p.excluded) continue;
    let stake = 0;
    try {
      stake = Number((JSON.parse(p.sentRowJson ?? "{}") as { stake?: unknown }).stake) || 0;
    } catch {
      stake = 0;
    }
    const k = `${p.leagueKey}|${p.home}|${p.away}`;
    const e = onMatch.get(k) ?? { match: `${p.home ?? "?"} v ${p.away ?? "?"}`, stake: 0 };
    e.stake += stake;
    onMatch.set(k, e);
  }
  const biggest = [...onMatch.values()].sort((a, b) => b.stake - a.stake)[0] ?? null;
  const openStake = [...onMatch.values()].reduce((t, e) => t + e.stake, 0);
  const stopped = [...computeStopLoss(db, now).values()].filter((s) => s.stopped).map((s) => ({ strategy: s.key, reason: s.reason }));
  const open = db.listOpenDirectBets();
  const notPlacedToday = notPlacedReport(db, 1, now);

  return {
    at: now.toISOString(),
    betting: {
      on: sending.enabled,
      directMode: effectiveMode(direct),
      liveAllowed: liveAllowed(),
      liveStrategies: Object.values(sending.strategies).filter(Boolean).length,
      breaker: breakerStatus(),
      betfair: getBetfairLinkStatus(),
    },
    bank: getBank(db),
    limits: {
      dailyLossLimit: sending.dailyLossLimit,
      lossStop: dailyLossStopReason(db, sending.dailyLossLimit, now),
      matchCap: sending.matchCap,
      dailyCap: sending.dailyCap,
      maxStake: sending.maxStake,
    },
    today: { liveNet: live.net, liveSettled: live.settled, simNet: sim.net, simSettled: sim.settled },
    exposure: { openStake: Math.round(openStake * 100) / 100, biggestMatch: biggest ? { match: biggest.match, stake: Math.round(biggest.stake * 100) / 100 } : null },
    alerts: { lastHour, telegram: telegramHealth(db, now) },
    queue: { waiting: open.filter((d) => d.state === "waiting").length, placing: open.filter((d) => d.state === "placing").length, notPlacedToday: notPlacedToday.notPlaced, sentToday: notPlacedToday.sent },
    stopped,
    speed: { today: speedReport(db, dayFrom), week: speedReport(db, new Date(now.getTime() - 7 * 86_400_000).toISOString()) },
  };
}
