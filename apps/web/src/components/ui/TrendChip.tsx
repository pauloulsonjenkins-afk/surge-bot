import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatSignedPercent } from "@/lib/format";

/**
 * changePct is undefined when there's no meaningful prior value to compare
 * against (e.g. previous period was exactly zero) — shown as a neutral dash
 * rather than a misleading "+∞%".
 */
export function TrendChip({ changePct }: { changePct: number | undefined }) {
  if (changePct === undefined) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-muted">
        <Minus size={11} />
        n/a
      </span>
    );
  }

  const flat = Math.abs(changePct) < 0.05;
  const up = changePct > 0;

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
        flat
          ? "bg-surface-2 text-ink-muted"
          : up
            ? "bg-emerald-500/10 text-emerald-400"
            : "bg-danger/10 text-danger"
      }`}
    >
      {flat ? <Minus size={11} /> : up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {formatSignedPercent(changePct)}
    </span>
  );
}
