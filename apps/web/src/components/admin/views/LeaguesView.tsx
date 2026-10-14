"use client";

import { PageHeader } from "@/components/ui/Card";
import { useMemo, useState } from "react";
import { useAdminLeagues, useUpdateLeague, type AdminLeagueRow } from "@/queries/use-leagues";
import { resolveLeague } from "@/lib/performance/leagues";
import { LEAGUE_CATALOGUE, TIER_LABEL } from "@/domain/performance";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { BetfairCoverage } from "@/components/admin/BetfairCoverage";
import { LeagueReview } from "@/components/admin/LeagueReview";

type Filter = "all" | "shown" | "hidden";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function effective(row: AdminLeagueRow): { country: string; tier: number } {
  const r = resolveLeague(row.league, row.country);
  return { country: row.countryOverride?.trim() || r.country, tier: row.tierOverride ?? r.tier };
}

function LeagueCard({
  row,
  countries,
  busy,
  onChange,
}: {
  row: AdminLeagueRow;
  countries: string[];
  busy: boolean;
  onChange: (patch: { hidden?: boolean; reset?: boolean; country?: string | null; tier?: number | null; noSend?: boolean }) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const shown = effective(row);
  const [country, setCountry] = useState(row.countryOverride ?? "");
  const [tier, setTier] = useState(row.tierOverride === null ? "auto" : String(row.tierOverride));

  const settled = row.hits + row.misses;
  const rate = settled > 0 ? `${Math.round((row.hits / settled) * 100)}%` : "–";
  const tierText = shown.tier === 0 ? "Tier not set" : `Tier ${shown.tier} · ${TIER_LABEL[shown.tier] ?? ""}`;
  const hasOverride = row.countryOverride !== null || row.tierOverride !== null;

  return (
    <li className={`card-hover rounded-xl border border-line p-3 transition-colors ${open ? "card-open" : "bg-surface"} ${row.hidden ? "opacity-70" : ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`mt-0.5 shrink-0 text-xs text-ink-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            ▸
          </span>
          <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{row.league}</p>
          <p className="text-xs text-ink-muted">
            {shown.country === "Other" ? "No country" : shown.country} · {tierText}
            {hasOverride && " · edited"}
            {row.hidden && " · hidden"}
            {row.resetAt && " · reset"}
          </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums text-ink">{rate}</p>
          <p className="text-xs text-ink-muted">
            {row.alerts} alerts · {settled} settled
          </p>
        </div>
      </button>

      {open && (
      <>
      {(row.hidden || row.resetAt || row.noSend) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {row.hidden && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Hidden from stats</span>}
          {row.noSend && <span className="rounded-full bg-loss/15 px-2 py-0.5 text-loss">Not sent: not on Betfair</span>}
          {row.resetAt && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">
              Counting from {shortDate(row.resetAt)} · {row.earlierAlerts} earlier kept
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onChange({ hidden: !row.hidden })}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
        >
          {row.hidden ? "Show in stats" : "Hide from stats"}
        </button>

        {!row.noSend && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange({ noSend: true, hidden: true })}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-loss hover:bg-surface-2 disabled:opacity-50"
          >
            Stop: not on Betfair
          </button>
        )}

        {!confirming ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            Reset stats
          </button>
        ) : (
          <span className="flex items-center gap-1.5 rounded-md border border-accent px-2 py-1 text-xs text-ink">
            Start counting from now?
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onChange({ reset: true });
                setConfirming(false);
              }}
              className="rounded bg-accent px-2 py-0.5 font-medium text-accent-ink disabled:opacity-50"
            >
              Yes, reset
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="text-ink-muted underline">
              Cancel
            </button>
          </span>
        )}

        {row.resetAt && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange({ reset: false })}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            Undo reset
          </button>
        )}

        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-muted hover:text-ink"
        >
          {editing ? "Close" : "Edit country / tier"}
        </button>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 rounded-lg bg-surface-2 p-2.5">
          <label className="block text-xs text-ink-muted">
            Country
            <input
              list="league-countries"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder={shown.country === "Other" ? "e.g. Argentina" : shown.country}
              className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
            <datalist id="league-countries">
              {countries.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block text-xs text-ink-muted">
            Tier
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="auto">Automatic</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  Tier {n}
                  {TIER_LABEL[n] ? ` · ${TIER_LABEL[n]}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onChange({ country: country.trim() || null, tier: tier === "auto" ? null : Number(tier) });
                setEditing(false);
              }}
              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
            >
              Save
            </button>
            {hasOverride && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCountry("");
                  setTier("auto");
                  onChange({ country: null, tier: null });
                  setEditing(false);
                }}
                className="rounded-md border border-line px-3 py-1 text-xs font-medium text-ink-muted hover:text-ink"
              >
                Clear edits
              </button>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </li>
  );
}

export default function LeaguesPage() {
  const { data, isLoading, error } = useAdminLeagues();
  const update = useUpdateLeague();
  // Hidden leagues (e.g. not on Betfair) are cleared from the list unless asked for.
  const [filter, setFilter] = useState<Filter>("shown");
  const [search, setSearch] = useState("");

  const countries = useMemo(() => {
    const set = new Set<string>(LEAGUE_CATALOGUE.map((l) => l.country));
    for (const r of data ?? []) set.add(effective(r).country);
    set.delete("Other");
    return [...set].sort();
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (filter === "shown" && (r.hidden || r.noSend)) return false;
      if (filter === "hidden" && !(r.hidden || r.noSend)) return false;
      if (!q) return true;
      return r.league.toLowerCase().includes(q) || effective(r).country.toLowerCase().includes(q);
    });
  }, [data, filter, search]);

  const hiddenCount = (data ?? []).filter((r) => r.hidden || r.noSend).length;

  return (
    <div className="space-y-4">
      <PageHeader
        as="h2"
        title="Leagues"
        subtitle={
          <>
          Every league the Dashboard has seen. The top of the page is for leagues whose matches aren’t on Betfair: stop them, then remove them
          from your InPlayGuru league filter. Tap a league below to hide it, reset its stats or set its country and tier. Nothing is deleted, so
          all of it can be undone. A hidden league leaves every stats page, except bets with real money on them, which always count.
          </>
        }
      />

      {error ? (
        <QueryError error={error} next="/more/admin/leagues" />
      ) : (
        <>
          {data && <LeagueReview rows={data} busy={update.isPending} onChange={(key, patch) => update.mutate({ key, patch })} />}
          <details className="rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer px-3.5 py-3 text-sm font-medium text-ink">
              Check leagues against Betfair <span className="text-xs font-normal text-ink-muted">· your alert leagues, or paste a list</span>
            </summary>
            <div className="px-1 pb-1">
              <BetfairCoverage />
            </div>
          </details>
          <div className="space-y-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leagues or countries"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <div className="flex gap-1.5 text-xs">
              {(
                [
                  ["all", `All (${data?.length ?? 0})`],
                  ["shown", `Shown (${(data?.length ?? 0) - hiddenCount})`],
                  ["hidden", `Hidden and stopped (${hiddenCount})`],
                ] as Array<[Filter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`rounded-full px-3 py-1 font-medium ${
                    filter === value ? "bg-accent text-accent-ink" : "border border-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {update.error && (
            <p className="rounded-md border border-line bg-surface p-2 text-xs text-ink">
              Could not save that change: {update.error.message}
            </p>
          )}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {(data?.length ?? 0) === 0 ? "Leagues appear here once alerts arrive." : "No leagues match."}
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <LeagueCard
                  key={r.key}
                  row={r}
                  countries={countries}
                  busy={update.isPending}
                  onChange={(patch) => update.mutate({ key: r.key, patch })}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
