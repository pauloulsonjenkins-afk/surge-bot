"use client";

import { useState } from "react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMembersRecord } from "@/queries/use-members";
import { btn, odds, pct, when } from "@/components/members/ui";
import type { RecordSummary } from "@/lib/members/types";

const sel = "rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink";
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
const units = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}£${Math.abs(n).toFixed(2)}`;
const tone = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink-muted");

function Figures({ s }: { s: RecordSummary }) {
  return (
    <span className="tabular-nums">
      <span className="text-hit">{s.wins}W</span> <span className="text-ink-muted">/</span> <span className="text-loss">{s.losses}L</span>
      <span className="text-ink-muted"> · {pct(s.hitRate)} · </span>
      <span className={tone(s.profit)}>{units(s.profit)}</span>
      <span className="text-ink-muted"> to £1 stakes{s.roi !== null ? ` (${pct(s.roi, true)})` : ""}</span>
    </span>
  );
}

/**
 * The Track Record: every house alert graded automatically, winners and losers, with the money beside the hit rate and
 * any rule change dated (the record from before it stays one tap away).
 */
export default function RecordPage() {
  const [strategy, setStrategy] = useState("");
  const [page, setPage] = useState(0);
  const { data, isLoading } = useMembersRecord(strategy, page);
  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;
  const shown = strategy ? data.strategies.filter((s) => s.key === strategy) : data.strategies;

  return (
    <div className="space-y-5">
      <PageHeader title="Track Record" subtitle="Every alert, graded automatically from the final score. Winners and losers, nothing left out." />

      <Card title="By strategy" subtitle={`Profit is a level £1 on every alert at the price recorded when it fired, after ${data.commissionPct}% commission.`}>
        <ul className="divide-y divide-line">
          {shown.map((s) => (
            <li key={s.key} className="py-2.5 text-sm">
              <p className="font-medium text-ink">{s.name}</p>
              <p className="text-xs">
                <Figures s={s.current} />
              </p>
              {s.changed && (
                <p className="mt-0.5 text-xs text-ink-muted">
                  Rules changed on {dayFmt.format(new Date(s.changed.at))}; the figures above count from then. Before: <Figures s={s.changed.before} />
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Strategy"
          className={sel}
          value={strategy}
          onChange={(e) => {
            setStrategy(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All strategies</option>
          {data.strategies.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-muted">{data.total} graded alerts</span>
      </div>

      <Card>
        {data.rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No graded alerts yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block text-ink">
                    {r.home} v {r.away}
                    {r.ftScore && <span className="text-ink-muted"> · FT {r.ftScore}</span>}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {when(r.at)} · {r.strategyName}
                    {r.minute !== null ? ` · ${r.minute}'` : ""}
                    {r.score ? ` ${r.score}` : ""} · {r.market}
                    {r.selection ? ` · ${r.selection}` : ""} · {odds(r.odds)}
                  </span>
                  {r.why && <span className="mt-0.5 block text-xs italic text-ink-muted">Why it fired: {r.why}</span>}
                  {(r.beforeChange || r.amended) && (
                    <span className="mt-0.5 block text-[0.7rem] text-warn">
                      {[r.beforeChange && "Before the rule change", r.amended && "Result amended by hand"].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block text-xs font-semibold ${r.result === "hit" ? "text-hit" : "text-loss"}`}>{r.result === "hit" ? "Won" : "Lost"}</span>
                  {r.profit !== null && <span className={`block text-xs tabular-nums ${tone(r.profit)}`}>{units(r.profit)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(page > 0 || data.more) && (
          <div className="mt-3 flex justify-between">
            <button type="button" className={btn} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Newer
            </button>
            <button type="button" className={btn} disabled={!data.more} onClick={() => setPage((p) => p + 1)}>
              Older
            </button>
          </div>
        )}
      </Card>

      <p className="text-xs text-ink-muted">
        Results come from each match&apos;s final score, worked out automatically. Alerts GoalBrew voided (an abandoned match or bad data) aren&apos;t
        counted. Past results don&apos;t guarantee future ones.
      </p>
    </div>
  );
}
