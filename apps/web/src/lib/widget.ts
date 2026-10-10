import type { TodaySnapshot } from "@/server/engine-client";

/**
 * The phone widget's summary of the Today page (served by /api/widget): every value ready to show as it is, text and
 * colours (the dark theme's), flat so a widget app can pick one with ".name". See apps/web/WIDGET.md.
 */
export const GREEN = "#5CC48F";
export const RED = "#E86B55";
export const AMBER = "#E6CF4F";
export const CREAM = "#F1E9DF";

const money = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}£${Math.abs(n).toFixed(2)}`;
const colour = (n: number) => (n > 0 ? GREEN : n < 0 ? RED : CREAM);

export function widgetSummary(d: TodaySnapshot) {
  const paused = d.betting.breaker.open;
  const status = !d.betting.on ? "Off" : paused ? "Paused" : "On";
  // The one thing most worth knowing, if anything is wrong.
  const warning = d.limits.lossStop
    ? "Daily loss stop reached"
    : paused
      ? "Betfair problem: bets paused"
      : !d.alerts.telegram.ok
        ? "Alerts may not be arriving"
        : d.stopped.length > 0
          ? `${d.stopped.length} strateg${d.stopped.length === 1 ? "y" : "ies"} stopped`
          : d.queue.sentToday >= 5 && d.queue.notPlacedToday / d.queue.sentToday > 0.3
            ? `${d.queue.notPlacedToday} of ${d.queue.sentToday} not placed`
            : "";
  const updated = new Date(d.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  const balance = d.bank.available === null ? "–" : `£${d.bank.available.toFixed(2)}`;
  return {
    status,
    statusColor: status === "On" ? GREEN : status === "Paused" ? AMBER : RED,
    livePL: money(d.today.liveNet),
    livePLColor: colour(d.today.liveNet),
    liveSettled: String(d.today.liveSettled),
    simPL: money(d.today.simNet),
    balance,
    exposure: `£${Math.abs(d.bank.exposure ?? 0).toFixed(2)}`,
    moneyOut: `£${d.exposure.openStake.toFixed(2)}`,
    alertsHour: String(d.alerts.lastHour),
    notPlaced: `${d.queue.notPlacedToday} of ${d.queue.sentToday}`,
    // Bets actually placed today: picks handed over, less the ones that were never placed.
    betsToday: String(Math.max(0, d.queue.sentToday - d.queue.notPlacedToday)),
    waiting: String(d.queue.waiting + d.queue.placing),
    warning,
    warningColor: warning ? AMBER : CREAM,
    suggestions: String(d.advice?.length ?? 0),
    updated,
    // Two ready-made lines, for the simplest widget.
    line1: `Betting ${status} · Today ${money(d.today.liveNet)}`,
    line2: warning || `Balance ${balance} · ${d.alerts.lastHour} alerts/hr · ${updated}`,
    // The raw numbers, for anyone building their own.
    raw: {
      bettingOn: d.betting.on,
      paused,
      liveNet: d.today.liveNet,
      simNet: d.today.simNet,
      available: d.bank.available,
      openStake: d.exposure.openStake,
      alertsLastHour: d.alerts.lastHour,
      notPlacedToday: d.queue.notPlacedToday,
      sentToday: d.queue.sentToday,
      betsToday: Math.max(0, d.queue.sentToday - d.queue.notPlacedToday),
      at: d.at,
    },
  };
}

