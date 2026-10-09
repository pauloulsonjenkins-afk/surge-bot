"use client";

import { useMemo, useState } from "react";
import { Card, PageHeader, Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useAwayLayTest, useLeagueHistory, useRefreshHistory, type HistoryStatus, type LeagueProfile } from "@/queries/use-history";

const inputCls = "w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink";
const tone = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink");
const signed = (n: number, suffix = "") => `${n > 0 ? "+" : ""}${n}${suffix}`;
/** Fewer bets than this and a league's return is mostly luck. */
const ENOUGH = 100;

type SortKey = "homeEdge" | "homePct" | "drawPct" | "avgGoals" | "firstHalfGoalPct" | "over25Pct" | "avgCorners";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "homeEdge", label: "Home edge" },
  { value: "drawPct", label: "Draws" },
  { value: "avgGoals", label: "Goals" },
  { value: "firstHalfGoalPct", label: "1st-half goal" },
  { value: "over25Pct", label: "Over 2.5" },
  { value: "avgCorners", label: "Corners" },
];

function StatusLine({ status }: { status: HistoryStatus }) {
  const refresh = useRefreshHistory();
  if (status.state === "loading" || status.state === "idle") {
    return (
      <p className="animate-pulse text-xs text-ink-muted">
        Downloading past results: {status.done} of {status.total || "…"} files. This takes a minute or two the first time after an update.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
      <span>
        {status.matches.toLocaleString("en-GB")} matches
        {status.loadedAt && ` · updated ${new Date(status.loadedAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
        {status.errors.length > 0 && <span className="text-warn"> · {status.errors.length} files couldn’t be downloaded</span>}
      </span>
      <button type="button" disabled={refresh.isPending} onClick={() => refresh.mutate()} className="rounded-md border border-line px-2 py-0.5 text-ink hover:bg-surface-2 disabled:opacity-50">
        {refresh.isPending ? "Refreshing…" : "Refresh this season"}
      </button>
    </div>
  );
}

/** Away Win Lay on past matches: how laying the away side would have done, by league and season. */
function AwayLayTest({ seasons, ready }: { seasons: number; ready: boolean }) {
  const [form, setForm] = useState({ min: "2.5", max: "6", commission: "2" });
  const [query, setQuery] = useState({ min: 2.5, max: 6, commission: 0.02 });
  const [divs, setDivs] = useState<string[]>([]);
  const { data, error, isFetching } = useAwayLayTest({ ...query, spread: 0.02, seasons, divs }, ready);

  function run() {
    const min = Number(form.min);
    const max = Number(form.max);
    const commission = Number(form.commission) / 100;
    if (Number.isFinite(min) && Number.isFinite(max) && min > 1 && max >= min && Number.isFinite(commission)) setQuery({ min, max, commission });
  }
  const toggle = (code: string) => setDivs((d) => (d.includes(code) ? d.filter((x) => x !== code) : [...d, code]));

  return (
    <Card
      title="Away Win Lay: tested on past seasons"
      subtitle="Lays the away side in every past match whose away price is in your range, risking £1 each time (the most you can lose on one bet). It pays when the home side wins or it's a draw."
    >
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-ink-muted">
          Away price from
          <input inputMode="decimal" className={`${inputCls} mt-1`} value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} />
        </label>
        <label className="text-xs text-ink-muted">
          to
          <input inputMode="decimal" className={`${inputCls} mt-1`} value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
        </label>
        <label className="text-xs text-ink-muted">
          Commission %
          <input inputMode="decimal" className={`${inputCls} mt-1`} value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} />
        </label>
      </div>
      <button type="button" onClick={run} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90">
        Run the test
      </button>

      {error ? (
        <p className="mt-3 text-sm text-destructive">{error.message}</p>
      ) : !data ? (
        <Skeleton className="mt-3 h-40 w-full" />
      ) : (
        <div className={`mt-4 space-y-4 ${isFetching ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Bets", data.total.bets.toLocaleString("en-GB"), "text-ink"],
              ["Won", data.total.bets ? `${Math.round((1000 * data.total.won) / data.total.bets) / 10}%` : "–", "text-ink"],
              ["Profit (£1 risked each)", `£${data.total.profit.toFixed(2)}`, tone(data.total.profit)],
              ["Return per £1 risked", signed(data.total.roi, "%"), tone(data.total.roi)],
            ].map(([label, value, cls]) => (
              <div key={label} className="rounded-xl border border-line bg-surface-2 p-3 text-center">
                <p className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</p>
                <p className="text-xs text-ink-muted">{label}</p>
              </div>
            ))}
          </div>

          {data.bySeason.length > 1 && (
            <div>
              <h4 className="text-sm font-medium text-ink">By season</h4>
              <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {data.bySeason.map((s) => (
                  <li key={s.season} className="rounded-md border border-line px-2 py-1">
                    {s.season}/{String((s.season + 1) % 100).padStart(2, "0")} <span className={`tabular-nums ${tone(s.roi)}`}>{signed(s.roi, "%")}</span>{" "}
                    <span className="text-ink-muted">· {s.bets}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-medium text-ink">By league</h4>
              {divs.length > 0 ? (
                <button type="button" onClick={() => setDivs([])} className="text-xs text-ink-muted underline">
                  Testing {divs.length} chosen · show all
                </button>
              ) : (
                <span className="text-xs text-ink-muted">Tap leagues to test just those together</span>
              )}
            </div>
            <ul className="mt-1 divide-y divide-line">
              {data.byLeague.map((l) => {
                const on = divs.includes(l.code);
                return (
                  <li key={l.code}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(l.code)}
                      className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-2 text-left ${on ? "bg-accent/15" : "hover:bg-surface-2"} ${l.bets < ENOUGH ? "opacity-60" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">
                          {l.country} · {l.name}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {l.bets} bets · won {l.bets ? Math.round((1000 * l.won) / l.bets) / 10 : 0}% · avg price {l.avgOdds.toFixed(2)} · {l.oddsSource}
                          {l.bets < ENOUGH && " · too few to trust"}
                        </span>
                      </span>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${tone(l.roi)}`}>{signed(l.roi, "%")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-xs text-ink-muted">
            Prices are the best the files have, taken before kick-off: the Betfair Exchange where it’s recorded, otherwise Pinnacle or the market average. The lay
            price is taken as 2% worse than that, and commission comes off winnings. It can’t know whether your bet would have been matched, so treat it as a
            guide. Picking the leagues that did best here and expecting the same again flatters the result: check a choice holds up season by season.
            {data.noPrice > 0 && ` ${data.noPrice.toLocaleString("en-GB")} matches had no price and are left out.`}
          </p>
        </div>
      )}
    </Card>
  );
}

function Profiles({ profiles }: { profiles: LeagueProfile[] }) {
  const [sort, setSort] = useState<SortKey>("homeEdge");
  const rows = useMemo(() => [...profiles].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1)), [profiles, sort]);
  const cell = (v: number | null, suffix = "") => (v === null ? "–" : `${v}${suffix}`);
  return (
    <Card title="League profiles" subtitle="How each league plays, from its past results. Home edge is home wins minus away wins: the bigger it is, the more the home side is favoured.">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        Sort by
        <div className="inline-flex flex-wrap rounded-md border border-line p-0.5" role="group" aria-label="Sort leagues by">
          {SORTS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={sort === o.value}
              onClick={() => setSort(o.value)}
              className={`rounded px-2 py-1 font-medium ${sort === o.value ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface-2"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {/* Phones: one card per league, the sorted figure first. Wider screens: the full table. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((p) => (
          <li key={p.code} className="rounded-lg border border-line p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 text-sm text-ink">
                {p.name} <span className="text-xs text-ink-muted">{p.country}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                {sort === "homeEdge" ? signed(p.homeEdge) : sort === "avgGoals" ? p.avgGoals.toFixed(2) : sort === "avgCorners" ? cell(p.avgCorners) : cell(p[sort], "%")}
              </span>
            </div>
            <p className="mt-1 text-xs tabular-nums text-ink-muted">
              H {p.homePct}% · D {p.drawPct}% · A {p.awayPct}% · edge {signed(p.homeEdge)} · goals {p.avgGoals.toFixed(2)} · 1H goal {cell(p.firstHalfGoalPct, "%")} · O2.5 {p.over25Pct}% ·
              corners {cell(p.avgCorners)} · {p.matches.toLocaleString("en-GB")} matches
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-ink-muted">
            <tr>
              <th className="py-1.5 pr-2 font-medium">League</th>
              <th className="px-2 font-medium">Home</th>
              <th className="px-2 font-medium">Draw</th>
              <th className="px-2 font-medium">Away</th>
              <th className="px-2 font-medium">Home edge</th>
              <th className="px-2 font-medium">Goals</th>
              <th className="px-2 font-medium">1st-half goal</th>
              <th className="px-2 font-medium">Over 2.5</th>
              <th className="px-2 font-medium">Corners</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {rows.map((p) => (
              <tr key={p.code}>
                <td className="py-2 pr-2">
                  <span className="text-ink">{p.name}</span> <span className="text-xs text-ink-muted">{p.country}</span>
                  <span className="block text-xs text-ink-muted">{p.matches.toLocaleString("en-GB")} matches</span>
                </td>
                <td className="px-2">{p.homePct}%</td>
                <td className="px-2">{p.drawPct}%</td>
                <td className="px-2">{p.awayPct}%</td>
                <td className="px-2 font-medium">{signed(p.homeEdge)}</td>
                <td className="px-2">{p.avgGoals.toFixed(2)}</td>
                <td className="px-2">{cell(p.firstHalfGoalPct, "%")}</td>
                <td className="px-2">{p.over25Pct}%</td>
                <td className="px-2">{cell(p.avgCorners)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">A dash means that league’s files don’t record it.</p>
    </Card>
  );
}

/** Past results and prices from football-data.co.uk: league profiles, and strategies tested on past seasons. */
export default function HistoryPage() {
  const [seasons, setSeasons] = useState(6);
  const { data, isLoading, error } = useLeagueHistory(seasons);
  const ready = data?.status.state === "ready";

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="League history"
        subtitle="Past results and prices for 38 leagues, used to see how each league plays and to test a strategy on past seasons before risking money. Data: football-data.co.uk."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Seasons"
          value={String(seasons)}
          onChange={(v) => setSeasons(Number(v))}
          options={[
            { value: "1", label: "This season" },
            { value: "3", label: "3 seasons" },
            { value: "6", label: "6 seasons" },
          ]}
        />
      </div>
      {error ? (
        <QueryError error={error} next="/more/admin/history" />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <StatusLine status={data.status} />
          {data.status.state === "failed" ? (
            <p className="text-sm text-destructive">The past results couldn’t be downloaded. Try “Refresh this season” in a few minutes.</p>
          ) : ready ? (
            <>
              <AwayLayTest seasons={seasons} ready={ready} />
              <Profiles profiles={data.profiles} />
            </>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </>
      )}
    </div>
  );
}
