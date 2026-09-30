"use client";

import { PageHeader, Segmented } from "@/components/ui/Card";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ListSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useSchedule, type ScheduleFixture, type ScheduleWhen } from "@/queries/use-schedule";

/** Countries shown first, then everything else by number of games. */
const PINNED_COUNTRIES = ["England", "Scotland", "Wales", "World"];
/** How many country sections start open. */
const OPEN_BY_DEFAULT = 3;

const ukTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const ukDateLong = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const ukDayShort = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const FRESH_MS = 24 * 60 * 60 * 1000;

function kickoffTime(f: ScheduleFixture): string {
  return ukTime.format(new Date(f.timestamp * 1000));
}

type Phase = "upcoming" | "started" | "finished" | "postponed" | "cancelled" | "tbc";

function phaseOf(f: ScheduleFixture, nowSec: number): Phase {
  if (f.status === "PST" || f.status === "SUSP" || f.status === "INT") return "postponed";
  if (f.status === "CANC" || f.status === "ABD" || f.status === "AWD" || f.status === "WO") return "cancelled";
  if (f.status === "TBD") return "tbc";
  if (f.status === "FT" || f.status === "AET" || f.status === "PEN") return "finished";
  if (f.status !== "NS") return "started";
  return f.timestamp <= nowSec ? "started" : "upcoming";
}

function PhaseChip({ phase }: { phase: Phase }) {
  if (phase === "upcoming") return null;
  const text =
    phase === "started"
      ? "Kicked off"
      : phase === "finished"
        ? "Finished"
        : phase === "postponed"
          ? "Postponed"
          : phase === "cancelled"
            ? "Cancelled"
            : "Time TBC";
  const colour = phase === "postponed" || phase === "cancelled" ? "text-danger" : "text-ink-muted";
  return <span className={`shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium ${colour}`}>{text}</span>;
}

interface LeagueGroup {
  key: string;
  league: string;
  fixtures: ScheduleFixture[];
}
interface CountryGroup {
  country: string;
  games: number;
  leagues: LeagueGroup[];
}

function groupByCountry(fixtures: ScheduleFixture[]): CountryGroup[] {
  const countries = new Map<string, Map<string, LeagueGroup>>();
  for (const f of fixtures) {
    const leagues = countries.get(f.country) ?? new Map<string, LeagueGroup>();
    const key = `${f.leagueId}|${f.league}`;
    const g = leagues.get(key) ?? { key, league: f.league, fixtures: [] };
    g.fixtures.push(f);
    leagues.set(key, g);
    countries.set(f.country, leagues);
  }
  const out: CountryGroup[] = [];
  for (const [country, leagues] of countries) {
    const list = [...leagues.values()].sort((a, b) => b.fixtures.length - a.fixtures.length || a.league.localeCompare(b.league));
    for (const l of list) l.fixtures.sort((a, b) => a.timestamp - b.timestamp || a.home.localeCompare(b.home));
    out.push({ country, games: list.reduce((n, l) => n + l.fixtures.length, 0), leagues: list });
  }
  const pin = (c: string) => {
    const i = PINNED_COUNTRIES.indexOf(c);
    return i === -1 ? PINNED_COUNTRIES.length : i;
  };
  return out.sort((a, b) => pin(a.country) - pin(b.country) || b.games - a.games || a.country.localeCompare(b.country));
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-xl font-medium tabular-nums text-ink">{value}</p>
      {detail && <p className="truncate text-[11px] text-ink-muted">{detail}</p>}
    </div>
  );
}

