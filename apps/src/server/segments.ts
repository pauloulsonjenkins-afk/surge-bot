/**
 * GOLDEN: slices of a strategy being watched, a part of its alerts that may be worth more than the rest. Each is
 * counted from its start date only, so the matches that suggested it can't also confirm it. Nothing is bet differently
 * unless the admin sets the slice's own betting (Sending settings segmentBets, "Bet it separately").
 *
 * Status (golden.ts): a candidate until it has 50 priced picks since its start; then Golden if it's making +3% or more
 * per £1 and beating the rest of its strategy, otherwise "not holding up".
 *
 * Built in (found by hand):
 *   Second Pour (Favourite pressure 2nd half), 18 Oct 2026: 0-0, or the pre-match favourite with 2x the opponent's
 *     dangerous attacks. Over its first 80 bets these won 85% (+26.8% per £1); the rest about half, losing.
 *   Wake-up Call (Time to fight), 20 Oct 2026: the sides 2+ goals apart. +6.2% over 265 bets; one-goal games -9.1% (732).
 *   Comeback Roast (Losing team pushing hard), 20 Oct 2026: the home side one goal down. +3.4% (128); the rest -14.6% (175).
 * Found by the Golden finder (golden.ts) and watched by the admin: kept in the "custom_segments" setting, as a rule of
 * FEATURES that must all be true.
 */

/** What a slice can see of the alert when it fired. */
export interface AlertFacts {
  goalsHome: number | null;
  goalsAway: number | null;
  /** Every "Label: a - b" stat in the alert (e.g. "Dangerous Attacks"). */
  stats: Record<string, [number, number]>;
  preMatch1x2: [number, number, number] | null;
  live1x2: [number, number, number] | null;
  /** The alert's minute (null for pre-match alerts). */
  minute?: number | null;
}

export interface Segment {
  id: string;
  /** Shown everywhere ("Golden: ..."), without the start date. */
  label: string;
  /** Counted from here only. */
  since: string;
  /** True when the alert is in the slice. */
  test: (f: AlertFacts) => boolean;
  /** For a slice made of FEATURES (all found by the finder, and the simple built-in ones): its rule, for matching. */
  rule?: Feature[];
  /** Added from the Golden finder (can be stopped); built-in ones can't. */
  custom?: boolean;
}

/** The pre-match favourite (the live price when the alert has no pre-match one), or null. */
function favourite(f: AlertFacts): "home" | "away" | null {
  const o = f.preMatch1x2 ?? f.live1x2;
  if (!o || !(o[0] > 1) || !(o[2] > 1) || o[0] === o[2]) return null;
  return o[0] < o[2] ? "home" : "away";
}
const diff = (f: AlertFacts) => (f.goalsHome === null || f.goalsAway === null ? null : f.goalsHome - f.goalsAway);
const total = (f: AlertFacts) => (f.goalsHome === null || f.goalsAway === null ? null : f.goalsHome + f.goalsAway);
/** The favourite's stat and the other side's, or null. */
function favStat(f: AlertFacts, name: string): [number, number] | null {
  const fav = favourite(f);
  const s = f.stats[name];
  if (!fav || !s) return null;
  return fav === "home" ? [s[0], s[1]] : [s[1], s[0]];
}
/** Goals the favourite is ahead by (negative = behind), or null. */
function favLead(f: AlertFacts): number | null {
  const d = diff(f);
  const fav = favourite(f);
  return d === null || !fav ? null : fav === "home" ? d : -d;
}

