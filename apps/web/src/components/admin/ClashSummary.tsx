"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import type { ClashCheck } from "@/server/engine-client";

function useClashCheck(strategyKey: string, enabled = true) {
  return useQuery({
    queryKey: ["clash-check", strategyKey.toLowerCase()],
    queryFn: ({ signal }) => getJson<ClashCheck>(`/api/admin/clash-check?strategy=${encodeURIComponent(strategyKey.toLowerCase())}`, "the clash check", signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Before a strategy goes Live: how its picks over the last 30 days met what is Live now (engine clash-check.ts).
 * Cancels are blocked by the clash guard; offsets and doubles still go, so they're worth knowing about.
 */
export function ClashSummary({ strategyKey, compact = false }: { strategyKey: string; compact?: boolean }) {
  const q = useClashCheck(strategyKey);
  if (q.isLoading) return <p className="text-xs text-ink-muted">Checking for clashes with your Live strategies…</p>;
  if (q.error || !q.data) return <p className="text-xs text-warn">Couldn&apos;t check for clashes: {q.error instanceof Error ? q.error.message : "no answer"}.</p>;
  const c = q.data;
  if (c.shared === 0)
    return (
      <p className={`text-xs ${compact ? "text-ink-muted" : "text-hit"}`}>
        No clashes: none of its {plural(c.picks, "pick")} in the last {c.days} days were on a match with a Live bet.
      </p>
    );
  const worry = c.totals.cancels > 0 || c.totals.offsets > 0;
  return (
    <div className="space-y-1 text-xs">
      <p className={worry ? "text-warn" : "text-ink"}>
        <strong>Clash check, last {c.days} days:</strong> {c.shared} of its {plural(c.picks, "pick")} were on a match with a Live bet.
      </p>
      <ul className="space-y-0.5">
        {c.against.slice(0, compact ? 3 : 6).map((r) => (
          <li key={r.key} className="text-ink-muted">
            <span className="font-medium text-ink">{r.name}</span>:{" "}
            {[
              r.cancels ? <span key="c" className="text-warn">{r.cancels} would cancel (now blocked)</span> : null,
              r.offsets ? <span key="o" className="text-warn">{r.offsets} partly offset</span> : null,
              r.doubles ? `${r.doubles} doubled up` : null,
              r.unrelated ? `${r.unrelated} unrelated` : null,
            ]
              .filter(Boolean)
              .flatMap((x, i) => (i === 0 ? [x] : [", ", x]))}
          </li>
        ))}
      </ul>
      {!compact && (
        <p className="text-ink-muted">
          Cancel: the two bets can&apos;t both win, so the money mostly goes round in a circle; the newer one isn&apos;t placed. Offset: each wins where the other loses. Doubled: more on the same thing.
        </p>
      )}
    </div>
  );
}
