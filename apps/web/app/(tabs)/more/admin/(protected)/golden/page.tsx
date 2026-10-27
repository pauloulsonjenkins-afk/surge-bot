"use client";

import { useState } from "react";
import { Card, PageHeader } from "@/components/ui/Card";
import { SegmentBetting } from "@/components/admin/SegmentBetting";
import { useSending } from "@/queries/use-sending";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { GoldenBadge, sliceName } from "@/components/ui/SegmentLabel";
import { useGolden, useGoldenAction, type GoldenSlice, type GoldenSuggestion } from "@/queries/use-golden";
import type { StrategyReturn } from "@/server/engine-client";
import { signedPct, toneOf, gbp } from "@/lib/format";

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const dayTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** Buttons and links that act as buttons in a slice's row: 44px tall on a phone, the same look side by side. */
const action = "inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium ring-1 ring-inset ring-line disabled:opacity-40";

/** Below this many priced picks a return is noise: shown, but not in green or red ("−100%" on one pick looked like news). */
const FEW = 10;

/** The one colour rule on this page: green making money, red losing, grey on fewer than FEW picks (too few to judge). */
const judged = (roi: number | null | undefined, n: number) => (n < FEW ? "text-ink-muted" : toneOf(roi));

/** One side of the comparison: its return per £1 as the figure to read, its record under it. */
function Side({ r, name, split }: { r: StrategyReturn; name: string; split?: { live: StrategyReturn; sim: StrategyReturn } }) {
  const hits = r.hits ?? 0;
  const few = r.counted < FEW;
  return (
    <div className="min-w-0 rounded-md bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-muted">{name}</p>
      {r.settled === 0 ? (
        <p className="mt-0.5 text-sm text-ink-muted">Nothing settled yet</p>
      ) : (
        <>
          <p className={`mt-0.5 font-display text-lg font-bold tabular-nums [font-stretch:112%] ${judged(r.roi, r.counted)}`}>{r.counted > 0 ? signedPct(r.roi) : "–"}</p>
          <p className="text-xs tabular-nums text-ink-muted">
            {hits}–{r.settled - hits}
            {r.counted > 0 && ` · ${r.counted} priced`}
            {r.counted > 0 && few && " · too few to judge"}
          </p>
          {/* Live and Sim apart, so a switch between them never changes what's shown above (that's both together). */}
          {split && (
            <p className="text-xs tabular-nums text-ink-muted">
              Live{" "}
              <span className={judged(split.live.roi, split.live.counted)}>{split.live.counted > 0 ? signedPct(split.live.roi) : "–"}</span> ({split.live.counted}) · Sim{" "}
              <span className={judged(split.sim.roi, split.sim.counted)}>{split.sim.counted > 0 ? signedPct(split.sim.roi) : "–"}</span> ({split.sim.counted})
            </p>
          )}
        </>
      )}
    </div>
  );
}

function betText(s: GoldenSlice): string {
  if (!s.bet) return `Bet like the rest of ${s.strategy}: ${s.strategyLive ? "Live" : "Sim"}.`;
  const stake = s.bet.stakePct != null ? `${s.bet.stakePct}% of the balance` : s.bet.stake != null ? `£${s.bet.stake}` : `${s.strategy}'s stake`;
  return `Bet on its own: ${s.bet.live ? "Live" : "Sim"} at ${stake}.`;
}

/** The slices grouped by strategy, in the order they come. */
function byStrategy(slices: GoldenSlice[]): Array<{ strategy: string; slices: GoldenSlice[] }> {
  const groups = new Map<string, { strategy: string; slices: GoldenSlice[] }>();
  for (const s of slices) (groups.get(s.strategyKey) ?? groups.set(s.strategyKey, { strategy: s.strategy, slices: [] }).get(s.strategyKey)!).slices.push(s);
  return [...groups.values()];
}

/**
 * Golden: the parts of a strategy that may be worth more than the rest. Each is counted from the day it started being
 * watched, and its bets are part of its strategy's bets, never extra. The finder suggests new ones to watch.
 */
