/**
 * Learning from the owner's calls (Free tips page, 2 Nov 2026). Channels post to a template ("THURSDAY FREE BET IS HERE ...
 * ODDS @1.48 ... 10:00 UK"), so a message that reads like one the owner confirmed as a tip, from the same channel, is
 * probably a tip too, and one that reads like a "Not a tip" probably isn't.
 *
 * Similarity is the overlap of the words used (numbers, emoji and short words ignored), so team names and prices that change
 * from post to post barely matter. It only ever moves a reading one step and says so in the reasons; it never makes a tip
 * out of something that names no match or price, and the owner's own call on a message always wins.
 */
import type { TipRead } from "./classify";

/** How alike two messages must be (0 to 1) to count as the same kind of post. */
export const SIMILAR_FROM = 0.5;
/** And how much more alike to one side than the other. */
const MARGIN = 0.1;

export function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 3),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

export interface Reviewed {
  text: string;
  review: "tip" | "not";
}

/** The best likeness to a confirmed tip and to a rejected one. */
export function likeness(text: string, reviewed: Reviewed[]): { tip: number; not: number } {
  const mine = wordsOf(text);
  let tip = 0;
  let not = 0;
  for (const r of reviewed) {
    const s = similarity(mine, wordsOf(r.text));
    if (r.review === "tip") tip = Math.max(tip, s);
    else not = Math.max(not, s);
  }
  return { tip, not };
}

/** Adjusts a reading by what the owner confirmed or rejected from the same channel. Pure. */
export function applyLearning(read: TipRead, text: string, reviewed: Reviewed[]): TipRead {
  if (reviewed.length === 0) return read;
  const { tip, not } = likeness(text, reviewed);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  if (tip >= SIMILAR_FROM && tip > not + MARGIN) {
    // Only where the post names a match and a price: a similar template alone isn't a bet.
    if (read.verdict === "maybe" || ((read.verdict === "other" || read.verdict === "advert") && read.match !== null && read.odds !== null)) {
      return { ...read, verdict: read.verdict === "maybe" ? "tip" : "maybe", reasons: [...read.reasons, `reads like a tip you confirmed (${pct(tip)} alike)`] };
    }
    return read;
  }
  if (not >= SIMILAR_FROM && not > tip + MARGIN && read.verdict === "tip") {
    return { ...read, verdict: "maybe", reasons: [...read.reasons, `reads like one you marked Not a tip (${pct(not)} alike)`] };
  }
  return read;
}
