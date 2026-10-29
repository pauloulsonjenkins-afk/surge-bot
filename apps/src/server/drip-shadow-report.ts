/**
 * The drip shadow test's report (betfair/drip-shadow.ts records the prices): for every watched alert that has settled,
 * a ladder of resting back orders is replayed against the prices that followed it and the time of the first goal, and
 * the result is compared with the same money staked all at once at the alert price (no drip).
 *
 *   flat       the £10.50 of six legs all taken at the alert price.
 *   5/10/15    the six legs each that many ticks above the one before; a leg counts only if the price got there before a goal.
 *
 * Sent once, as a push notification, from 15 Nov 2026 (REPORT_DAY) outside quiet hours; the full text is kept in the
 * setting "drip_shadow_report" and is also at /internal/drip-shadow, for the admin only. Information only.
 */
import type { EngineDb } from "../storage/engine-db";
import { dripSql, GROUP_STAKES, settleLadder, simulateLadder, type LadderConfig, type Tick } from "../betfair/drip-shadow";
import { goalsForPick } from "../fixtures/goal-times";
import { pricingInputs } from "./winloss";
import { isQuietHour } from "./golden-notify";
import { sendPush } from "./push";
import { ukDateOf } from "./uk-time";
import { displayName } from "../inplayguru/strategy-names";
import { log } from "./log";

export const REPORT_DAY = "2026-11-15";
const SENT_KEY = "drip_shadow_report_sent";
const TEXT_KEY = "drip_shadow_report";

const VARIANTS: Array<{ label: string; cfg: LadderConfig }> = [
  { label: "All at once at the alert price (no drip)", cfg: { stakes: GROUP_STAKES, gapTicks: 0 } },
  { label: "Drip, 5 ticks apart", cfg: { stakes: GROUP_STAKES, gapTicks: 5 } },
  { label: "Drip, 10 ticks apart", cfg: { stakes: GROUP_STAKES, gapTicks: 10 } },
  { label: "Drip, 15 ticks apart", cfg: { stakes: GROUP_STAKES, gapTicks: 15 } },
];

export interface VariantTotals {
  label: string;
  picks: number;
  staked: number;
  profit: number;
  /** Profit as a percentage of the money staked. */
  roiPct: number | null;
  /** Legs filled on average, of the six, in alerts that won and in alerts that lost. */
  legsWon: number | null;
  legsLost: number | null;
  /** How much of the money staked sat on alerts that won. */
  stakeOnWinnersPct: number | null;
}

