import { TriangleAlert } from "lucide-react";

/**
 * The one status chip the app uses, so a colour always means the same thing:
 *   hit / loss  money and results only: won, lost, hit, miss
 *   warn        something needs you: not placed, not matched, not on Betfair, needs review (always with the warning icon)
 *   neutral     a plain fact about a bet: matched at a price, placed by hand
 *   muted       in progress, nothing to do: sent and being checked, waiting for kick-off
 * Live and Sim are modes, not results, so they have their own look (ModeBadge): a dot for Live, a dashed outline for Sim.
 */
export type ChipTone = "hit" | "loss" | "warn" | "neutral" | "muted";

const TONES: Record<ChipTone, string> = {
  hit: "bg-hit/15 text-hit",
  loss: "bg-loss/15 text-loss",
  warn: "bg-warn/15 text-warn",
  neutral: "bg-surface-2 text-ink",
  muted: "bg-surface-2 text-ink-muted",
};

export function Chip({ tone = "neutral", title, children }: { tone?: ChipTone; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${TONES[tone]}`}>
      {tone === "warn" && <TriangleAlert size={12} aria-hidden className="shrink-0" />}
      {children}
    </span>
  );
}

/** A warning that doesn't need a whole chip: the icon alone, with the reason on hover and for screen readers. */
export function WarnIcon({ label, detail }: { label: string; detail?: string }) {
  return (
    <span title={detail ? `${label}. ${detail}` : label} className="inline-flex shrink-0 items-center text-warn">
      <TriangleAlert size={14} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
