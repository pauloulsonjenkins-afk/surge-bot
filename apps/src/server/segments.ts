/**
 * Slices of a strategy being watched on its card: a part of its alerts that may be worth more (or less) than the
 * rest. Nothing is bet differently; the card just shows the slice's record against the rest, so a split can be decided
 * on new matches rather than the ones that suggested it.
 *
 * Second Pour (Favourite pressure 2nd half), added 18 Oct 2026: over its first 80 bets, alerts at 0-0, or where the
 * pre-match favourite had at least twice the opponent's dangerous attacks, won 85% (+26.8% per £1); the rest about
 * half, losing. Found by searching ~20 splits, so it needs about 50 new bets before it's trusted.
 */

/** What a segment can see of the alert when it fired. */
export interface AlertFacts {
  goalsHome: number | null;
  goalsAway: number | null;
  /** Every "Label: a - b" stat in the alert (e.g. "Dangerous Attacks"). */
  stats: Record<string, [number, number]>;
  preMatch1x2: [number, number, number] | null;
  live1x2: [number, number, number] | null;
}

export interface Segment {
  id: string;
  /** Shown on the card. */
  label: string;
  /** Counted from here only: the matches that suggested it can't also confirm it. */
  since: string;
  /** True when the alert is in the slice. */
  test: (f: AlertFacts) => boolean;
}

/** The pre-match favourite (the live price when the alert has no pre-match one), or null. */
function favourite(f: AlertFacts): "home" | "away" | null {
  const o = f.preMatch1x2 ?? f.live1x2;
  if (!o || !(o[0] > 1) || !(o[2] > 1) || o[0] === o[2]) return null;
  return o[0] < o[2] ? "home" : "away";
}

export const SEGMENTS: Record<string, Segment[]> = {
  "favourite pressure 2nd half": [
    {
      id: "golden",
      label: "Golden since 18 Oct (0-0, or favourite with 2× the dangerous attacks)",
      since: "2026-10-18T12:00:00.000Z",
      test: (f) => {
        if (f.goalsHome === 0 && f.goalsAway === 0) return true;
        const fav = favourite(f);
        const da = f.stats["Dangerous Attacks"];
        if (!fav || !da) return false;
        const [mine, theirs] = fav === "home" ? da : [da[1], da[0]];
        return mine >= 2 * Math.max(1, theirs);
      },
    },
  ],
};
