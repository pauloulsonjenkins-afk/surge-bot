/**
 * Team-name learning: when Betfair lists an alert's match with one team spelled differently ("Celta Vigo B v Tenerife"
 * for "Celta Fortuna v Tenerife"), and it can only be that match, the Match names line is added by itself and the pick
 * is treated as on Betfair under Betfair's name, so it's bet like any other. Only when all of these hold:
 *
 *   - the names say it's the same club (learnableName: one team the same, the other a close name, reserves alike);
 *   - it's the only event Betfair's searches returned that could be this match;
 *   - Betfair's kick-off is within 25 minutes of the alert's (alert time less its minute): a team can't play two
 *     matches at once, so a same-time event with the same opponent is this match;
 *   - the team has no Match names line already (the admin's own line is never replaced).
 *
 * Each name learned is kept in a list with a phone notification that has an Undo button (public/sw.js); Undo (there or on
 * Betting → Limits) takes the Match names line out again. Undo can't take back a bet already placed.
 */
import type { EngineDb, LivePick } from "../storage/engine-db";
import { addMatchName, getSendingSettings, kickoffAt, saveSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { couldBeSameMatch, eventScore, learnableName } from "./reconcile";
import { sendPush, type PushMessage } from "../server/push";
import { log } from "../server/log";

const KEY = "learned_names";
const KEEP = 50;
/** How far Betfair's kick-off may be from the one worked out from the alert. */
const KICKOFF_SLACK_MS = 25 * 60_000;

export interface LearnedName {
  from: string;
  to: string;
  /** The match as the alert wrote it, and as Betfair does. */
  match: string;
  event: string;
  pickId: number;
  strategy: string;
  at: string;
  /** When it was undone, if it was. */
  undoneAt: string | null;
}

export function learnedNames(db: EngineDb): LearnedName[] {
  try {
    const list = JSON.parse(db.getSetting(KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? (list as LearnedName[]) : [];
  } catch {
    return [];
  }
}

/**
 * The kick-off the alert implies: posted time less its minute (and 15 minutes' half-time in the second half), or a
 * pre-match pick's estimated kick-off.
 */
export function kickoffOf(p: LivePick): number | null {
  if (p.minute === null) return kickoffAt(p);
  if (p.minute < 0 || p.minute > 130) return null;
  const posted = Date.parse(p.messageAt ?? p.firstSeenAt);
  if (!Number.isFinite(posted)) return null;
  return posted - (p.minute + (p.minute > 45 ? 15 : 0)) * 60_000;
}

/**
 * The Match names line to learn from a "nameDiffers" check, or null when it isn't sure enough (see the top of the file).
 * `home`/`away` are the alert's names after Match names; `seen` is every event Betfair's searches returned.
 */
export function nameToLearn(
  p: LivePick,
  home: string,
  away: string,
  judged: { result: string; event: string | null; eventId: string | null },
  seen: Array<{ id: string; name: string; openDate?: string }>,
): { from: string; to: string } | null {
  if (judged.result !== "nameDiffers" || !judged.event || !judged.eventId || !p.home || !p.away) return null;
  const pickEvent = `${home} v ${away}`;
  const name = learnableName(judged.event, pickEvent);
  if (!name) return null;
  // The team as the alert writes it must have no line yet: the line learned is "alert name = Betfair's name".
  const original = name.from === home ? p.home : name.from === away ? p.away : null;
  if (!original || original.trim().toLowerCase() !== name.from.toLowerCase()) return null;
  const could = new Set(seen.filter((e) => couldBeSameMatch(e.name, pickEvent) && eventScore(e.name, pickEvent) >= 1).map((e) => e.id));
  if (could.size !== 1 || !could.has(judged.eventId)) return null;
  const kickoff = kickoffOf(p);
  const open = Date.parse(seen.find((e) => e.id === judged.eventId)?.openDate ?? "");
  if (kickoff === null || !Number.isFinite(open) || Math.abs(open - kickoff) > KICKOFF_SLACK_MS) return null;
  return name;
}

/** Saves the learned line and notes it in the list. Returns the entry, or null if Match names refused it. */
export function learnName(db: EngineDb, p: LivePick, name: { from: string; to: string }, event: string, now = new Date()): LearnedName | null {
  try {
    addMatchName(db, name.from, name.to);
  } catch (err) {
    log.warn(`Couldn't learn "${name.from} = ${name.to}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const entry: LearnedName = {
    from: name.from,
    to: name.to,
    match: `${p.home} v ${p.away}`,
    event,
    pickId: p.id,
    strategy: strategyLabel(p.strategy).toLowerCase(),
    at: now.toISOString(),
    undoneAt: null,
  };
  db.setSetting(KEY, JSON.stringify([entry, ...learnedNames(db)].slice(0, KEEP)));
  log.info(`Team name learned from pick ${p.id}: "${name.from} = ${name.to}" (${entry.match} is ${event} on Betfair).`);
  return entry;
}

/**
 * Takes a learned line out of Match names again (only if it still says what was learned) and marks it undone.
 * Throws with a reason for the admin.
 */
export function undoLearnedName(db: EngineDb, from: unknown, to: unknown, now = new Date()): string {
  const list = learnedNames(db);
  const entry = list.find((e) => e.from === from && e.to === to && !e.undoneAt);
  if (!entry) throw new Error("That learned name isn't there to undo (already undone?).");
  const line = (l: string) => {
    const i = l.indexOf("=");
    return i > 0 && l.slice(0, i).trim().toLowerCase() === entry.from.toLowerCase() && l.slice(i + 1).trim() === entry.to;
  };
  const aliases = getSendingSettings(db).aliases.split("\n");
  if (aliases.some(line)) saveSendingSettings(db, { aliases: aliases.filter((l) => !line(l)).join("\n") });
  entry.undoneAt = now.toISOString();
  db.setSetting(KEY, JSON.stringify(list));
  log.info(`Learned team name undone: "${entry.from} = ${entry.to}".`);
  return `Taken out: ${entry.from} = ${entry.to}.`;
}

export function learnedNotification(db: EngineDb, e: LearnedName): PushMessage {
  return {
    title: `Learned: ${e.from} = ${e.to}`,
    body: `${displayName(db, e.strategy)}: ${e.match} is "${e.event}" on Betfair, so it's bet under Betfair's name. Wrong? Tap Undo.`,
    url: "/more/admin/sending",
    tag: `learned-${e.pickId}`,
    undoName: { from: e.from, to: e.to },
  };
}

/** Sends the notification for a learned name. Never throws. */
export async function notifyLearned(db: EngineDb, e: LearnedName): Promise<void> {
  try {
    await sendPush(db, learnedNotification(db, e));
  } catch (err) {
    log.warn(`Learned-name notification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