/** The building blocks the Golden finder combines (two at most, from different groups). */
export const FEATURES = {
  score00: { group: "score", label: "0-0", test: (f: AlertFacts) => total(f) === 0 },
  apart1: { group: "score", label: "1 goal apart", test: (f: AlertFacts) => Math.abs(diff(f) ?? 99) === 1 },
  apart2: { group: "score", label: "2+ goals apart", test: (f: AlertFacts) => Math.abs(diff(f) ?? -1) >= 2 },
  homeDown1: { group: "score", label: "home team 1 down", test: (f: AlertFacts) => diff(f) === -1 },
  awayDown1: { group: "score", label: "away team 1 down", test: (f: AlertFacts) => diff(f) === 1 },
  favAhead: { group: "favourite", label: "favourite ahead", test: (f: AlertFacts) => (favLead(f) ?? 0) > 0 },
  favLevel: { group: "favourite", label: "favourite level", test: (f: AlertFacts) => favLead(f) === 0 },
  favBehind: { group: "favourite", label: "favourite behind", test: (f: AlertFacts) => (favLead(f) ?? 0) < 0 },
  goals01: { group: "goals", label: "0-1 goals so far", test: (f: AlertFacts) => (total(f) ?? 99) <= 1 },
  goals23: { group: "goals", label: "2-3 goals so far", test: (f: AlertFacts) => [2, 3].includes(total(f) ?? -1) },
  goals4: { group: "goals", label: "4+ goals so far", test: (f: AlertFacts) => (total(f) ?? -1) >= 4 },
  min0to44: { group: "minute", label: "before 45'", test: (f: AlertFacts) => f.minute != null && f.minute < 45 },
  min45to59: { group: "minute", label: "45-59'", test: (f: AlertFacts) => f.minute != null && f.minute >= 45 && f.minute < 60 },
  min60to69: { group: "minute", label: "60-69'", test: (f: AlertFacts) => f.minute != null && f.minute >= 60 && f.minute < 70 },
  min70: { group: "minute", label: "70'+", test: (f: AlertFacts) => f.minute != null && f.minute >= 70 },
  favDa2x: {
    group: "pressure",
    label: "favourite with 2× the dangerous attacks",
    test: (f: AlertFacts) => {
      const s = favStat(f, "Dangerous Attacks");
      return !!s && s[0] >= 2 * Math.max(1, s[1]);
    },
  },
  favMomentum70: { group: "pressure", label: "favourite's momentum 70+", test: (f: AlertFacts) => (favStat(f, "Momentum")?.[0] ?? 0) >= 70 },
  favShots3: {
    group: "pressure",
    label: "favourite 3+ more shots on target",
    test: (f: AlertFacts) => {
      const s = favStat(f, "Shots On Target");
      return !!s && s[0] - s[1] >= 3;
    },
  },
  strongFav: {
    group: "price",
    label: "strong favourite (1.60 or shorter pre-match)",
    test: (f: AlertFacts) => {
      const o = f.preMatch1x2;
      return !!o && Math.min(o[0], o[2]) <= 1.6;
    },
  },
  closeMatch: {
    group: "price",
    label: "close match (both over 2.20 pre-match)",
    test: (f: AlertFacts) => {
      const o = f.preMatch1x2;
      return !!o && Math.min(o[0], o[2]) > 2.2;
    },
  },
} as const;
export type Feature = keyof typeof FEATURES;

/** "Golden: 0-0, favourite's momentum 70+" from a rule. */
export function ruleLabel(rule: Feature[]): string {
  return `Golden: ${rule.map((r) => FEATURES[r].label).join(", ")}`;
}
export function ruleTest(rule: Feature[]): (f: AlertFacts) => boolean {
  return (f) => rule.every((r) => FEATURES[r].test(f));
}

/** Built-in slices, keyed by lower-case strategy name. */
export const SEGMENTS: Record<string, Segment[]> = {
  "time to fight": [{ id: "two-apart", label: "Golden: 2+ goals apart", since: "2026-10-20T00:00:00.000Z", rule: ["apart2"], test: ruleTest(["apart2"]) }],
  "losing team pushing hard": [
    { id: "home-one-down", label: "Golden: home team 1 down", since: "2026-10-20T00:00:00.000Z", rule: ["homeDown1"], test: ruleTest(["homeDown1"]) },
  ],
  "favourite pressure 2nd half": [
    {
      id: "golden",
      label: "Golden: 0-0, or favourite with 2× the dangerous attacks",
      since: "2026-10-18T12:00:00.000Z",
      test: (f) => FEATURES.score00.test(f) || FEATURES.favDa2x.test(f),
    },
  ],
};

/** A slice added from the Golden finder (stored in the "custom_segments" setting). */
export interface CustomSegment {
  strategyKey: string;
  id: string;
  rule: Feature[];
  since: string;
}

let custom: CustomSegment[] = [];

/** Replaces the watched custom slices (loaded at start-up and after each change, golden.ts). */
export function setCustomSegments(list: CustomSegment[]): void {
  custom = list.filter((c) => Array.isArray(c.rule) && c.rule.length > 0 && c.rule.every((r) => r in FEATURES));
}

/** Every slice watched for a strategy: built-in first, then the ones added from the finder. */
export function segmentsOf(strategyKey: string): Segment[] {
  const own = custom
    .filter((c) => c.strategyKey === strategyKey)
    .map((c): Segment => ({ id: c.id, label: ruleLabel(c.rule), since: c.since, rule: c.rule, test: ruleTest(c.rule), custom: true }));
  return [...(SEGMENTS[strategyKey] ?? []), ...own];
}
