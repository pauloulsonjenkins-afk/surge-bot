"use client";

import { PageHeader } from "@/components/ui/Card";
import { useMemo, useState } from "react";
import { useAdminStrategies, useDeleteStrategy, useIgnoreStrategy, useMergeStrategy, type AdminStrategy } from "@/queries/use-strategies";
import { useFreshStart } from "@/queries/use-fresh-start";
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
  selecting,
  selected,
  onToggle,
  onMerge,
  onDelete,
}: {
  row: AdminStrategy;
  all: AdminStrategy[];
  /** Strategies that are reported under this one. */
  includes: string[];
  busy: boolean;
  /** Tick boxes are showing, to delete several strategies at once. */
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onMerge: (into: string | null) => void;
  onDelete: () => void;
}) {
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState("");
  const settled = row.hits + row.misses;
  const hitRate = settled > 0 ? Math.round((row.hits / settled) * 1000) / 10 : null;
  const options = all.filter((o) => o.label !== row.label);

  return (
    <li className={`rounded-xl border bg-surface p-3.5 ${selected ? "border-accent" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        {selecting && (
          <input
            type="checkbox"
            checked={selected}
            disabled={row.sendingOn || busy}
            onChange={onToggle}
            aria-label={`Select ${row.label}`}
            title={row.sendingOn ? "Switch sending off for this strategy first (Sending page)" : undefined}
            style={{ accentColor: "var(--accent)" }}
            className="mt-1 h-4 w-4 shrink-0 disabled:opacity-40"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-ink">{row.label}</p>
          <p className={`text-xs ${row.market ? "text-ink-muted" : "text-danger"}`}>{marketName(row.market) ?? "No market set"}</p>
        </div>
        <p className="shrink-0 text-xl font-medium tabular-nums text-ink">{hitRate === null ? "–" : `${hitRate}%`}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={hitRate === null ? "No settled alerts yet" : `Hit rate ${hitRate}%`}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${hitRate ?? 0}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        {row.hits} hit{row.hits === 1 ? "" : "s"} · {row.misses} miss{row.misses === 1 ? "" : "es"} · {row.alertsSince} alert{row.alertsSince === 1 ? "" : "s"}
        {settled > 0 && settled < 30 ? " · small sample" : ""} · last {lastSeen.format(new Date(row.lastAlertAt))}
      </p>

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
  const removeMany = useDeleteStrategy();
  const { data: freshAt } = useFreshStart();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
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

  const [bulkBusy, setBulkBusy] = useState(false);
  const busy = merge.isPending || remove.isPending || ignore.isPending || bulkBusy;
  const failed = merge.error ?? remove.error ?? ignore.error ?? removeMany.error;

  const deletable = strategies.filter((s) => !s.sendingOn);
  const toggle = (label: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  async function deleteSelected() {
    const chosen = strategies.filter((s) => picked.has(s.label) && !s.sendingOn);
    if (chosen.length === 0) return;
    const alerts = chosen.reduce((n, s) => n + s.alerts, 0);
    const sent = chosen.reduce((n, s) => n + s.sent, 0);
    const ok = window.confirm(
      `Delete ${chosen.length} strateg${chosen.length === 1 ? "y" : "ies"}?\n\n` +
        chosen.map((s) => `• ${s.label}`).join("\n") +
        `\n\nTheir ${alerts} saved alert${alerts === 1 ? "" : "s"} are deleted for good, so they disappear from the Dashboard, Live, Strategies, Trade Log and Win/Loss.` +
        (sent > 0 ? `\n\n${sent} were already sent to bet. Those are kept as records but taken out of every result and figure (unless sent in the last 2 hours).` : "") +
        `\n\nNothing changes in your betting software. If one of these names ever arrives again, it will reappear.`,
    );
    if (!ok) return;
    const includeSent =
      sent > 0 &&
      window.confirm(
        `Also delete the ${sent} sent record${sent === 1 ? "" : "s"} for good?\n\nOK = delete them too, so these strategies disappear completely from every list. Records of picks sent today are kept until tomorrow.\nCancel = keep them as records; the strategies will still show in the lists.`,
      );
    setBulkBusy(true);
    setBulkMessage(null);
    let done = 0;
    let removedAlerts = 0;
    try {
      for (const s of chosen) {
        const r = await removeMany.mutateAsync({ label: s.label, ignoreFuture: false, includeSent });
        removedAlerts += r.removed;
        done++;
      }
      setBulkMessage(`${done} strateg${done === 1 ? "y" : "ies"} deleted (${removedAlerts} alert${removedAlerts === 1 ? "" : "s"}).`);
      stopSelecting();
    } catch {
      setBulkMessage(`Stopped after ${done} of ${chosen.length}. See the error above, then try again.`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function clearIgnored() {
    if (ignored.length === 0) return;
    const ok = window.confirm(
      `Clear the ignored list?\n\n${ignored.map((n) => `• ${n}`).join("\n")}\n\nNew alerts with these names would be stored again. Only do this if they will never be used.`,
    );
    if (!ok) return;
    setBulkBusy(true);
    try {
      for (const name of ignored) await ignore.mutateAsync({ label: name, ignored: false });
    } catch {
      // the error shows above; the rest stay on the list
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        as="h2"
        title="Strategies"
        subtitle={
          <>
          Every strategy the app has seen, with its hit rate from settled alerts (counted from your fresh start, if you have set one in Settings). <span className="text-ink">Merge</span> counts one strategy’s alerts under another on the Dashboard and stats
          (nothing is deleted and it can be undone). <span className="text-ink">Delete</span> removes a strategy’s saved alerts for good.
          </>
        }
      />

      {data && strategies.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              disabled={bulkBusy}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              {selecting ? "Cancel" : "Select several to delete"}
            </button>
            {selecting && (
              <>
                <button
                  type="button"
                  onClick={() => setPicked(new Set(deletable.map((s) => s.label)))}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                >
                  Select all
                </button>
                {freshAt && (
                  <button
                    type="button"
                    onClick={() => setPicked(new Set(deletable.filter((s) => s.alertsSince === 0).map((s) => s.label)))}
                    className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                  >
                    Select unused since fresh start
                  </button>
                )}
                <button type="button" onClick={() => setPicked(new Set())} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2">
                  Select none
                </button>
              </>
            )}
          </div>
          {selecting && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-2.5">
              <p className="text-xs text-ink">
                {picked.size} selected
                {strategies.some((s) => s.sendingOn) && <span className="text-ink-muted"> · ones with sending on can't be picked</span>}
              </p>
              <button
                type="button"
                disabled={picked.size === 0 || bulkBusy}
                onClick={() => void deleteSelected()}
                className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {bulkBusy ? "Deleting…" : `Delete ${picked.size || ""} selected`.replace("  ", " ")}
              </button>
            </div>
          )}
          {bulkMessage && <p className="text-xs text-ink">{bulkMessage}</p>}
        </div>
      )}

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
                selecting={selecting}
                selected={picked.has(r.label)}
                onToggle={() => toggle(r.label)}
                onMerge={(into) => merge.mutate({ from: r.label, into })}
                onDelete={() => deleteStrategy(r)}
              />
            ))}
          </ul>

          {ignored.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">Ignored strategies</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">New alerts with these names are dropped on arrival, so they never come back.</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearIgnored()}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:bg-surface-2 disabled:opacity-50"
                >
                  Clear list
                </button>
              </div>
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