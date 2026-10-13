/**
 * "Why this fired": one plain sentence about the match when an alert came, written from the stats in the alert.
 *
 * Fixed wording, no AI: the same stats always give the same sentence, and nothing is made up. It describes the match in
 * RELATIVE terms only (who is on top, whether chances are coming, the score situation), never the figures or a
 * strategy's thresholds, so a run of these can't be used to rebuild a strategy's rules. Members only, and only on
 * picks their access already shows in full.
 */
import type { LivePick } from "../storage/engine-db";

type Pair = [number, number];

const stat = (p: LivePick, label: string): Pair | null => {
  const v = p.detail?.stats?.[label];
  return Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n)) ? v : null;
};

/** The stronger side's share of a stat, 0.5 when level or unknown. */
const share = (v: Pair | null): number => (v && v[0] + v[1] > 0 ? Math.max(v[0], v[1]) / (v[0] + v[1]) : 0.5);
const leader = (v: Pair | null): 0 | 1 | null => (!v || v[0] === v[1] ? null : v[0] > v[1] ? 0 : 1);

export function whyFired(p: LivePick): string | null {
  const momentum = stat(p, "Momentum");
  const danger = stat(p, "Dangerous Attacks");
  const onTarget = stat(p, "Shots On Target");
  const xg = stat(p, "xG");
  const corners = stat(p, "Corners");
  const reds = stat(p, "Red Cards");
  if (!momentum && !danger && !onTarget && !xg) return null;

  const names: [string, string] = [p.home ?? "The home side", p.away ?? "The away side"];
  // Who is on top: momentum first, else dangerous attacks.
  const lead = momentum ? leader(momentum) : leader(danger);
  const dominance = Math.max(share(momentum), share(danger));
  const parts: string[] = [];

  if (lead !== null && dominance >= 0.7) parts.push(`${names[lead]} piling on the pressure`);
  else if (lead !== null && dominance >= 0.58) parts.push(`${names[lead]} on top`);
  else parts.push("An open, end-to-end game");

  const shots = onTarget ? onTarget[0] + onTarget[1] : null;
  const shotLead = leader(onTarget);
  const goals = p.goalsHome !== null && p.goalsAway !== null ? p.goalsHome + p.goalsAway : null;
  const totalXg = xg ? xg[0] + xg[1] : null;
  if (totalXg !== null && goals !== null && totalXg - goals >= 1) parts.push("the chances created say a goal is overdue");
  else if (shotLead !== null && shotLead === lead && share(onTarget) >= 0.7 && (shots ?? 0) >= 3) parts.push("creating most of the clear chances");
  else if (shots !== null && shots >= 8) parts.push("plenty of shots on target");
  else if (shots !== null && shots <= 2) parts.push("few clear chances so far");

  // The score situation, seen from the side on top.
  if (lead !== null && dominance >= 0.58 && p.goalsHome !== null && p.goalsAway !== null) {
    const own = lead === 0 ? p.goalsHome : p.goalsAway;
    const other = lead === 0 ? p.goalsAway : p.goalsHome;
    if (own < other) parts.push("and chasing the game");
    else if (own === other) parts.push(p.goalsHome === 0 ? "still goalless" : "with the scores level");
  }

  const extras: string[] = [];
  if (reds && reds[0] !== reds[1]) extras.push(`${names[reds[0] > reds[1] ? 0 : 1]} down to ${reds[0] > reds[1] ? 11 - reds[0] : 11 - reds[1]} men`);
  else if (corners && corners[0] + corners[1] >= 10) extras.push("Lots of corners");
  if (p.minute !== null && p.minute >= 75) extras.push("Late in the game");

  // "A, B and C": the last part joins with "and" unless it already starts with it.
  const last = parts.length > 2 && !parts[parts.length - 1]!.startsWith("and ") ? `and ${parts.pop()}` : parts.pop()!;
  const sentence = parts.length ? `${parts.join(", ")}, ${last}` : last;
  return [`${sentence}.`, ...extras.map((e) => `${e}.`)].join(" ");
}
