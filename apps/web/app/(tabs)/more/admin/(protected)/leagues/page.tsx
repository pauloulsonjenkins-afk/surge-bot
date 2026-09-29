"use client";

import { useMemo, useState } from "react";
import { useAdminLeagues, useUpdateLeague, type AdminLeagueRow } from "@/queries/use-leagues";
import { resolveLeague } from "@/lib/performance/leagues";
import { LEAGUE_CATALOGUE, TIER_LABEL } from "@/domain/performance";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";

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
  onChange: (patch: { hidden?: boolean; reset?: boolean; country?: string | null; tier?: number | null }) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const shown = effective(row);
  const [country, setCountry] = useState(row.countryOverride ?? "");
  const [tier, setTier] = useState(row.tierOverride === null ? "auto" : String(row.tierOverride));

  const settled = row.hits + row.misses;
  const rate = settled > 0 ? `${Math.round((row.hits / settled) * 100)}%` : "–";
  const tierText = shown.tier === 0 ? "Tier not set" : `Tier ${shown.tier} · ${TIER_LABEL[shown.tier] ?? ""}`;
  const hasOverride = row.countryOverride !== null || row.tierOverride !== null;

  return (
    <li className={`rounded-xl border border-line bg-surface p-3 ${row.hidden ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{row.league}</p>
          <p className="text-xs text-ink-muted">
            {shown.country === "Other" ? "No country" : shown.country} · {tierText}
            {hasOverride && " · edited"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums text-ink">{rate}</p>
          <p className="text-[11px] text-ink-muted">
            {row.alerts} alerts · {settled} settled
          </p>
        </div>
      </div>

      {(row.hidden || row.resetAt) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {row.hidden && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Hidden from dashboard</span>}
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
          {row.hidden ? "Show on dashboard" : "Hide from dashboard"}
        </button>

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
    </li>
  );
}

export default function LeaguesPage() {
  const { data, isLoading, error } = useAdminLeagues();
  const update = useUpdateLeague();
  const [filter, setFilter] = useState<Filter>("all");
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
      if (filter === "shown" && r.hidden) return false;
      if (filter === "hidden" && !r.hidden) return false;
      if (!q) return true;
      return r.league.toLowerCase().includes(q) || effective(r).country.toLowerCase().includes(q);
    });
  }, [data, filter, search]);

  const hiddenCount = (data ?? []).filter((r) => r.hidden).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium tracking-tight text-ink">Leagues</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Every league the Dashboard has seen. Hiding or resetting a league changes what the Dashboard counts and never
          deletes any alerts, so both can be undone. Win/loss figures are not affected.
        </p>
      </div>

      {error ? (
        <QueryError error={error} next="/more/admin/leagues" />
      ) : (
        <>
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
                  ["hidden", `Hidden (${hiddenCount})`],
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
