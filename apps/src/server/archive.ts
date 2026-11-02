/**
 * The strategy archive (2 Nov 2026, the owner's request): old strategies they no longer use are hidden from every page,
 * but kept on record so they are not built again by mistake.
 *
 * Archiving a strategy:
 *   - hides it from the Strategies, Profit, Betting, Today and Golden lists (the site filters on archivedKeys);
 *   - stops it being suggested anything (strategy-advice.ts) or mentioned in Claude's daily note;
 *   - switches it, and any slice of it, back to Sim, so a stale Live switch can never place a bet;
 *   - changes NO money figure: its bets stay in every total, Trade Log and the Profit page's headline numbers, because the
 *     real-money history is the record and deleting it would change what was won and lost.
 * It is a note on the strategy, not a delete: restoring it puts everything back as it was (apart from the Live switch,
 * which stays in Sim for the owner to turn on again deliberately).
 *
 * The Archive page (More, under Settings and tools) lists them with what they did and why they were archived.
 */
import type { EngineDb } from "../storage/engine-db";
import { getSendingSettings, saveSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { computeStrategyReturns, type StrategyReturn } from "./winloss";
import { log } from "./log";

const KEY = "archived_strategies";

export interface ArchivedStrategy {
  /** Lower case, as GoalBrew keys strategies. */
  key: string;
  archivedAt: string;
  /** Why, in the owner's words or ours ("deleted from InPlayGuru", "lost 14% over 50 Live bets"). */
  note: string | null;
}

function load(db: EngineDb): Record<string, ArchivedStrategy> {
  try {
    return JSON.parse(db.getSetting(KEY) ?? "{}") as Record<string, ArchivedStrategy>;
  } catch {
    return {};
  }
}

const keyOf = (label: string) => strategyLabel(label.trim()).trim().toLowerCase();

/** Every archived strategy, by key. */
export function getArchived(db: EngineDb): Record<string, ArchivedStrategy> {
  return load(db);
}

export function isArchived(db: EngineDb, label: string): boolean {
  return keyOf(label) in load(db);
}

/**
 * Archives (or restores) one strategy. Archiving also puts the strategy and every slice of it back to Sim. Returns what
 * changed, for the log and the reply.
 */
export function setArchived(db: EngineDb, label: string, archived: boolean, note: string | null = null, now = new Date()): { key: string; archived: boolean; switchedOff: string[] } {
  const key = keyOf(label);
  if (!key) throw new Error("Which strategy?");
  const all = load(db);
  const switchedOff: string[] = [];
  if (archived) {
    all[key] = { key, archivedAt: now.toISOString(), note: note && note.trim() ? note.trim().slice(0, 200) : null };
    const s = getSendingSettings(db);
    const patch: { strategies?: Record<string, boolean>; segmentBets?: Record<string, { live: boolean }> } = {};
    if (s.strategies[key] === true) {
      patch.strategies = { [key]: false };
      switchedOff.push(key);
    }
    for (const [k, v] of Object.entries(s.segmentBets)) {
      if (k.startsWith(`${key}#`) && v.live) {
        (patch.segmentBets ??= {})[k] = { live: false };
        switchedOff.push(k);
      }
    }
    if (patch.strategies || patch.segmentBets) saveSendingSettings(db, patch);
  } else {
    delete all[key];
    // Restored on purpose: the automatic archiving below leaves it alone from now on.
    const kept = loadKept(db);
    kept[key] = (now ?? new Date()).toISOString();
    db.setSetting(KEPT_KEY, JSON.stringify(kept));
  }
  db.setSetting(KEY, JSON.stringify(all));
  log.info(`Strategy "${label}" ${archived ? `archived${switchedOff.length ? ` (switched back to Sim: ${switchedOff.join(", ")})` : ""}` : "restored from the archive"}.`);
  return { key, archived, switchedOff };
}

const KEPT_KEY = "archive_kept";
const SEEDED_KEY = "archive_seeded_v1";
/** Strategies with no new alert for this long, and not Live, are archived. */
export const QUIET_DAYS = 30;
/** The strategies the owner retired on 2 Nov 2026 (deleted from InPlayGuru, or judged not worth running). Archived once. */
const RETIRED: Array<[string, string]> = [
  ["first half goal", "Retired 2 Nov 2026: replaced by the FH Goal strategies."],
  ["pass master 1st half", "Retired 2 Nov 2026."],
  ["late goal hunter", "Deleted from InPlayGuru, 2 Nov 2026."],
  ["sustained momentum", "Deleted from InPlayGuru, 2 Nov 2026."],
  ["both teams to score", "Retired 2 Nov 2026."],
  ["fh goal xg game state", "Retired 2 Nov 2026."],
];

function loadKept(db: EngineDb): Record<string, string> {
  try {
    return JSON.parse(db.getSetting(KEPT_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Archives old strategies without being asked: once, the retired list above; and always, any strategy with no alert for
 * QUIET_DAYS days that isn't Live. A strategy restored from the Archive page is never archived again by this. Returns the
 * keys archived this time.
 */
export function autoArchive(db: EngineDb, now = new Date()): string[] {
  const archived = load(db);
  const kept = loadKept(db);
  const live = getSendingSettings(db).strategies;
  const rows = db.listStrategiesForAdmin();
  const done: string[] = [];
  const seeded = db.getSetting(SEEDED_KEY) !== null;
  const retired = new Map(RETIRED);
  for (const r of rows) {
    const key = r.label.trim().toLowerCase();
    if (archived[key] || kept[key] || live[key] === true) continue;
    const quiet = now.getTime() - Date.parse(r.lastAlertAt) > QUIET_DAYS * 86_400_000;
    const note = !seeded && retired.has(key) ? retired.get(key)! : quiet ? `No alerts for ${QUIET_DAYS} days (last ${r.lastAlertAt.slice(0, 10)}).` : null;
    if (note === null) continue;
    setArchived(db, r.label, true, note, now);
    done.push(key);
  }
  db.setSetting(SEEDED_KEY, now.toISOString());
  return done;
}

/** Runs the automatic archiving a minute after start and every six hours. */
export function startAutoArchive(db: EngineDb): void {
  const run = () => {
    try {
      const done = autoArchive(db);
      if (done.length > 0) log.info(`Archived ${done.length} old strateg${done.length === 1 ? "y" : "ies"}: ${done.join(", ")}.`);
    } catch (err) {
      log.warn(`Automatic archiving failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  setTimeout(run, 60_000).unref?.();
  setInterval(run, 6 * 3_600_000).unref?.();
}

export interface ArchiveRow {
  key: string;
  label: string;
  archivedAt: string;
  note: string | null;
  alerts: number;
  firstAlertAt: string | null;
  lastAlertAt: string | null;
  /** What it did, all time: Live and Sim bets, return per £1 and units. */
  live: Pick<StrategyReturn, "counted" | "profit" | "units" | "roi">;
  sim: Pick<StrategyReturn, "counted" | "profit" | "units" | "roi">;
}

/** The Archive page: each archived strategy with its record. Information only. */
export function archiveRows(db: EngineDb): ArchiveRow[] {
  const archived = load(db);
  const keys = Object.keys(archived);
  if (keys.length === 0) return [];
  const returns = computeStrategyReturns(db, null);
  const seen = new Map(db.listStrategiesForAdmin().map((x) => [x.label.toLowerCase(), x]));
  const trim = (r: StrategyReturn | undefined) => ({ counted: r?.counted ?? 0, profit: r?.profit ?? 0, units: r?.units ?? 0, roi: r?.roi ?? null });
  return keys
    .map((key) => {
      const a = archived[key]!;
      const row = seen.get(key) as { label: string; alerts?: number; firstAlertAt?: string | null; lastAlertAt?: string | null } | undefined;
      return {
        key,
        label: row?.label ?? key,
        archivedAt: a.archivedAt,
        note: a.note,
        alerts: row?.alerts ?? 0,
        firstAlertAt: row?.firstAlertAt ?? null,
        lastAlertAt: row?.lastAlertAt ?? null,
        live: trim(returns[key]?.live),
        sim: trim(returns[key]?.sim),
      };
    })
    .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}