export default function SchedulePage() {
  const [when, setWhen] = useState<ScheduleWhen>("today");
  const { data, isLoading, error } = useSchedule(when);
  const [search, setSearch] = useState("");
  const [hideStarted, setHideStarted] = useState(false);
  // "time" lists every game in kick-off order, next game first. "country" is the grouped list.
  const [view, setView] = useState<"time" | "country">("time");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  // Re-check every minute, so games move to "Kicked off" without a reload.
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  // A new day's list starts with the default sections open.
  useEffect(() => setOpen({}), [when, data?.date]);

  const all = data?.fixtures ?? [];
  const summary = useMemo(() => {
    const leagues = new Set(all.map((f) => `${f.leagueId}|${f.league}`));
    const countries = new Set(all.map((f) => f.country));
    const toStart = all.filter((f) => phaseOf(f, nowSec) === "upcoming");
    const next = toStart.reduce<ScheduleFixture | null>((best, f) => (!best || f.timestamp < best.timestamp ? f : best), null);
    const off = all.filter((f) => {
      const p = phaseOf(f, nowSec);
      return p === "postponed" || p === "cancelled";
    }).length;
    return { games: all.length, leagues: leagues.size, countries: countries.size, toStart: toStart.length, next, off };
  }, [all, nowSec]);

  const query = search.trim().toLowerCase();
  const shownFixtures = useMemo(
    () =>
      all.filter((f) => {
        if (hideStarted && phaseOf(f, nowSec) !== "upcoming") return false;
        if (!query) return true;
        return [f.home, f.away, f.league, f.country].some((s) => s.toLowerCase().includes(query));
      }),
    [all, hideStarted, query, nowSec],
  );
  const groups = useMemo(() => groupByCountry(shownFixtures), [shownFixtures]);
  // Games still to start come first, soonest first. Then time-to-be-confirmed games, then the ones already under way,
  // finished or off, by kick-off time.
  const byTime = useMemo(() => {
    const rank = (f: ScheduleFixture): number => {
      const p = phaseOf(f, nowSec);
      return p === "upcoming" ? 0 : p === "tbc" ? 1 : 2;
    };
    return [...shownFixtures].sort(
      (a, b) => rank(a) - rank(b) || a.timestamp - b.timestamp || a.league.localeCompare(b.league) || a.home.localeCompare(b.home),
    );
  }, [shownFixtures, nowSec]);

  const isOpen = (country: string, index: number) => open[country] ?? (query !== "" || index < OPEN_BY_DEFAULT);
  const allOpen = groups.length > 0 && groups.every((g, i) => isOpen(g.country, i));
  const setAll = (value: boolean) => setOpen(Object.fromEntries(groups.map((g) => [g.country, value])));

  const dayLabel = data ? ukDateLong.format(new Date(`${data.date}T12:00:00Z`)) : "";
  // "Updated 15:00", or "Updated 28 Sep, 15:00" when the list is from an earlier day.
  const pulled = data?.pulledAt ? new Date(data.pulledAt) : null;
  const updated = pulled
    ? ukDay.format(pulled) === ukDay.format(new Date(nowSec * 1000))
      ? ukTime.format(pulled)
      : `${ukDayShort.format(pulled)}, ${ukTime.format(pulled)}`
    : null;
  // Green if the list was refreshed in the last 24 hours, red if not.
  const fresh = pulled !== null && nowSec * 1000 - pulled.getTime() < FRESH_MS;

  return (
    <div className="space-y-4 px-4 py-4">
      <PageHeader
        title="Schedule"
        subtitle={dayLabel ?? undefined}
        actions={
          <Segmented
            label="Day"
            value={when}
            onChange={setWhen}
            options={[
              { value: "today", label: "Today" },
              { value: "tomorrow", label: "Tomorrow" },
            ]}
          />
        }
      />

      {error ? (
        <QueryError error={error} next="/schedule" />
      ) : isLoading || !data ? (
        <div className="space-y-2.5">
          <Skeleton className="h-24 w-full" />
          <ListSkeleton items={5} />
        </div>
      ) : !data.pull.configured && all.length === 0 ? (
        <EmptyState title="Schedule not set up yet" detail="Add the API-Football key on the engine to start the daily pull." />
      ) : all.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            title={data.pulledAt ? "No games listed" : "Not pulled yet"}
            detail={
              data.pull.lastError
                ? `The last pull failed: ${data.pull.lastError}`
                : data.pulledAt
                  ? "API-Football listed no games for this day."
                  : "Fixtures arrive at 06:00 and 15:00 UK time."
            }
          />
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-line bg-surface p-4">
            <p className="text-3xl font-medium tabular-nums tracking-tight text-ink">
              {summary.games} <span className="text-base font-normal text-ink-muted">games</span>
            </p>
            <p className="mt-0.5 text-sm text-ink">
              across <span className="font-medium tabular-nums">{summary.leagues}</span> leagues in{" "}
              <span className="font-medium tabular-nums">{summary.countries}</span> countries
            </p>
            {updated && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span
                  role="img"
                  aria-label={fresh ? "Updated in the last 24 hours" : "Not updated in the last 24 hours"}
                  title={fresh ? "Updated in the last 24 hours" : "Not updated in the last 24 hours"}
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${fresh ? "bg-hit" : "bg-danger"}`}
                />
                <span>
                  Updated {updated}
                  {data.pull.lastError && " · the latest refresh failed, showing the last good list"}
                </span>
              </p>
            )}
          </section>

          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Still to start" value={String(summary.toStart)} />
            <StatCard
              label="Next kick-off"
              value={summary.next ? kickoffTime(summary.next) : "–"}
              detail={summary.next ? summary.next.league : when === "today" ? "All under way" : undefined}
            />
            <StatCard label="Off / postponed" value={String(summary.off)} />
          </div>

          <div className="space-y-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team, league or country"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 text-ink">
                <input
                  type="checkbox"
                  checked={hideStarted}
                  onChange={(e) => setHideStarted(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                  className="h-3.5 w-3.5"
                />
                Only games still to start
              </label>
              {view === "country" && groups.length > 1 && (
                <button type="button" onClick={() => setAll(!allOpen)} className="text-ink-muted underline">
                  {allOpen ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>
            <Segmented
              label="Order"
              value={view}
              onChange={setView}
              options={[
                { value: "time", label: "By kick-off time" },
                { value: "country", label: "By country" },
              ]}
            />
          </div>

          {shownFixtures.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">No games match.</p>
          ) : view === "time" ? (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {byTime.map((f, i) => {
                const phase = phaseOf(f, nowSec);
                const previous = i > 0 ? byTime[i - 1] : undefined;
                const startsNewBlock = previous !== undefined && phaseOf(previous, nowSec) === "upcoming" && phase !== "upcoming";
                return (
                  <li key={f.id}>
                    {startsNewBlock && (
                      <p className="bg-surface-2 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                        Already started, finished or off
                      </p>
                    )}
                    <div className={`flex items-center gap-3 px-3 py-2 text-sm ${phase === "upcoming" ? "" : "opacity-60"}`}>
                      <span className="w-11 shrink-0 tabular-nums text-ink-muted">{phase === "tbc" ? "TBC" : kickoffTime(f)}</span>
                      <span className="min-w-0 flex-1 text-ink">
                        <span className="block truncate">
                          {f.home} <span className="text-ink-muted">v</span> {f.away}
                        </span>
                        <span className="block truncate text-[11px] text-ink-muted">
                          {f.league} · {f.country === "World" ? "International" : f.country}
                        </span>
                      </span>
                      <PhaseChip phase={phase} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">No games match.</p>
          ) : (
            <ul className="space-y-2">
              {groups.map((g, i) => {
                const expanded = isOpen(g.country, i);
                return (
                  <li key={g.country} className="overflow-hidden rounded-xl border border-line bg-surface">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen((o) => ({ ...o, [g.country]: !expanded }))}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">
                          {g.country === "World" ? "International" : g.country}
                        </span>
                        <span className="text-[11px] text-ink-muted">
                          {g.games} {g.games === 1 ? "game" : "games"} · {g.leagues.length}{" "}
                          {g.leagues.length === 1 ? "league" : "leagues"}
                        </span>
                      </span>
                      <ChevronDown
                        size={16}
                        className={`shrink-0 text-ink-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>

                    {expanded && (
                      <div className="border-t border-line">
                        {g.leagues.map((l) => (
                          <div key={l.key} className="px-3 py-2">
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{l.league}</p>
                            <ul className="divide-y divide-line">
                              {l.fixtures.map((f) => {
                                const phase = phaseOf(f, nowSec);
                                return (
                                  <li
                                    key={f.id}
                                    className={`flex items-center gap-3 py-1.5 text-sm ${phase === "upcoming" ? "" : "opacity-60"}`}
                                  >
                                    <span className="w-11 shrink-0 tabular-nums text-ink-muted">
                                      {phase === "tbc" ? "TBC" : kickoffTime(f)}
                                    </span>
                                    <span className="min-w-0 flex-1 text-ink">
                                      <span className="block truncate">{f.home}</span>
                                      <span className="block truncate">{f.away}</span>
                                    </span>
                                    <PhaseChip phase={phase} />
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-center text-[11px] text-ink-muted">
            Times are UK time. Refreshed at 06:00 and 15:00, not live scores.
          </p>
        </>
      )}
    </div>
  );
}