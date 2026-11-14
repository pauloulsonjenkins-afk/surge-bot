"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, PageHeader, Segmented } from "@/components/ui/Card";
import { Skeleton, StripSkeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { UpdatedAgo } from "@/components/ui/UpdatedAgo";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useNotPlaced, useToday, type SpeedReport, type TodaySnapshot } from "@/queries/use-today";
import { useSaveSending } from "@/queries/use-sending";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import { AdviceRow, ApplyAllAdvice, adviceTitle, IgnoredAdvice } from "@/components/admin/Advice";
import { ClaudeReviewCard } from "@/components/admin/ClaudeBits";
import { TodayByStrategy } from "@/components/admin/TodayByStrategy";
import { toneOf, gbp, units } from "@/lib/format";
import { Fold } from "@/components/ui/Fold";
import { AttentionDot, NoticeStack, type NoticeItem } from "@/components/ui/Notice";
import { Power } from "lucide-react";
import { notPlacedText, notPlacedWarns } from "@/lib/not-placed";
import { Flash } from "@/components/ui/Flash";
import { DashboardBody } from "@/components/dashboard/DashboardBody";


function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86_400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86_400)} days ago`;
}

function Tile({ label, value, sub, warn, flat, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean; flat?: boolean; children?: React.ReactNode }) {
  return (
    <div className={flat ? "bg-surface p-3" : "rounded-xl border border-line bg-surface p-3"}>
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        {warn && <AttentionDot />}
        {label}
      </p>
      <p className="mt-0.5 font-display text-xl font-bold tabular-nums text-ink [font-stretch:108%]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
      {children}
    </div>
  );
}

/** Today's Sim figure under a Live one: a tinted chip in its own colour, then how many Sim bets it is from. */
function SimToday({ value, tone, settled }: { value: string; tone: string; settled: number }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className={`roi-chip !px-2 !py-0 !text-xs tabular-nums ${tone}`}>Sim {value}</span>
      <span>{settled} settled</span>
    </span>
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
      <Link href="/more/admin/sending" className="inline-flex min-h-10 items-center rounded-md border border-line px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2">
        Betting is off · turn on
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
      className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-loss/15 px-3 text-sm font-semibold text-loss transition-colors hover:bg-loss/25 disabled:opacity-50"
    >
      <Power size={15} aria-hidden strokeWidth={2.4} />
      {save.isPending ? "Stopping…" : "Stop betting"}
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
  const notices: NoticeItem[] = [];
  if (d.betting.breaker.open)
    notices.push({ key: "breaker", level: "stop", title: "New bets paused", body: <>{d.betting.breaker.reason} They resume by themselves once Betfair answers again.</> });
  if (d.limits.lossStop) notices.push({ key: "loss", level: "stop", title: "Daily loss stop reached", body: d.limits.lossStop.replace(/^Daily loss stop:\s*/i, "") });
  if (!tg.ok) notices.push({ key: "tg", level: "action", title: "Alerts may not be arriving", body: tg.problems.join(" ") });
  if (tg.ok && volume?.low)
    notices.push({
      key: "quiet",
      level: "action",
      title: "Alerts have gone quiet",
      body: <>Only {volume.lastHour} in the last hour, against a usual {volume.typical} for this time of day. Telegram&apos;s connection looks fine, so this is likely InPlayGuru itself.</>,
    });
  if (noDevices)
    notices.push({
      key: "push",
      level: "action",
      title: "No phone gets GoalBrew's notifications",
      body: (
        <>
          Warnings such as &ldquo;Telegram alerts have stopped&rdquo; reach nobody.{" "}
          <Link href="/more/admin/sending" className="font-medium text-accent underline underline-offset-2">
            Turn them on
          </Link>
          , then send a test.
        </>
      ),
    });
  return (
    <>
      <NoticeStack items={notices} />

      <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line ${d.today.liveUnits !== undefined ? "lg:grid-cols-4" : "lg:grid-cols-3 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2"}`}>
        <Tile flat
          label="Betting"
          value={d.betting.on ? (d.betting.breaker.open ? "Paused" : "On") : "Off"}
          sub={`${d.betting.liveStrategies} Live strateg${d.betting.liveStrategies === 1 ? "y" : "ies"} · placing: ${d.betting.directMode === "live" ? "GoalBrew" : d.betting.directMode === "shadow" ? "shadow only" : "off"}`}
          warn={d.betting.on && d.betting.breaker.open}
        />
        <Tile flat label="Live today" value={<Flash value={d.today.liveNet}><span className={toneOf(d.today.liveNet)}>{gbp(d.today.liveNet, false)}</span></Flash>} sub={<>{d.today.liveSettled} settled<SimToday value={gbp(d.today.simNet, false)} tone={toneOf(d.today.simNet)} settled={d.today.simSettled} /></>} />
        {/* The same day as if every bet were the same 1-unit stake, so a stake change can't make it look better or worse. */}
        {d.today.liveUnits !== undefined && (
          <Tile flat
            label="Units today"
            value={<Flash value={d.today.liveUnits}><span className={toneOf(d.today.liveUnits)}>{units(d.today.liveUnits)}</span></Flash>}
            sub={<>Live, {d.today.liveSettled} settled<SimToday value={units(d.today.simUnits ?? 0)} tone={toneOf(d.today.simUnits ?? 0)} settled={d.today.simSettled} /></>}
          />
        )}
        <Tile flat
          label="Daily loss stop"
          value={d.limits.dailyLossLimit > 0 ? `£${d.limits.dailyLossLimit}` : "Off"}
          sub={d.limits.dailyLossLimit > 0 ? (d.limits.lossStop ? "Reached today" : d.today.liveNet < 0 ? `${gbp(-d.today.liveNet, false)} of it used today` : "None used today") : undefined}
          warn={d.limits.dailyLossLimit === 0 || d.limits.lossStop !== null}
        >
          {d.limits.dailyLossLimit === 0 && (
            <Link href="/more/admin/sending?tab=limits" className="mt-1 inline-block text-xs font-medium text-accent hover:underline">
              Set limit ›
            </Link>
          )}
        </Tile>
      </div>

      {/* The rest of the health checks fold into one line while all is well, and open by themselves the moment one needs a look. */}
      <details key={systemsWarn ? "warn" : "ok"} open={systemsWarn} className="group rounded-xl border border-line bg-surface px-3">
        <summary className="min-h-11 cursor-pointer py-2.5 text-sm text-ink">
          <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-medium">
            {systemsWarn && <AttentionDot />}
            {systemsWarn ? "Systems: needs a look" : "Systems: all OK"}
          </span>
          {/* Four short labelled figures in place of one run-on line. */}
          <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-ink-muted">
            {[
              ["Balance", d.bank.available === null ? "not read yet" : `£${d.bank.available.toFixed(2)}`],
              ["Out", `£${d.exposure.openStake.toFixed(2)}`],
              ["Alerts, last hour", String(d.alerts.lastHour)],
              ["Waiting", String(d.queue.waiting + d.queue.placing)],
            ].map(([k, v]) => (
              <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5">
                {k} <span className="font-medium tabular-nums text-ink">{v}</span>
              </span>
            ))}
          </span>
          </span>
        </summary>
        <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-5 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2">
        <Tile
          flat
          label="Betfair balance"
          value={d.bank.available === null ? "–" : `£${d.bank.available.toFixed(2)}`}
          sub={d.bank.at ? `exposure £${Math.abs(d.bank.exposure ?? 0).toFixed(2)} · read ${ago(d.bank.at)}` : "Not connected"}
          warn={bankAge !== null && bankAge > 30 * 60_000}
        />
        <Tile
          flat
          label="Money out now"
          value={`£${d.exposure.openStake.toFixed(2)}`}
          sub={
            d.exposure.biggestMatch
              ? `most on one match £${d.exposure.biggestMatch.stake.toFixed(2)}${d.limits.matchCap > 0 ? ` (limit £${d.limits.matchCap})` : ""}`
              : "no open bets"
          }
          warn={d.limits.matchCap === 0}
        >
          {d.limits.matchCap === 0 && (
            <Link href="/more/admin/sending?tab=limits" className="mt-1 inline-block text-xs font-medium text-accent hover:underline">
              No match limit · Set ›
            </Link>
          )}
        </Tile>
        <Tile
          flat
          label="Alerts"
          value={`${d.alerts.lastHour} / hour`}
          sub={`last ${ago(tg.lastAlertAt)} · Telegram ${tg.ok ? "OK" : "problem"}${volume?.low ? ` · usually ${volume.typical} by now` : ""}`}
          warn={!tg.ok || !!volume?.low}
        />
        <Tile
          flat
          label="Bets in progress"
          value={`${d.queue.waiting + d.queue.placing} waiting`}
          sub={notPlacedText(d.queue)}
          warn={notPlacedWarns(d.queue)}
        />
        <Tile
          flat
          label="Betfair link"
          value={d.betting.betfair.configured ? (d.betting.betfair.lastError ? "Problem" : "OK") : "Not set up"}
          sub={d.betting.betfair.configured ? `last answered ${ago(d.betting.betfair.lastOkAt)}` : undefined}
          warn={!!d.betting.betfair.lastError}
        />
        </div>
      </details>

      {d.advice && d.advice.length > 0 && (
        <Card title="Suggestions" subtitle="Nothing changes until you apply one.">
          <ApplyAllAdvice advice={d.advice} nameOf={(a) => adviceTitle(a, names.name)} />
          <ul className="mt-3 space-y-3 text-sm">
            {d.advice.map((a) => (
              <AdviceRow key={`${a.key}:${a.kind}:${a.league?.key ?? ""}`} a={a} name={adviceTitle(a, names.name)} />
            ))}
          </ul>
        </Card>
      )}
      {/* Outside the card: when every suggestion is ignored the card is gone, and this is the way to bring one back. */}
      <IgnoredAdvice nameOf={(a) => adviceTitle(a, names.name)} />

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

/**
 * Home: the admin's one page for "is it working, how am I doing, what needs me" (14 Nov 2026). The day's status first
 * (this was the Today page), then the performance figures that were the Dashboard, then the slower detail folded away.
 * The address is still /today so saved links and notifications keep working.
 */
export default function TodayPage() {
  const { data, error, isLoading, dataUpdatedAt } = useToday();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Home"
        subtitle={
          <>
            <UpdatedAgo at={dataUpdatedAt || null} staleAfter={60} />
          </>
        }
        actions={data ? <KillSwitch on={data.betting.on} /> : undefined}
      />
      {error ? (
        <QueryError error={error} next="/more/admin/today" />
      ) : isLoading || !data ? (
        <StripSkeleton cells={4} columns={2} />
      ) : (
        <Tiles d={data} />
      )}
      <NotPlaced />
      <div className="border-t border-line pt-6">
        <DashboardBody embedded />
      </div>
    </div>
  );
}

