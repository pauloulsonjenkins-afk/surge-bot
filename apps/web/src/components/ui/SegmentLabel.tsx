import { Sparkles } from "lucide-react";

/** A watched slice's stage (engine golden.ts). */
export type SliceStatus = "quiet" | "candidate" | "trial" | "full" | "not holding up";

/**
 * A watched slice's label. Every slice is named "Golden: …" by the engine, but gold is kept for the ones that have
 * earned it: the word "Golden" is picked out in gold only once the slice has reached full stake. Until then (or while
 * its stage isn't known) it reads as plain text, so a slice still being proved never looks proven.
 */
export function SegmentLabel({ label, status }: { label: string; status?: SliceStatus | null }) {
  const parts = label.split(/(Golden)/);
  return (
    <>
      {parts.map((p, i) =>
        p === "Golden" ? (
          <span key={i} className={status === "full" ? "font-semibold text-gold" : "font-medium"}>
            Golden
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Of the watched slices an alert is in, the stage to show: full first, then trial, candidate, not holding up. */
export function bestStatus(statuses: Array<SliceStatus | null>): SliceStatus | null {
  return (["full", "trial", "candidate", "not holding up", "quiet"] as const).find((s) => statuses.includes(s)) ?? null;
}

const STAGE_RANK: Record<SliceStatus, number> = { full: 0, trial: 1, candidate: 2, quiet: 3, "not holding up": 4 };

/**
 * Slices best first (owner, 8 Nov 2026: "where a strategy has a slice performing well, put the performing ones at the
 * top"): by Golden stage (full stake, Live trial, candidate, watched, not holding up), then by return per £1 after
 * allowing for luck (roi x n / (n + 50), as the suggestions judge it), so a lucky few picks don't jump the queue.
 */
export function bestSlicesFirst<T>(items: T[], statusOf: (t: T) => SliceStatus | null, ret: (t: T) => { roi: number | null; counted: number } | null): T[] {
  const adjusted = (t: T) => {
    const r = ret(t);
    return r && r.roi !== null && r.counted > 0 ? (r.roi * r.counted) / (r.counted + 50) : -Infinity;
  };
  return [...items].sort((a, b) => STAGE_RANK[statusOf(a) ?? "quiet"] - STAGE_RANK[statusOf(b) ?? "quiet"] || adjusted(b) - adjusted(a));
}

/** A slice's name without the engine's "Golden: " in front, for places that show its status separately. */
export function sliceName(label: string): string {
  return label.replace(/^Golden: /, "");
}

/**
 * A watched slice's badge: a metal gold chip at full stake; an outlined gold chip for a small Live trial suggested, or
 * a candidate (or its stage not yet loaded); red once it isn't holding up.
 */
export function GoldenBadge({ status, candidate = "Golden candidate", trial = "Live trial suggested" }: { status: SliceStatus | null | undefined; candidate?: string; trial?: string }) {
  const base = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs";
  if (status === "full")
    return (
      <span className={`${base} gold-chip font-semibold`}>
        <Sparkles size={12} aria-hidden />
        Golden
      </span>
    );
  if (status === "not holding up") return <span className={`${base} bg-loss/15 font-medium text-loss`}>Not holding up</span>;
  return <span className={`${base} gold-chip-outline font-medium`}>{status === "trial" ? trial : status === "candidate" ? candidate : "Being watched"}</span>;
}
