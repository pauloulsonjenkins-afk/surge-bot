"use client";

import { useStrategyNames } from "@/queries/use-strategy-names";

/** "Boiling Point (Blistering Momentum)": the app's name, with the original name in brackets, smaller and grey. */
export function StrategyName({ label }: { label: string }) {
  const { name, original } = useStrategyNames().parts(label);
  return (
    <>
      {name}
      {original && <span className="ml-1 text-[0.85em] font-normal text-ink-muted">({original})</span>}
    </>
  );
}
