/**
 * AUTO-ADJUST (owner, 21 Nov 2026: "on a busy day ... once a night, but on a sat and sunday twice a day"). GoalBrew applies
 * its own Live / Sim suggestions (strategy-advice.ts) at 22:00 UK every night, and at 13:00 UK on Saturday and Sunday too,
 * with the owner's checks from the 21 Nov review on top. A scheduled Claude check cross-checks every run afterwards, from
 * the log kept here (GET /internal/auto-adjust).
 *
 *   applied     back to Sim, a Golden slice to Sim, try Live and a slice Live. The last two go Live at the trial stake the
 *               suggestion already carries (1% or £1), and only from the week's pass (strategy-advice.ts weeklyGrowth).
 *   not here    stake steps (the stake ladder does those, under its own rules) and league stops (each is worth a look).
 *   owner's     a strategy is not taken off Live for one bad day: if it is in profit without its single worst day AND its
 *   checks      last 7 days are not losing, the "back to Sim" waits. "Try Live" also needs a profit overall and its last
 *               7 days not losing.
 *   limits      at most MAX_CHANGES a run, cuts first; never a stake raise; the strategies the owner chose to keep as they
 *               are (PROTECTED_KEY) are never touched. Off with the `auto_adjust_on` setting ("0").
 *
 * Each change is applied once, through applyAdvice, which works the suggestion out afresh: a run can't apply one twice.
 */
import { withChangeSource } from "../inplayguru/change-log";
import type { EngineDb } from "../storage/engine-db";
import { applyAdvice, strategyAdvice, weeklyGrowth, type Advice } from "./strategy-advice";
import { displayName } from "../inplayguru/strategy-names";
import { cachedReportVia } from "./report-cache";
import { sendPush } from "./push";
import { log } from "./log";
import { archiveLosingTrials, type TrialFigures } from "./archive";
import { getSendingSettings } from "../inplayguru/bet-feed";

export const MAX_CHANGES = 4;
const ON_KEY = "auto_adjust_on";
const PROTECTED_KEY = "auto_adjust_protected";
const LOG_KEY = "auto_adjust_log";
const SLOT_KEY = "auto_adjust_last_slot";
const LOG_KEEP = 60;
/** The owner's choices in the 21 Nov 2026 review: left as they are. Replaced by the `auto_adjust_protected` setting when set. */
export const DEFAULT_PROTECTED = ["og 2 shg", "favourite pressure 2nd half", "lay next goal · comeback roast, not home 1 down", "early pressure with low score"];

/** What the owner's checks read for one strategy, from the Strategies report. */
export interface Figures {
  /** Live profit and its worst day's profit (£), null without Live bets. */
  liveProfit: number | null;
  liveWorstDay: number | null;
  /** All bets (Live and Sim) the same way. */
  allProfit: number | null;
  allWorstDay: number | null;
  /** The last 7 days' return per £1 (Live, and Live and Sim together); null with no priced bets. */
  weekLiveRoi: number | null;
  weekAllRoi: number | null;
}

export interface Decision {
  advice: Advice;
  apply: boolean;
  /** Why it was held back, in words (when apply is false). */
  held?: string;
}

const APPLIED_KINDS = new Set<Advice["kind"]>(["back-to-sim", "slice-sim", "try-live", "slice-live"]);
const isCut = (a: Advice) => a.kind === "back-to-sim" || a.kind === "slice-sim";
const parentKey = (a: Advice) => a.slice?.strategyKey ?? a.key.split("#")[0]!;