export interface DripReport {
  /** Alerts the test has price records for, how many have settled, and how many of those have goal times. */
  recorded: number;
  settled: number;
  withGoalTimes: number;
  overall: VariantTotals[];
  byStrategy: Array<{ strategy: string; name: string; settled: number; won: number; variants: VariantTotals[] }>;
  headline: string;
  text: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

interface Acc {
  picks: number;
  staked: number;
  profit: number;
  legsWon: number;
  nWon: number;
  legsLost: number;
  nLost: number;
  stakeWon: number;
}
const acc = (): Acc => ({ picks: 0, staked: 0, profit: 0, legsWon: 0, nWon: 0, legsLost: 0, nLost: 0, stakeWon: 0 });

function totals(label: string, a: Acc): VariantTotals {
  return {
    label,
    picks: a.picks,
    staked: r2(a.staked),
    profit: r2(a.profit),
    roiPct: a.staked > 0 ? Math.round((1000 * a.profit) / a.staked) / 10 : null,
    legsWon: a.nWon ? Math.round((10 * a.legsWon) / a.nWon) / 10 : null,
    legsLost: a.nLost ? Math.round((10 * a.legsLost) / a.nLost) / 10 : null,
    stakeOnWinnersPct: a.staked > 0 ? Math.round((1000 * a.stakeWon) / a.staked) / 10 : null,
  };
}

/** The wall-clock time of the first goal after the alert, from the goal minutes (null: none, or not known yet). */
function firstGoalMs(db: EngineDb, pickId: number, alertMs: number, alertMinute: number | null): { known: boolean; ms: number | null } {
  const g = goalsForPick(db, pickId);
  if (!g.goals) return { known: false, ms: null };
  const m = alertMinute ?? 45;
  const next = g.goals.find((e) => e.minute > m || (e.minute === m && m > 45));
  if (!next) return { known: true, ms: null };
  // An alert at half-time (timer 45) waits out the break before the second half's minutes start.
  const gap = m <= 45 && next.minute > 45 ? 15 : 0;
  return { known: true, ms: alertMs + (next.minute - m + gap) * 60_000 };
}

export function computeDripReport(db: EngineDb): DripReport {
  const s = dripSql(db);
  const { commission } = pricingInputs(db);
  const picks = s.prepare(`SELECT pick_id, strategy, entry, alert_at, minute FROM drip_shadow_picks ORDER BY pick_id`).all() as Array<{ pick_id: number; strategy: string; entry: number; alert_at: string; minute: number | null }>;
  const tickRows = s.prepare(`SELECT at, back FROM drip_shadow_ticks WHERE pick_id = ? ORDER BY at`);
  const overall = VARIANTS.map(() => acc());
  const per = new Map<string, { settled: number; won: number; a: Acc[] }>();
  let settled = 0;
  let withGoals = 0;
  for (const p of picks) {
    const live = db.getLivePick(p.pick_id);
    if (!live || (live.result !== "hit" && live.result !== "miss")) continue;
    const ticks: Tick[] = (tickRows.all(p.pick_id) as Array<{ at: string; back: number | null }>).map((t) => ({ atMs: Date.parse(t.at), back: t.back }));
    if (ticks.length === 0) continue;
    settled++;
    const alertMs = Date.parse(p.alert_at);
    const goal = firstGoalMs(db, p.pick_id, alertMs, p.minute);
    if (goal.known) withGoals++;
    const won = live.result === "hit";
    const slot = per.get(p.strategy) ?? per.set(p.strategy, { settled: 0, won: 0, a: VARIANTS.map(() => acc()) }).get(p.strategy)!;
    slot.settled++;
    if (won) slot.won++;
    VARIANTS.forEach((v, i) => {
      const r = settleLadder(simulateLadder(p.entry, alertMs, ticks, goal.ms, v.cfg), won, commission);
      for (const a of [overall[i]!, slot.a[i]!]) {
        a.picks++;
        a.staked += r.staked;
        a.profit += r.profit;
        if (won) {
          a.legsWon += r.legs;
          a.nWon++;
          a.stakeWon += r.staked;
        } else {
          a.legsLost += r.legs;
          a.nLost++;
        }
      }
    });
  }
  const overallT = VARIANTS.map((v, i) => totals(v.label, overall[i]!));
  const byStrategy = [...per.entries()].map(([strategy, v]) => ({ strategy, name: displayName(db, strategy), settled: v.settled, won: v.won, variants: VARIANTS.map((x, i) => totals(x.label, v.a[i]!)) }));
  const flat = overallT[0]!;
  const d15 = overallT[3]!;
  const headline =
    settled === 0
      ? `No settled alerts recorded yet (${picks.length} watched).`
      : `${settled} alerts. All at once: ${flat.roiPct === null ? "n/a" : pct(flat.roiPct)} on £${flat.staked}. 15-tick drip: ${d15.roiPct === null ? "n/a" : pct(d15.roiPct)} on £${d15.staked}.`;
  const lines: string[] = [
    `Drip shadow test: ${picks.length} alerts watched, ${settled} settled, ${withGoals} with goal times.`,
    `Six legs of £1, £2.50, £1, £2.50, £1, £2.50 per alert (£10.50 if every leg fills). Nothing real was bet.`,
    "",
  ];
  const block = (title: string, vs: VariantTotals[]) => {
    lines.push(title);
    for (const v of vs) {
      lines.push(
        `  ${v.label}: staked £${v.staked}, ${v.profit >= 0 ? "won" : "lost"} £${Math.abs(v.profit)} (${v.roiPct === null ? "n/a" : pct(v.roiPct)}); legs filled ${v.legsWon ?? "-"} in winners, ${v.legsLost ?? "-"} in losers; ${v.stakeOnWinnersPct ?? "-"}% of the money sat on winners`,
      );
    }
    lines.push("");
  };
  block("All four strategies", overallT);
  for (const st of byStrategy) block(`${st.name} (${st.settled} settled, ${st.won} won)`, st.variants);
  lines.push(
    "How to read it: a leg fills only if the price rose to it before the first goal, so a drip stakes more on alerts where no goal comes (the losers) and less on the ones that win quickly.",
    "Prices were read about every 45 seconds, so a brief spike between reads is missed and fills are slightly under-counted. Small samples (a few dozen alerts) say little: look at the direction, not the decimals.",
  );
  return { recorded: picks.length, settled, withGoalTimes: withGoals, overall: overallT, byStrategy, headline, text: lines.join("\n") };
}

/** Once from REPORT_DAY, outside quiet hours: keeps the full text and sends the headline as a push notification. Returns whether it sent. */
export async function maybeSendDripReport(db: EngineDb, now = new Date()): Promise<boolean> {
  if (ukDateOf(now) < REPORT_DAY || isQuietHour(now) || db.getSetting(SENT_KEY)) return false;
  const report = computeDripReport(db);
  db.setSetting(TEXT_KEY, report.text);
  db.setSetting(SENT_KEY, now.toISOString());
  await sendPush(db, { title: "Drip test report is ready", body: report.headline.slice(0, 200), url: "/trade-log", tag: "drip-shadow" });
  log.info(`Drip shadow report sent: ${report.headline}`);
  return true;
}
