"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, PageHeader, Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { UpdatedAgo } from "@/components/ui/UpdatedAgo";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useNotPlaced, useToday, type SpeedReport, type TodaySnapshot } from "@/queries/use-today";
import { useSaveSending } from "@/queries/use-sending";
import { useStrategyNames } from "@/queries/use-strategy-names";

const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toFixed(2)}`;
const tone = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink");

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86_400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86_400)} days ago`;
}

function Tile({ label, value, sub, warn, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? "border-warn/60 bg-warn/5" : "border-line bg-surface"}`}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
      {children}
    </div>
  );
}

function secs(n: number | null): string {
  return n === null ? "–" : n < 60 ? `${n} s` : `${Math.round(n / 6) / 10} min`;
}

function Speed({ s, label }: { s: SpeedReport; label: string }) {
  if (s.picks === 0 || s.total === null) return <p className="text-xs text-ink-muted">{label}: no placed bets to time yet.</p>;
  return (
    <p className="text-xs text-ink-muted">
      {label}: <span className="font-medium text-ink">{secs(s.total)}</span> from alert to bet (middle of {s.picks}) · posted → received {secs(s.postedToReceived)} · received → sent{" "}
      {secs(s.receivedToSent)} · sent → placed {secs(s.sentToPlaced)}
      {s.slowShare !== null && s.slowShare > 0 && <span className={s.slowShare > 20 ? "text-warn" : ""}> · {s.slowShare}% took over 30 s</span>}
    </p>
  );
}

function KillSwitch({ on }: { on: boolean }) {
  const save = useSaveSending();
  const dialog = useDialog();
  if (!on) {
    return (
      <Link href="/more/admin/sending" className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
        Betting is off · turn on in Sending
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={save.isPending}
      onClick={async () => {
        const ok = await dialog.confirm({
          title: "Stop all betting now?",
          tone: "danger",
          confirmLabel: "Stop all betting",
          body: <p>No new bets go out from any strategy until you turn betting back on in Sending. Bets already placed on Betfair aren&apos;t touched.</p>,
        });
        if (ok) save.mutate({ enabled: false });
      }}
      className="rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-danger-ink disabled:opacity-50"
    >
      {save.isPending ? "Stopping…" : "Stop all betting"}
    </button>
  );
}

function NotPlaced() {
  const [days, setDays] = useState(30);
  const { data, error } = useNotPlaced(days);
  const names = useStrategyNames();
  return (
    <Card title="Why picks weren’t placed" subtitle="Picks handed over to bet that never got a matched Betfair bet, grouped by the reason, biggest first. Fix the top ones first.">
      <Segmented
        label="Period"
        value={String(days)}
        onChange={(v) => setDays(Number(v))}
        className="mb-3"
        options={[
          { value: "1", label: "Today" },
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
        ]}
      />
      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : !data ? (
        <Skeleton className="h-32 w-full" />
      ) : data.sent === 0 ? (
        <p className="text-sm text-ink-muted">No picks were handed over to bet in this period.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{data.notPlaced}</span> of {data.sent} not placed{" "}
            <span className="text-ink-muted">({Math.round((1000 * data.notPlaced) / data.sent) / 10}%)</span>
          </p>
          {data.byCategory.length > 0 && (
            <ul className="space-y-3">
              {data.byCategory.map((c) => (
                <li key={c.category}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-ink">{c.category}</span>
                    <span className="shrink-0 tabular-nums text-ink">
                      {c.count} <span className="text-xs text-ink-muted">· {c.share}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-chart" style={{ width: `${c.share}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {c.fix} · {c.strategies.map((s) => names.name(s)).join(", ")}
                  </p>
                  {c.example && <p className="mt-0.5 text-xs italic text-ink-muted">e.g. “{c.example}”</p>}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-ink">By strategy</summary>
            <ul className="mt-2 divide-y divide-line">
              {data.byStrategy.map((s) => (
                <li key={s.strategy} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block text-ink">{names.name(s.strategy)}</span>
                    {s.top && <span className="text-xs text-ink-muted">mostly: {s.top}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink">
                    {s.notPlaced} of {s.sent}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Card>
  );
}

function Tiles({ d }: { d: TodaySnapshot }) {
  const names = useStrategyNames();
  const bankAge = d.bank.at ? Date.parse(d.at) - Date.parse(d.bank.at) : null;
  const tg = d.alerts.telegram;
  return (
    <>
      {d.betting.breaker.open && (
        <p className="rounded-xl border border-loss/60 bg-loss/10 p-3 text-sm text-ink">
          <strong>New bets paused.</strong> {d.betting.breaker.reason} They resume by themselves once Betfair answers again.
        </p>
      )}
      {d.limits.lossStop && <p className="rounded-xl border border-loss/60 bg-loss/10 p-3 text-sm text-ink">{d.limits.lossStop}</p>}
      {!tg.ok && (
        <p className="rounded-xl border border-warn/60 bg-warn/10 p-3 text-sm text-ink">
          <strong>Alerts may not be arriving.</strong> {tg.problems.join(" ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile
          label="Betting"
          value={d.betting.on ? (d.betting.breaker.open ? "Paused" : "On") : "Off"}
          sub={`${d.betting.liveStrategies} Live strateg${d.betting.liveStrategies === 1 ? "y" : "ies"} · placing: ${d.betting.directMode === "live" ? "GoalBrew" : d.betting.directMode === "shadow" ? "shadow only" : "betting software"}`}
          warn={d.betting.on && d.betting.breaker.open}
        />
        <Tile label="Live today" value={<span className={tone(d.today.liveNet)}>{gbp(d.today.liveNet)}</span>} sub={`${d.today.liveSettled} settled · Sim ${gbp(d.today.simNet)} (${d.today.simSettled})`} />
        <Tile
          label="Betfair balance"
          value={d.bank.available === null ? "–" : `£${d.bank.available.toFixed(2)}`}
          sub={d.bank.at ? `exposure £${Math.abs(d.bank.exposure ?? 0).toFixed(2)} · read ${ago(d.bank.at)}` : "Read only when a strategy uses a % stake"}
          warn={bankAge !== null && bankAge > 30 * 60_000}
        />
        <Tile
          label="Money out now"
          value={`£${d.exposure.openStake.toFixed(2)}`}
          sub={
            d.exposure.biggestMatch
              ? `most on one match £${d.exposure.biggestMatch.stake.toFixed(2)}${d.limits.matchCap > 0 ? ` (limit £${d.limits.matchCap})` : ""}`
              : "nothing on unsettled matches"
          }
          warn={d.limits.matchCap === 0}
        >
          {d.limits.matchCap === 0 && (
            <Link href="/more/admin/sending" className="mt-1 block text-xs text-warn underline">
              No per-match limit set
            </Link>
          )}
        </Tile>
        <Tile
          label="Daily loss stop"
          value={d.limits.dailyLossLimit > 0 ? `£${d.limits.dailyLossLimit}` : "Off"}
          sub={d.limits.dailyLossLimit > 0 ? (d.limits.lossStop ? "Reached today" : `${gbp(d.today.liveNet)} so far today`) : undefined}
          warn={d.limits.dailyLossLimit === 0 || d.limits.lossStop !== null}
        >
          {d.limits.dailyLossLimit === 0 && (
            <Link href="/more/admin/sending" className="mt-1 block text-xs text-warn underline">
              Set one on Sending
            </Link>
          )}
        </Tile>
        <Tile label="Alerts" value={`${d.alerts.lastHour} in the last hour`} sub={`last ${ago(tg.lastAlertAt)} · Telegram ${tg.ok ? "OK" : "problem"}`} warn={!tg.ok} />
        <Tile
          label="Bets in progress"
          value={`${d.queue.waiting + d.queue.placing} waiting`}
          sub={`${d.queue.notPlacedToday} of ${d.queue.sentToday} not placed today`}
          warn={d.queue.sentToday >= 5 && d.queue.notPlacedToday / d.queue.sentToday > 0.3}
        />
        <Tile
          label="Betfair link"
          value={d.betting.betfair.configured ? (d.betting.betfair.lastError ? "Problem" : "OK") : "Not set up"}
          sub={d.betting.betfair.configured ? `last answered ${ago(d.betting.betfair.lastOkAt)}` : undefined}
          warn={!!d.betting.betfair.lastError}
        />
      </div>

      {d.advice && d.advice.length > 0 && (
        <Card title="Suggestions" subtitle="From recent results. Nothing changes until you switch it on Strategies; you get one notification per new suggestion.">
          <ul className="space-y-2 text-sm">
            {d.advice.map((a) => (
              <li key={a.key}>
                <Link href="/more/admin/strategies" className="font-medium text-ink underline decoration-line">
                  {names.name(a.key)}
                </Link>{" "}
                <span className={a.kind === "try-live" ? "text-hit" : "text-warn"}>{a.kind === "try-live" ? "ready to try Live at £1" : "consider putting back to Sim"}</span>
                <span className="block text-xs text-ink-muted">{a.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {d.stopped.length > 0 && (
        <Card title="Stopped today">
          <ul className="space-y-1 text-sm">
            {d.stopped.map((s) => (
              <li key={s.strategy}>
                <span className="font-medium text-ink">{names.name(s.strategy)}</span> <span className="text-ink-muted">· {s.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Speed: alert to bet" subtitle="In-play prices move by the second. The slowest step is the one to fix.">
        <div className="space-y-1.5">
          <Speed s={d.speed.today} label="Today" />
          <Speed s={d.speed.week} label="Last 7 days" />
        </div>
      </Card>
    </>
  );
}

/** The admin's one-glance page: is everything working, and what's at risk right now. */
export default function TodayPage() {
  const { data, error, isLoading, dataUpdatedAt } = useToday();
  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Today"
        subtitle={
          <>
            Is everything working, and what&apos;s at risk right now. <UpdatedAgo at={dataUpdatedAt || null} staleAfter={60} />
          </>
        }
        actions={data ? <KillSwitch on={data.betting.on} /> : undefined}
      />
      {error ? (
        <QueryError error={error} next="/more/admin/today" />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <Tiles d={data} />
      )}
      <NotPlaced />
    </div>
  );
}
