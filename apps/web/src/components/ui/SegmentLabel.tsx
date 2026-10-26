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