/** Which suggestions to apply this run, and why the rest wait. Pure. */
export function decide(advice: Advice[], figuresOf: (key: string) => Figures | null, protectedKeys: string[], max = MAX_CHANGES): Decision[] {
  const prot = new Set(protectedKeys.map((k) => k.toLowerCase()));
  const out: Decision[] = [];
  let left = max;
  // Cuts first: they lower risk, and a full run shouldn't spend its changes on new risk.
  const ordered = advice.filter((a) => APPLIED_KINDS.has(a.kind)).sort((a, b) => Number(isCut(b)) - Number(isCut(a)));
  for (const a of ordered) {
    const hold = (why: string) => out.push({ advice: a, apply: false, held: why });
    if (prot.has(a.key) || prot.has(parentKey(a))) {
      hold("You chose to keep this as it is.");
      continue;
    }
    if (a.kind === "back-to-sim") {
      const f = figuresOf(a.key);
      if (f && f.liveProfit !== null && f.liveWorstDay !== null && f.liveProfit - f.liveWorstDay >= 0 && (f.weekLiveRoi ?? f.weekAllRoi ?? -1) >= 0) {
        hold("In profit without its one worst day, and its last 7 days aren't losing: one bad day isn't enough.");
        continue;
      }
    }
    if (a.kind === "try-live") {
      const f = figuresOf(a.key);
      if (!f || f.allProfit === null || f.allProfit <= 0) {
        hold("Not in profit overall.");
        continue;
      }
      if (f.weekAllRoi !== null && f.weekAllRoi < 0) {
        hold("Its last 7 days are losing.");
        continue;
      }
    }
    if (left <= 0) {
      hold(`Already ${max} changes this run.`);
      continue;
    }
    out.push({ advice: a, apply: true });
    left--;
  }
  return out;
}

type ReturnsBlock = { profit?: number; roi?: number | null; counted?: number; worstDay?: { profit: number } | null } | null | undefined;
type ReportRow = { label: string; returns?: { live?: ReturnsBlock; all?: ReturnsBlock } | null; form?: { week?: { live?: ReturnsBlock; all?: ReturnsBlock } | null } | null };

/** The owner's-check figures from the Strategies report body. Pure. */
export function figuresFromReport(body: Record<string, unknown>): (key: string) => Figures | null {
  const rows = (body.strategies ?? []) as ReportRow[];
  const byKey = new Map(rows.map((r) => [r.label.toLowerCase(), r]));
  const roiOf = (b: ReturnsBlock) => (b && (b.counted ?? 0) > 0 && typeof b.roi === "number" ? b.roi : null);
  return (key) => {
    const r = byKey.get(key.toLowerCase());
    if (!r) return null;
    const live = r.returns?.live;
    const all = r.returns?.all;
    return {
      liveProfit: live && (live.counted ?? 0) > 0 ? (live.profit ?? 0) : null,
      liveWorstDay: live?.worstDay ? live.worstDay.profit : null,
      allProfit: all && (all.counted ?? 0) > 0 ? (all.profit ?? 0) : null,
      allWorstDay: all?.worstDay ? all.worstDay.profit : null,
      weekLiveRoi: roiOf(r.form?.week?.live),
      weekAllRoi: roiOf(r.form?.week?.all),
    };
  };
}

export interface RunLog {
  at: string;
  slot: string;
  applied: Array<{ key: string; name: string; kind: Advice["kind"]; action: string; reason: string }>;
  held: Array<{ key: string; name: string; kind: Advice["kind"]; action: string; why: string }>;
  failed: Array<{ key: string; kind: Advice["kind"]; error: string }>;
  /** Trial strategies archived for losing over 200+ pretend bets (archive.ts archiveLosingTrials). */
  archived?: Array<{ key: string; name: string; note: string }>;
}

/** The archive's trial figures from the Strategies report body. Pure. */
export function trialFiguresFromReport(body: Record<string, unknown>, liveSliceParents: Set<string>): TrialFigures[] {
  type Row = { label: string; mode?: string; mergedInto?: string | null; returns?: { sim?: { counted?: number; profit?: number } | null } | null; form?: { week?: { sim?: { counted?: number; roi?: number | null } | null } | null } | null };
  return ((body.strategies ?? []) as Row[])
    .filter((r) => !r.mergedInto)
    .map((r) => {
      const wk = r.form?.week?.sim;
      return {
        key: r.label.toLowerCase(),
        label: r.label,
        live: r.mode === "live",
        hasLiveSlice: liveSliceParents.has(r.label.toLowerCase()),
        simBets: r.returns?.sim?.counted ?? 0,
        simProfit: r.returns?.sim?.profit ?? 0,
        weekSimRoi: wk && (wk.counted ?? 0) > 0 && typeof wk.roi === "number" ? wk.roi : null,
      };
    });
}

