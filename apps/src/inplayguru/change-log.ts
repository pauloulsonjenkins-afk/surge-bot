/**
 * THE CHANGES LOG (owner, 21 Nov 2026: changes came from six places and nobody could say who put Away Super Fav 2 Goals
 * Live). Every switch between real money and trial, every stake change, for a strategy or a Golden slice, and the master
 * switch, with who made it. It is written by saveSendingSettings (bet-feed.ts), the one place they all go through, so
 * nothing can change without a line here.
 *
 * Who made it: whatever runs a change says so with withChangeSource ("Auto-adjust", "Stake ladder", "Golden safety"...).
 * A change from the admin site is "You" unless the request names itself (the scheduled Claude checks send
 * changedBy: "Claude check").
 */
import type { EngineDb } from "../storage/engine-db";

const LOG_KEY = "change_log";
const KEEP = 400;
const DEFAULT_SOURCE = "You";

export interface ChangeEntry {
  at: string;
  by: string;
  /** Strategy key (lower case), or "strategy#slice" for a Golden slice, or "*" for the master switch. */
  key: string;
  kind: "mode" | "stake" | "betting";
  /** In words, ready to show: "Trial → Real money", "1.5% → 1%", "Off → On". */
  change: string;
}

let source: string | null = null;

/**
 * Runs `fn` with its setting changes logged as made by `by`. Synchronous only: a source held across an await would label
 * other changes made meanwhile. Nested calls keep the outer source.
 */
export function withChangeSource<T>(by: string, fn: () => T): T {
  if (source !== null) return fn();
  source = by;
  try {
    return fn();
  } finally {
    source = null;
  }
}

type Stakeish = { stakes: Record<string, number>; stakePct: Record<string, number> };
type SliceBet = { live: boolean; stakePct: number | null; stake: number | null };
type Snapshot = Stakeish & { enabled: boolean; strategies: Record<string, boolean>; segmentBets: Record<string, SliceBet> };

const stakeWords = (pct: number | null | undefined, flat: number | null | undefined) =>
  typeof pct === "number" ? `${pct}%` : typeof flat === "number" ? `£${flat}` : "default";
const modeWords = (live: boolean | undefined) => (live ? "Real money" : "Trial");

/** The changes between two settings, in words. Pure. */
export function diffSettings(a: Snapshot, b: Snapshot): Array<Omit<ChangeEntry, "at" | "by">> {
  const out: Array<Omit<ChangeEntry, "at" | "by">> = [];
  if (a.enabled !== b.enabled) out.push({ key: "*", kind: "betting", change: `Betting ${a.enabled ? "On" : "Off"} → ${b.enabled ? "On" : "Off"}` });
  for (const k of new Set([...Object.keys(a.strategies), ...Object.keys(b.strategies)])) {
    if ((a.strategies[k] === true) !== (b.strategies[k] === true)) out.push({ key: k, kind: "mode", change: `${modeWords(a.strategies[k])} → ${modeWords(b.strategies[k])}` });
  }
  for (const k of new Set([...Object.keys(a.stakes), ...Object.keys(a.stakePct), ...Object.keys(b.stakes), ...Object.keys(b.stakePct)])) {
    const was = stakeWords(a.stakePct[k], a.stakes[k]);
    const now = stakeWords(b.stakePct[k], b.stakes[k]);
    if (was !== now) out.push({ key: k, kind: "stake", change: `${was} → ${now}` });
  }
  for (const k of new Set([...Object.keys(a.segmentBets), ...Object.keys(b.segmentBets)])) {
    const x = a.segmentBets[k];
    const y = b.segmentBets[k];
    if ((x?.live ?? false) !== (y?.live ?? false)) out.push({ key: k, kind: "mode", change: `${modeWords(x?.live)} → ${modeWords(y?.live)}` });
    const was = stakeWords(x?.stakePct, x?.stake);
    const now = stakeWords(y?.stakePct, y?.stake);
    if (x && y && was !== now) out.push({ key: k, kind: "stake", change: `${was} → ${now}` });
  }
  return out;
}

export function listChanges(db: EngineDb): ChangeEntry[] {
  try {
    const v = JSON.parse(db.getSetting(LOG_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as ChangeEntry[]) : [];
  } catch {
    return [];
  }
}

/** Logs what changed between two saved settings (called by saveSendingSettings). `by` overrides the current source. */
export function recordChanges(db: EngineDb, before: Snapshot, after: Snapshot, by?: string, now = new Date()): number {
  const lines = diffSettings(before, after);
  if (lines.length === 0) return 0;
  const who = by ?? source ?? DEFAULT_SOURCE;
  const at = now.toISOString();
  db.setSetting(LOG_KEY, JSON.stringify([...lines.map((l) => ({ at, by: who, ...l })), ...listChanges(db)].slice(0, KEEP)));
  return lines.length;
}
