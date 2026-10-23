"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDialog } from "@/components/ui/ConfirmDialog";
import type { StrategyAdvice } from "@/server/engine-client";

/**
 * Strategy suggestions (strategy-advice.ts in the engine): shown on Today and on Strategies, each with its own Apply.
 * Nothing changes until Apply is pressed and confirmed, since it changes real-money betting.
 */
export const ADVICE_LABEL: Record<StrategyAdvice["kind"], string> = {
  "try-live": "ready to try Live",
  "back-to-sim": "consider putting back to Sim",
  "stake-up": "worth a bigger stake",
  "stake-down": "worth a smaller stake",
  "league-block": "losing in one league",
};

/** A suggestion that would bet more (go Live, a bigger stake), as against one that would bet less. */
export const isGoodAdvice = (a: StrategyAdvice) => a.kind === "try-live" || a.kind === "stake-up";

/** The Apply button for one suggestion: asks first, then shows what was done. */
export function ApplyAdvice({ a, name, size = "sm" }: { a: StrategyAdvice; name: string; size?: "sm" | "md" }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [done, setDone] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/advice/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: a.key, kind: a.kind, ...(a.league ? { league: a.league.key } : {}) }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't apply that.");
    },
    onSuccess: () => {
      setDone(a.action ?? "Done");
      void qc.invalidateQueries();
    },
  });
  if (!a.action) return null;
  if (done) return <span className="shrink-0 text-xs text-hit">Done: {done}</span>;
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={apply.isPending}
        onClick={async (e) => {
          e.stopPropagation();
          if (await dialog.confirm({ title: `${name}: ${a.action}?`, tone: "money", confirmLabel: a.action!, body: <p>{a.reason}</p> })) apply.mutate();
        }}
        className={`rounded-md bg-accent font-semibold text-accent-ink disabled:opacity-50 ${size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"}`}
      >
        {apply.isPending ? "Applying…" : a.action}
      </button>
      {apply.error && <span className="text-xs text-destructive">{apply.error.message}</span>}
    </span>
  );
}

/** One suggestion in a list: who, what, why, and Apply. */
export function AdviceRow({ a, name, link = true }: { a: StrategyAdvice; name: string; link?: boolean }) {
  const good = isGoodAdvice(a);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2">
      <span className="min-w-0 flex-1">
        {link ? (
          <Link href={a.league ? "/more/admin/leagues?tab=profit" : "/more/admin/strategies"} className="font-medium text-ink underline decoration-line">
            {name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{name}</span>
        )}{" "}
        <span className={good ? "text-hit" : "text-warn"}>{ADVICE_LABEL[a.kind]}</span>
        <span className="block text-xs text-ink-muted">{a.reason}</span>
      </span>
      <ApplyAdvice a={a} name={name} />
    </li>
  );
}