export default function GoldenPage() {
  const { data, isLoading, error } = useGolden();
  const act = useGoldenAction();
  const dialog = useDialog();
  const sending = useSending(60_000);
  // The slice whose betting switch is open ("strategyKey#id").
  const [betting, setBetting] = useState<string | null>(null);
  // Fixed when the page opens: only used to tell a start date still to come from one already passed.
  const [now] = useState(() => Date.now());
  // Filters for "Being watched", below the colour key: by strategy/alert name, and by whether it's making money.
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "profit" | "loss">("all");
  const candidateFrom = data?.candidateFrom ?? 50;
  const trialFrom = data?.trialFrom ?? 150;
  const fullFrom = data?.fullFrom ?? 300;
  const worst = Math.abs((data?.safety?.worstRoi ?? -0.05) * 100);
  const minBets = data?.safety?.minBets ?? 30;

  const watch = async (g: GoldenSuggestion) => {
    const ok = await dialog.confirm({
      title: `Watch ${sliceName(g.label)} for ${g.strategy}?`,
      confirmLabel: "Watch it",
      body: <p>It&apos;s counted from today, on new matches only, so the matches that suggested it can&apos;t also prove it. Nothing is bet differently.</p>,
    });
    if (ok) act.mutate({ action: "watch", strategyKey: g.strategyKey, rule: g.rule });
  };
  const stop = async (s: GoldenSlice) => {
    const ok = await dialog.confirm({ title: `Stop watching ${sliceName(s.label)}?`, confirmLabel: "Stop watching", body: <p>Its record is kept in the strategy&apos;s figures; only this line goes.</p> });
    if (ok) act.mutate({ action: "unwatch", strategyKey: s.strategyKey, id: s.id });
  };
  const checked = data ? new Date(data.suggestions.at) : null;
  const allMainSlices = data?.slices.filter((s) => !s.quiet) ?? [];
  const quietSlices = data?.slices.filter((s) => s.quiet) ?? [];
  const golden = allMainSlices.filter((s) => s.status === "full").length;
  const term = search.trim().toLowerCase();
  const mainSlices = allMainSlices.filter((s) => {
    if (term && !s.strategy.toLowerCase().includes(term) && !sliceName(s.label).toLowerCase().includes(term)) return false;
    if (resultFilter !== "all") {
      const roi = s.slice.all.roi;
      if (roi === null) return false;
      if (resultFilter === "profit" && roi <= 0) return false;
      if (resultFilter === "loss" && roi > 0) return false;
    }
    return true;
  });

  return (
    // The admin layout already gives the page its side margins, so none here (they were doubled before).
    <div className="space-y-5">
      <PageHeader title="Golden" subtitle="Parts of a strategy that beat the rest. Gold: proved. Outline: still proving." />
      {/* The colour key: the same rule for every figure on the page. */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>
          <span className="font-semibold text-hit">Green</span> making money
        </span>
        <span>
          <span className="font-semibold text-loss">Red</span> losing
        </span>
        <span>
          <span className="font-semibold">Grey</span> fewer than {FEW} priced picks, too few to judge
        </span>
      </p>

      <details className="rounded-xl border border-line bg-surface px-4 py-1 text-sm text-ink-muted">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">How Golden works</summary>
        <div className="space-y-2 pb-3">
          <p>
            Each slice is counted from the day it started being watched, on new matches only. Its bets are <b className="text-ink">part of its strategy&apos;s bets</b>, not
            extra ones: the figures show that part against the rest of the same strategy, Live and Sim picks together.
          </p>
          <p>
            Watched quietly (no notification) until {candidateFrom} priced picks in profit make it a <b className="text-ink">candidate</b> (one notification). At{" "}
            {trialFrom}+, still in profit in both halves of its record, a <b className="text-ink">small Live trial</b> is suggested — 1% stake, with a stop loss (one
            notification). At {fullFrom}+, once that trial is itself in profit, <b className="text-gold">full stake</b> is suggested (one notification). Nothing is ever
            switched Live or re-staked automatically — every suggestion is the admin&apos;s call.
          </p>
          <p>
            It has to keep earning its stage: if its last 30 picks lose more than 5% per £1, the stage goes at once (with a notification), and it only comes back after
            30 more picks back in profit.
          </p>
          <p>
            Bet one on its own with its &ldquo;Change betting&rdquo; button below (or from its strategy&apos;s card on Strategies). Safety: a slice bet Live on its own goes back to Sim by itself, with a
            notification, if it stops holding up or its own Live bets lose more than {worst}% per £1 over {minBets}+ bets.
          </p>
        </div>
      </details>

      {error ? (
        <QueryError error={error} next="/more/admin/golden" />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card
            title="Being watched"
            subtitle={allMainSlices.length > 0 ? `${mainSlices.length} of ${allMainSlices.length} shown · ${golden} proved Golden` : undefined}
          >
            {allMainSlices.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by strategy or alert…"
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm text-ink"
                />
                <div className="flex min-h-11 items-center gap-1 rounded-md bg-surface-2 p-1 text-xs">
                  {(["all", "profit", "loss"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={resultFilter === f}
                      onClick={() => setResultFilter(f)}
                      className={`min-h-9 rounded px-2.5 font-medium ${resultFilter === f ? "bg-surface text-ink shadow-sm" : "text-ink-muted"}`}
                    >
                      {f === "all" ? "All" : f === "profit" ? "Making money" : "Losing"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {allMainSlices.length > 0 && (
              <div className="mb-4 rounded-md bg-surface-2 p-3 text-xs text-ink-muted">
                <p>
                  <span className="font-medium text-ink">Alert notifications.</span> Switch &ldquo;Notify me&rdquo; on for a slice to get a notification on
                  your phone the moment one of its alerts arrives: the match, the bet, the price and whether GoalBrew bets it. One per alert, even if
                  it&apos;s in several slices. Each notification has a &ldquo;Mute these&rdquo; button.{" "}
                  {allMainSlices.filter((s) => s.notify).length} switched on.
                </p>
                <button
                  type="button"
                  aria-pressed={data.notifyQuiet !== false}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: "quiet", quiet: data.notifyQuiet === false })}
                  className={`${action} mt-2 text-ink`}
                >
                  Quiet 23:00–07:00: {data.notifyQuiet === false ? "off" : "on"}
                </button>
                {/* A switch that couldn't be saved says so here, by the switches, not only at the foot of the page. */}
                {act.error && <p className="mt-2 text-destructive">Couldn&apos;t save that: {act.error.message}</p>}
              </div>
            )}
            {mainSlices.length === 0 ? (
              <p className="text-sm text-ink-muted">{allMainSlices.length === 0 ? "Nothing is being watched yet." : "Nothing matches that filter."}</p>
            ) : (
              <div className="space-y-5">
                {byStrategy(mainSlices).map((g) => (
                  <section key={g.strategy}>
                    <h3 className="text-sm font-semibold text-ink">{g.strategy}</h3>
                    <ul className="mt-1 divide-y divide-line">
                      {g.slices.map((s) => {
                        const since = new Date(s.since);
                        return (
                          <li key={`${s.strategyKey}#${s.id}`} className="space-y-2 py-3 text-sm">
                            {/* Badge and date first, so the slice's name gets the full width on a phone. */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <GoldenBadge
                                status={s.status}
                                candidate={`Candidate · ${s.slice.all.counted} of ${trialFrom}`}
                                trial={`Live trial suggested · ${s.slice.all.counted} of ${fullFrom}`}
                              />
                              <span className="text-xs text-ink-muted">
                                {/* A slice set up ahead of time counts from midnight; until then, say so rather than "since" a date to come. */}
                                {since.getTime() > now ? "counted from" : "since"} {day.format(since)}
                              </span>
                            </div>
                            <p className="font-medium text-ink">{sliceName(s.label)}</p>
                            <div className="grid grid-cols-2 gap-2">
                              <Side r={s.slice.all} name="This part · Live + Sim" split={s.slice} />
                              <Side r={s.rest.all} name={`Rest of ${s.strategy}`} split={s.rest} />
                            </div>
                            {s.bet?.live && (
                              <p className="text-xs text-ink-muted">
                                Its own Live bets since {s.bet.liveSince ? day.format(new Date(s.bet.liveSince)) : "it was switched on"}:{" "}
                                {s.ownLive && s.ownLive.n > 0 ? (
                                  <span className="tabular-nums">
                                    {s.ownLive.won}–{s.ownLive.n - s.ownLive.won} <span className={judged(s.ownLive.roi, s.ownLive.n)}>{signedPct(s.ownLive.roi)}</span> on {s.ownLive.n} ·{" "}
                                    {gbp(s.ownLive.profit)}
                                  </span>
                                ) : (
                                  "none settled yet"
                                )}
                              </p>
                            )}
                            {s.recent && s.recent.n > 0 && s.status !== "candidate" && s.status !== "quiet" && (
                              <p className="text-xs tabular-nums text-ink-muted">
                                Last {s.recent.n} picks: {s.recent.won}–{s.recent.n - s.recent.won}{" "}
                                <span className={judged(s.recent.roi, s.recent.n)}>{signedPct(s.recent.roi)}</span>
                              </p>
                            )}
                            {s.why && <p className="text-xs text-destructive">Not holding up: {s.why}.</p>}
                            <p className={`text-xs ${s.bet?.live ? "font-medium text-ink" : "text-ink-muted"}`}>{betText(s)}</p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                aria-pressed={s.notify === true}
                                disabled={act.isPending}
                                onClick={() => act.mutate({ action: "notify", strategyKey: s.strategyKey, id: s.id, on: !s.notify })}
                                className={`${action} ${s.notify ? "gold-chip-outline font-semibold" : "text-ink"}`}
                              >
                                {s.notify ? "🔔 Notify me: on" : "Notify me: off"}
                              </button>
                              <button
                                type="button"
                                aria-expanded={betting === `${s.strategyKey}#${s.id}`}
                                onClick={() => setBetting(betting === `${s.strategyKey}#${s.id}` ? null : `${s.strategyKey}#${s.id}`)}
                                className={`${action} text-accent`}
                              >
                                Change betting
                              </button>
                              {s.custom && (
                                <button type="button" disabled={act.isPending} onClick={() => void stop(s)} className={`${action} text-ink-muted`}>
                                  Stop watching
                                </button>
                              )}
                            </div>
                            {/* The slice's own Live / Sim switch and stake, here rather than a trip to Strategies. */}
                            {betting === `${s.strategyKey}#${s.id}` &&
                              (sending.data ? (
                                <SegmentBetting
                                  strategyKey={s.strategyKey}
                                  strategyName={s.strategy}
                                  segment={{ id: s.id, label: s.label }}
                                  settings={sending.data.settings}
                                  strategyLive={s.strategyLive}
                                />
                              ) : sending.error ? (
                                <p className="text-xs text-destructive">Couldn&apos;t load the betting settings: {sending.error.message}</p>
                              ) : (
                                <Skeleton className="h-20 w-full" />
                              ))}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Card>

          {quietSlices.length > 0 && (
            <details className="rounded-xl border border-line bg-surface px-4 py-1 text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">
                Watched quietly by the finder ({quietSlices.length})
              </summary>
              <div className="space-y-1 pb-3">
                <p className="text-xs text-ink-muted">
                  New ideas the finder found itself, counted from the day found. No notifications yet: once one reaches {candidateFrom} priced picks in
                  profit, you&apos;ll be told it&apos;s a candidate.
                </p>
                <ul className="divide-y divide-line">
                  {quietSlices.map((s) => (
                    <li key={`${s.strategyKey}#${s.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                      <span className="min-w-0">
                        <span className="block text-ink-muted">{s.strategy}</span>
                        <span className="block font-medium text-ink">{sliceName(s.label)}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {s.slice.all.counted} of {candidateFrom}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}

          <Card
            title="Suggested by the Golden finder"
            subtitle={`Slices that beat the rest in both halves of the record. Some will be luck, so each is proved on new matches from the day you watch it.${
              checked && !Number.isNaN(checked.getTime()) ? ` Last checked ${dayTime.format(checked)}.` : ""
            }`}
          >
            {data.suggestions.list.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing new stands out right now. You&apos;ll get a notification when it does.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.suggestions.list.map((g) => (
                  <li key={`${g.strategyKey}#${g.rule.join("+")}`} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-ink-muted">{g.strategy}</span>
                      <span className="block font-medium text-ink">{sliceName(g.label)}</span>
                      <span className="mt-0.5 block text-xs tabular-nums text-ink-muted">
                        <span className={judged(g.slice.roi, g.slice.n)}>{signedPct(g.slice.roi)}</span> per £1 over {g.slice.n} picks
                        {g.slice.n > 0 && ` (${Math.round((g.slice.hits / g.slice.n) * 100)}% won, likely ${signedPct(g.slice.low)} or better)`} · the rest{" "}
                        <span className={judged(g.rest.roi, g.rest.n)}>{signedPct(g.rest.roi)}</span> over {g.rest.n}
                      </span>
                      <span className="block text-xs tabular-nums text-ink-muted">
                        Older half {signedPct(g.halves[0]?.slice)} vs {signedPct(g.halves[0]?.rest)} · newer half {signedPct(g.halves[1]?.slice)} vs {signedPct(g.halves[1]?.rest)}
                      </span>
                    </span>
                    <button type="button" disabled={act.isPending} onClick={() => void watch(g)} className={`${action} shrink-0 text-ink`}>
                      Watch it
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {act.error && <p className="mt-2 text-xs text-destructive">{act.error.message}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
