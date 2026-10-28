"use client";

import { useStrategyNames } from "@/queries/use-strategy-names";

/**
 * "Boiling Point (Blistering Momentum)": the app's name, with the original name in brackets, smaller and grey. The
 * admin's short names ("Fav Pressure 2H") show alone, to fit narrow rows, with InPlayGuru's full name on hover or a
 * long press; `withOriginal` (a strategy's own card) shows it in brackets too.
 */
export function StrategyName({ label, withOriginal = false }: { label: string; withOriginal?: boolean }) {
  const { name, original, short } = useStrategyNames().parts(label);
  return (
    <span title={original ?? undefined}>
      {name}
      {original && (!short || withOriginal) && <span className="ml-1 text-[0.85em] font-normal text-ink-muted">({original})</span>}
    </span>
  );
}
