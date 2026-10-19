import { Sparkles } from "lucide-react";

/** A watched slice's status (engine golden.ts). */
export type SliceStatus = "candidate" | "golden" | "not holding up";

/**
 * A watched slice's label. Every slice is named "Golden: …" by the engine, but gold is kept for the ones that have
 * earned it: the word "Golden" is picked out in gold only once the slice is confirmed Golden. Until then (or while its
 * status isn't known) it reads as plain text, so a slice still being proved never looks proven.
 */
export function SegmentLabel({ label, status }: { label: string; status?: SliceStatus | null }) {
  const parts = label.split(/(Golden)/);
  return (
    <>
      {parts.map((p, i) =>
        p === "Golden" ? (
          <span key={i} className={status === "golden" ? "font-semibold text-gold" : "font-medium"}>
            Golden
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** A slice's name without the engine's "Golden: " in front, for places that show its status separately. */
export function sliceName(label: string): string {
  return label.replace(/^Golden: /, "");
}

/**
 * A watched slice's badge: a metal gold chip once it's confirmed Golden; an outlined gold chip while it's a candidate
 * (or its status hasn't loaded); red once it isn't holding up.
 */
export function GoldenBadge({ status, candidate = "Golden candidate" }: { status: SliceStatus | null | undefined; candidate?: string }) {
  const base = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs";
  if (status === "golden")
    return (
      <span className={`${base} gold-chip font-semibold`}>
        <Sparkles size={12} aria-hidden />
        Golden
      </span>
    );
  if (status === "not holding up") return <span className={`${base} bg-loss/15 font-medium text-loss`}>Not holding up</span>;
  return <span className={`${base} gold-chip-outline font-medium`}>{status === "candidate" ? candidate : "Being watched"}</span>;
}