export function autoAdjustOn(db: EngineDb): boolean {
  return db.getSetting(ON_KEY) !== "0";
}

export function protectedKeys(db: EngineDb): string[] {
  try {
    const v = JSON.parse(db.getSetting(PROTECTED_KEY) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : DEFAULT_PROTECTED;
  } catch {
    return DEFAULT_PROTECTED;
  }
}

export function autoAdjustLog(db: EngineDb): RunLog[] {
  try {
    const v = JSON.parse(db.getSetting(LOG_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as RunLog[]) : [];
  } catch {
    return [];
  }
}

/** Which run is due now, if any: "2026-11-21 22" every night at 22:00 UK, "2026-11-21 13" at 13:00 UK on Sat and Sun. Pure. */
export function dueSlot(now: Date): string | null {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  if (hour === 22) return `${day} 22`;
  if (hour === 13 && weekend) return `${day} 13`;
  return null;
}

/** One run: applies what decide() allows, logs it, and sends one notification when anything changed. */
export async function runAutoAdjust(db: EngineDb, slot: string, now = new Date()): Promise<RunLog> {
  const body = await cachedReportVia(db, "strategies:null", "strategies", [null]);
  const figures = figuresFromReport(body);
  const advice = weeklyGrowth(db, strategyAdvice(db, now), now);
  const run: RunLog = { at: now.toISOString(), slot, applied: [], held: [], failed: [] };
  const nameOf = (a: Advice) => a.name ?? displayName(db, a.key);
  for (const d of decide(advice, figures, protectedKeys(db))) {
    if (!d.apply) {
      run.held.push({ key: d.advice.key, name: nameOf(d.advice), kind: d.advice.kind, action: d.advice.action, why: d.held ?? "" });
      continue;
    }
    try {
      const a = withChangeSource("Auto-adjust", () => applyAdvice(db, d.advice.key, d.advice.kind, now, undefined, { to: d.advice.to ?? null }));
      run.applied.push({ key: a.key, name: nameOf(a), kind: a.kind, action: a.action, reason: a.reason });
    } catch (err) {
      run.failed.push({ key: d.advice.key, kind: d.advice.kind, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Trial strategies still losing over 200+ pretend bets go to the Archive (restorable there).
  try {
    const liveSliceParents = new Set(Object.entries(getSendingSettings(db).segmentBets).filter(([, b]) => b.live).map(([k]) => k.split("#")[0]!));
    run.archived = archiveLosingTrials(db, trialFiguresFromReport(body, liveSliceParents), protectedKeys(db), now).map((r) => ({
      key: r.key,
      name: displayName(db, r.key),
      note: `£${r.simProfit.toFixed(2)} over ${r.simBets} pretend bets`,
    }));
  } catch (err) {
    log.warn(`Auto-adjust: archiving losing trials failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  db.setSetting(LOG_KEY, JSON.stringify([run, ...autoAdjustLog(db)].slice(0, LOG_KEEP)));
  log.info(`Auto-adjust (${slot}): ${run.applied.length} applied, ${run.held.length} held back, ${run.failed.length} failed.`);
  const archivedN = run.archived?.length ?? 0;
  if (run.applied.length > 0 || archivedN > 0) {
    await sendPush(db, {
      title: `Auto-adjust: ${run.applied.length + archivedN} change${run.applied.length + archivedN === 1 ? "" : "s"}`,
      body: [...run.applied.map((a) => `${a.name}: ${a.action.toLowerCase()}`), ...(run.archived ?? []).map((a) => `${a.name}: archived, losing on trial`)].join(" · "),
      url: "/more/admin/strategies",
      tag: "auto-adjust",
    });
  }
  return run;
}

/** Called every few minutes: runs the due slot once (the slot is remembered, so a restart in the hour doesn't run it again). */
export async function maybeAutoAdjust(db: EngineDb, now = new Date()): Promise<RunLog | null> {
  if (!autoAdjustOn(db)) return null;
  const slot = dueSlot(now);
  if (!slot || db.getSetting(SLOT_KEY) === slot) return null;
  db.setSetting(SLOT_KEY, slot);
  return runAutoAdjust(db, slot, now);
}
