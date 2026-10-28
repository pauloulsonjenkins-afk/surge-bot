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
import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import { AdviceRow } from "@/components/admin/Advice";
import { ClaudeReviewCard } from "@/components/admin/ClaudeBits";
import { TodayByStrategy } from "@/components/admin/TodayByStrategy";
import { toneOf, gbp, units } from "@/lib/format";
import { Fold } from "@/components/ui/Fold";
import { notPlacedText, notPlacedWarns } from "@/lib/not-placed";


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

/** engine today.ts's category for picks from before GoalBrew placed its own bets. */
const OLD_BOT = "Old bot";

function NotPlaced() {
  const [days, setDays] = useState(30);
  const { data, error } = useNotPlaced(days);
  const names = useStrategyNames();
  return (
    <Fold title="Why picks weren’t placed">
      <p className="mb-2 text-xs text-ink-muted">Picks handed over to bet that never got a matched Betfair bet, grouped by the reason, biggest first.</p>
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
          {/* The biggest bucket is usually history from before GoalBrew placed its own bets: nothing to act on, so it sits
              under the real problems as a note instead of leading the list. */}
          {data.byCategory.length > 0 && (
            <ul className="space-y-3">
              {data.byCategory.filter((c) => !c.category.startsWith(OLD_BOT)).map((c) => (
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
          {(() => {
            const old = data.byCategory.find((c) => c.category.startsWith(OLD_BOT));
            return old ? (
              <p className="text-xs text-ink-muted">
                Not counted above: {old.count} older picks ({old.share}%) from before GoalBrew placed its own bets, with no reason recorded. Nothing to fix.
              </p>
            ) : null;
          })()}
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
    </Fold>
  );
}

function Tiles({ d }: { d: TodaySnapshot }) {
  const names = useStrategyNames();
  const bankAge = d.bank.at ? Date.parse(d.at) - Date.parse(d.bank.at) : null;
  const tg = d.alerts.telegram;
  const volume = d.alerts.volume;
  // Devices that get GoalBrew's notifications. On 20 Oct 2026 there were none, so "Telegram alerts have stopped",
  // the daily results and every safety notice reached nobody (a 14-hour outage went unnoticed overnight).
  const push = useQuery({ queryKey: ["push"], queryFn: ({ signal }) => getJson<{ devices: unknown[] }>("/api/admin/push", "notification settings", signal), staleTime: 5 * 60_000 });
  const noDevices = push.data !== undefined && push.data.devices.length === 0;
  // Any of the folded health checks off: the "Systems" line opens itself and turns amber.
  const systemsWarn =
    (bankAge !== null && bankAge > 30 * 60_000) ||
    d.limits.matchCap === 0 ||
    !tg.ok ||
    !!volume?.low ||
    notPlacedWarns(d.queue) ||
    !!d.betting.betfair.lastError;
  return (
    <>
      {noDevices && (
        <p className="rounded-xl border border-warn/60 bg-warn/10 p-3 text-sm text-ink">
          <strong>No phone gets GoalBrew&apos;s notifications.</strong> Warnings such as &ldquo;Telegram alerts have stopped&rdquo; reach nobody. Turn them on
          on your phone:{" "}
          <Link href="/more/admin/sending" className="font-medium text-accent underline">
            Betting → Limits and switches → Notifications
          </Link>
          , then &ldquo;Send a test&rdquo;.
        </p>
      )}
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
      {tg.ok && volume?.low && (
        <p className="rounded-xl border border-warn/60 bg-warn/10 p-3 text-sm text-ink">
          <strong>Alerts have gone quiet.</strong> Only {volume.lastHour} in the last hour, against a usual {volume.typical} for this time of day. Telegram&apos;s connection looks fine, so this is likely InPlayGuru itself, not GoalBrew.
        </p>
      )}

      <div className={`grid grid-cols-2 gap-2 ${d.today.liveUnits !== undefined ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Tile
          label="Betting"
          value={d.betting.on ? (d.betting.breaker.open ? "Paused" : "On") : "Off"}
          sub={`${d.betting.liveStrategies} Live strateg${d.betting.liveStrategies === 1 ? "y" : "ies"} · placing: ${d.betting.directMode === "live" ? "GoalBrew" : d.betting.directMode === "shadow" ? "shadow only" : "off"}`}
          warn={d.betting.on && d.betting.breaker.open}
        />
        <Tile label="Live today" value={<span className={toneOf(d.today.liveNet)}>{gbp(d.today.liveNet, false)}</span>} sub={`${d.today.liveSettled} settled · Sim ${gbp(d.today.simNet, false)} (${d.today.simSettled})`} />
        {/* The same day as if every bet were the same 1-unit stake, so a stake change can't make it look better or worse. */}
        {d.today.liveUnits !== undefined && (
          <Tile
            label="Units today"
            value={<span className={toneOf(d.today.liveUnits)}>{units(d.today.liveUnits)}</span>}
            sub={`Live, ${d.today.liveSettled} settled · Sim ${units(d.today.simUnits ?? 0)} (${d.today.simSettled})`}
          />
        )}
        <Tile
          label="Daily loss stop"
          value={d.limits.dailyLossLimit > 0 ? `£${d.limits.dailyLossLimit}` : "Off"}
          sub={d.limits.dailyLossLimit > 0 ? (d.limits.lossStop ? "Reached today" : d.today.liveNet < 0 ? `${gbp(-d.today.liveNet, false)} of it used today` : "None used: Live isn't down today") : undefined}
          warn={d.limits.dailyLossLimit === 0 || d.limits.lossStop !== null}
        >
          {d.limits.dailyLossLimit === 0 && (
            <Link href="/more/admin/sending?tab=limits" className="mt-1 block text-xs text-warn underline">
              Set one on Betting
            </Link>
          )}
        </Tile>
      </div>

      {/* The rest of the health checks fold into one line while all is well, and open by themselves the moment one needs a look. */}
      <details key={systemsWarn ? "warn" : "ok"} open={systemsWarn} className={`rounded-xl border px-3 ${systemsWarn ? "border-warn/60 bg-warn/5" : "border-line bg-surface"}`}>
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 text-sm text-ink">
          <span className="font-medium">{systemsWarn ? "Systems: needs a look" : "Systems: all OK"}</span>
          <span className="text-xs text-ink-muted">
            balance {d.bank.available === null ? "–" : `£${d.bank.available.toFixed(2)}`} · £{d.exposure.openStake.toFixed(2)} out · {d.alerts.lastHour} alerts in the last hour · {d.queue.waiting + d.queue.placing} waiting
          </span>
        </summary>
        <div className="grid grid-cols-2 gap-2 pb-3 lg:grid-cols-4">
        <Tile
          label="Betfair balance"
          value={d.bank.available === null ? "–" : `£${d.bank.available.toFixed(2)}`}
          sub={d.bank.at ? `exposure £${Math.abs(d.bank.exposure ?? 0).toFixed(2)} · read ${ago(d.bank.at)}` : "Not read yet (needs the Betfair link set up on the engine)"}
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
          label="Alerts"
          value={`${d.alerts.lastHour} in the last hour`}
          sub={`last ${ago(tg.lastAlertAt)} · Telegram ${tg.ok ? "OK" : "problem"}${volume?.low ? ` · usually ${volume.typical} by now` : ""}`}
          warn={!tg.ok || !!volume?.low}
        />
        <Tile
          label="Bets in progress"
          value={`${d.queue.waiting + d.queue.placing} waiting`}
          sub={notPlacedText(d.queue)}
          warn={notPlacedWarns(d.queue)}
        />
        <Tile
          label="Betfair link"
          value={d.betting.betfair.configured ? (d.betting.betfair.lastError ? "Problem" : "OK") : "Not set up"}
          sub={d.betting.betfair.configured ? `last answered ${ago(d.betting.betfair.lastOkAt)}` : undefined}
          warn={!!d.betting.betfair.lastError}
        />
        </div>
      </details>

      {d.advice && d.advice.length > 0 && (
        <Card title="Suggestions" subtitle="From results since each strategy's rules last changed. Nothing changes until you press Apply; you get one notification per new suggestion.">
          <ul className="space-y-3 text-sm">
            {d.advice.map((a) => (
              <AdviceRow key={`${a.key}:${a.kind}:${a.league?.key ?? ""}`} a={a} name={a.league ? `${names.name(a.key)} in ${a.league.name}` : names.name(a.key)} />
            ))}
          </ul>
        </Card>
      )}

      <ClaudeReviewCard />

      <TodayByStrategy />

      {d.autoStakes && d.autoStakes.length > 0 && (
        <Fold title="Automatic stakes: next steps" hint={`${d.autoStakes.length} waiting, nothing to do`}>
          <ul className="space-y-1 text-sm">
            {d.autoStakes.map((q) => (
              <li key={q.key}>
                <span className="font-medium text-ink">{names.name(q.key)}</span>{" "}
                <span className="text-ink-muted">
                  · {q.action.toLowerCase()}{" "}
                  {Date.parse(q.due) <= Date.parse(d.at) + 60_000 ? "at the next hourly check" : `on ${new Date(q.due).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" })}`}
                </span>
              </li>
            ))}
          </ul>
        </Fold>
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

      <Fold title="Speed: alert to bet">
        <p className="mb-2 text-xs text-ink-muted">In-play prices move by the second. The slowest step is the one to fix.</p>
        <div className="space-y-1.5">
          <Speed s={d.speed.today} label="Today" />
          <Speed s={d.speed.week} label="Last 7 days" />
        </div>
      </Fold>
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
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
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

