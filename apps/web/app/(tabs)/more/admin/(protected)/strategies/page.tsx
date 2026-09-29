"use client";

import { useMemo, useState } from "react";
import { useAdminStrategies, useIgnoreStrategy, useMergeStrategy, type AdminStrategy } from "@/queries/use-strategies";
import { useDeleteStrategyFlow } from "@/components/admin/useDeleteStrategyFlow";
import { marketName } from "@/lib/markets";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";

const lastSeen = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function StrategyCard({
  row,
  all,
  includes,
  busy,
  onMerge,
  onDelete,
}: {
  row: AdminStrategy;
  all: AdminStrategy[];
  /** Strategies that are reported under this one. */
  includes: string[];
  busy: boolean;
  onMerge: (into: string | null) => void;
  onDelete: () => void;
}) {
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState("");
  const settled = row.hits + row.misses;
  const rate = settled > 0 ? `${Math.round((row.hits / settled) * 1000) / 10}%` : "–";
  const options = all.filter((o) => o.label !== row.label);

  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-ink">{row.label}</p>
          <p className={`text-xs ${row.market ? "text-ink-muted" : "text-danger"}`}>{marketName(row.market) ?? "No market set"}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums text-ink">{rate}</p>
          <p className="text-[11px] text-ink-muted">
            {row.hits} hit · {row.misses} miss · {row.alerts} alerts
          </p>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">Last alert {lastSeen.format(new Date(row.lastAlertAt))}</p>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {row.mergedInto && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Counted under “{row.mergedInto}”</span>}
        {includes.length > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Also counts: {includes.join(", ")}</span>}
        {row.sendingOn && <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-ink">Sending on{row.stake !== null ? ` · £${row.stake.toFixed(2)}` : ""}</span>}
        {row.sent > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">{row.sent} sent to bet</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {row.mergedInto ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMerge(null)}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            Undo merge
          </button>
        ) : (
          options.length > 0 && (
            <button
              type="button"
              onClick={() => setMerging((v) => !v)}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
            >
              {merging ? "Cancel merge" : "Merge into another…"}
            </button>
          )
        )}
        <button
          type="button"
          disabled={busy || row.sendingOn}
          onClick={onDelete}
          title={row.sendingOn ? "Switch sending off for this strategy first (Sending page)" : undefined}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:bg-surface-2 disabled:opacity-40"
        >
          Delete strategy
        </button>
      </div>
      {row.sendingOn && <p className="mt-1.5 text-[11px] text-ink-muted">To delete this one, switch it off on the Sending page first.</p>}

      {merging && !row.mergedInto && (
        <div className="mt-3 space-y-2 rounded-lg bg-surface-2 p-2.5">
          <label className="block text-xs text-ink-muted">
            Count this strategy’s alerts under
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Choose a strategy…</option>
              {options.map((o) => (
                <option key={o.label} value={o.label}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-ink-muted">
            The Dashboard and stats then treat both as one strategy, and nothing is deleted. Sending is not affected: each strategy keeps its own
            switch and stake.
          </p>
          <button
            type="button"
            disabled={busy || !target}
            onClick={() => {
              onMerge(target);
              setMerging(false);
              setTarget("");
            }}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
          >
            Merge
          </button>
        </div>
      )}
    </li>
  );
}

export default function StrategiesPage() {
  const { data, isLoading, error } = useAdminStrategies();
  const merge = useMergeStrategy();
  const remove = useDeleteStrategyFlow();
  const ignore = useIgnoreStrategy();
  const strategies = data?.strategies ?? [];
  const ignored = data?.ignored ?? [];

  const includesOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of strategies) {
      if (r.mergedInto) map.set(r.mergedInto.toLowerCase(), [...(map.get(r.mergedInto.toLowerCase()) ?? []), r.label]);
    }
    return map;
  }, [strategies]);

  function deleteStrategy(row: AdminStrategy) {
    remove.run(row.label, { alerts: row.alerts, sent: row.sent });
  }

  const busy = merge.isPending || remove.isPending || ignore.isPending;
  const failed = merge.error ?? remove.error ?? ignore.error;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium tracking-tight text-ink">Strategies</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Every strategy the app has seen. <span className="text-ink">Merge</span> counts one strategy’s alerts under another on the Dashboard and stats
          (nothing is deleted and it can be undone). <span className="text-ink">Delete</span> removes a strategy’s saved alerts for good.
        </p>
      </div>

      {error ? (
        <QueryError error={error} next="/more/admin/strategies" />
      ) : isLoading || !data ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : strategies.length === 0 && ignored.length === 0 ? (
        <p className="text-sm text-ink-muted">Strategies appear here once alerts arrive.</p>
      ) : (
        <>
          {failed && <p className="rounded-md border border-line bg-surface p-2 text-xs text-danger">{failed.message}</p>}
          <ul className="space-y-2">
            {strategies.map((r) => (
              <StrategyCard
                key={r.label}
                row={r}
                all={strategies}
                includes={includesOf.get(r.label.toLowerCase()) ?? []}
                busy={busy}
                onMerge={(into) => merge.mutate({ from: r.label, into })}
                onDelete={() => deleteStrategy(r)}
              />
            ))}
          </ul>

          {ignored.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-3">
              <h3 className="text-sm font-medium text-ink">Ignored strategies</h3>
              <p className="mt-0.5 text-xs text-ink-muted">New alerts with these names are dropped on arrival, so they never come back.</p>
              <ul className="mt-2 divide-y divide-line">
                {ignored.map((name) => (
                  <li key={name} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 break-words text-sm text-ink">{name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => ignore.mutate({ label: name, ignored: false })}
                      className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      Stop ignoring
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
