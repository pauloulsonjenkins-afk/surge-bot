"use client";

import { useMemo, useState } from "react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { useMembersHistory, useMembersStrategies } from "@/queries/use-members";
import { btn, ModeBadge, odds, StatusPill, when } from "@/components/members/ui";

const sel = "rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink";

/** Every bet the member has made, simulated or live, with filters. Cards on phones, a table on wide screens. */
export default function HistoryPage() {
  const [mode, setMode] = useState("");
  const [strategy, setStrategy] = useState("");
  const [result, setResult] = useState("");
  const [execution, setExecution] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const strategies = useMembersStrategies();
  const qs = useMemo(() => {
    const q = new URLSearchParams();
    if (mode) q.set("mode", mode);
    if (strategy) q.set("strategy", strategy);
    if (result) q.set("result", result);
    if (execution) q.set("execution", execution);
    if (from) q.set("from", `${from}T00:00:00`);
    if (to) q.set("to", `${to}T23:59:59`);
    if (page) q.set("page", String(page));
    return q.toString();
  }, [mode, strategy, result, execution, from, to, page]);
  const { data, isLoading } = useMembersHistory(qs);
  const reset = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    f(e.target.value);
    setPage(0);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Bet history" subtitle="Every bet you've made through GoalBrew, simulated and live." />
      <div className="flex flex-wrap gap-2">
        <select aria-label="Mode" className={sel} value={mode} onChange={reset(setMode)}>
          <option value="">Simulation and live</option>
          <option value="sim">Simulation</option>
          <option value="live">Live</option>
        </select>
        <select aria-label="Strategy" className={sel} value={strategy} onChange={reset(setStrategy)}>
          <option value="">All strategies</option>
          {strategies.data?.strategies.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Result" className={sel} value={result} onChange={reset(setResult)}>
          <option value="">Any result</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="void">Void</option>
          <option value="open">Open</option>
          <option value="notPlaced">Not placed</option>
        </select>
        <select aria-label="Execution" className={sel} value={execution} onChange={reset(setExecution)}>
          <option value="">Manual and automated</option>
          <option value="auto">Automated</option>
          <option value="manual">Manual</option>
        </select>
        <input aria-label="From" type="date" className={sel} value={from} onChange={reset(setFrom)} />
        <input aria-label="To" type="date" className={sel} value={to} onChange={reset(setTo)} />
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-80 w-full" />
      ) : data.rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">No bets match.</p>
        </Card>
      ) : (
        <>
          {data.limitedToDays && <p className="text-xs text-ink-muted">Free membership shows the last {data.limitedToDays} days, and match details only for strategies your membership covers.</p>}
          <ul className="space-y-2 md:hidden">
            {data.rows.map((b) => (
              <li key={b.id} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{b.pick ? `${b.pick.home} v ${b.pick.away}` : b.strategyName}</p>
                    <p className="text-xs text-ink-muted">
                      {b.strategyName} · {when(b.at)}
                    </p>
                  </div>
                  <StatusPill status={b.status} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {b.pick?.market ? `${b.pick.market}${b.pick.selection ? ` · ${b.pick.selection}` : ""} · ` : ""}
                  {gbp(b.stake, false)} at {odds(b.odds)} · {b.execution === "auto" ? "Automated" : "Manual"}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <ModeBadge mode={b.mode} />
                  {b.profit !== null && <span className={`text-sm tabular-nums ${b.profit > 0 ? "text-hit" : b.profit < 0 ? "text-loss" : "text-ink-muted"}`}>{gbp(b.profit)}</span>}
                </div>
                {b.reason && <p className="mt-1 text-xs text-ink-muted">{b.reason}</p>}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-muted">
                <tr>
                  {["Date", "Strategy", "Event", "Market · selection", "Odds", "Stake", "Return", "P/L", "Result", "Mode", "Type", "Betfair"].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-surface">
                {data.rows.map((b) => (
                  <tr key={b.id} title={b.reason ?? undefined}>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{when(b.at)}</td>
                    <td className="px-2 py-1.5">{b.strategyName}</td>
                    <td className="px-2 py-1.5">{b.pick ? `${b.pick.home} v ${b.pick.away}` : <span className="text-ink-muted">–</span>}</td>
                    <td className="px-2 py-1.5 text-xs">{b.pick?.market ? `${b.pick.market}${b.pick.selection ? ` · ${b.pick.selection}` : ""}` : "–"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{odds(b.odds)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{gbp(b.mode === "live" ? (b.matchedStake ?? 0) : b.stake, false)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{b.returns === null ? "–" : gbp(b.returns, false)}</td>
                    <td className={`px-2 py-1.5 tabular-nums ${b.profit !== null && b.profit > 0 ? "text-hit" : b.profit !== null && b.profit < 0 ? "text-loss" : ""}`}>{b.profit === null ? "–" : gbp(b.profit)}</td>
                    <td className="px-2 py-1.5">
                      <StatusPill status={b.status} />
                    </td>
                    <td className="px-2 py-1.5">
                      <ModeBadge mode={b.mode} />
                    </td>
                    <td className="px-2 py-1.5 text-xs">{b.execution === "auto" ? "Automated" : "Manual"}</td>
                    <td className="px-2 py-1.5 text-xs text-ink-muted">{b.betfairBetId ? `${b.betfairBetId}${b.bfStatus ? ` · ${b.bfStatus}` : ""}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button type="button" className={btn} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Newer
            </button>
            <button type="button" className={btn} disabled={!data.more} onClick={() => setPage((p) => p + 1)}>
              Older
            </button>
          </div>
        </>
      )}
    </div>
  );
}
