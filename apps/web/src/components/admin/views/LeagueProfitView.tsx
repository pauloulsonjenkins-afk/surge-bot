"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, PageHeader, Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { StrategyName } from "@/components/ui/StrategyName";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { useAdminLeagues } from "@/queries/use-leagues";
import { resolveLeague } from "@/lib/performance/leagues";
import { TIER_LABEL } from "@/domain/performance";
import { addTally, EMPTY_TALLY, judgeTally, useLeagueReturns, useSetLeagueBlock, type LeagueTally } from "@/queries/use-league-returns";
import type { LeagueModes, LeagueReturnRow } from "@/server/engine-client";
import { toneOf, signedPct } from "@/lib/format";

type Period = "ALL" | "30D" | "7D";
type Mode = "all" | "live" | "sim";
type Group = "league" | "country" | "tier";
type Sort = "picks" | "adjusted" | "roi";

const MILESTONES = [50, 100, 250, 500];

const VERDICT: Record<ReturnType<typeof judgeTally>["verdict"], { label: string; cls: string }> = {
  early: { label: "Too early", cls: "bg-surface-2 text-ink-muted" },
  unclear: { label: "Can't call yet", cls: "bg-surface-2 text-ink" },
  losing: { label: "Clearly losing", cls: "bg-loss/15 text-loss" },
  winning: { label: "Clearly making money", cls: "bg-hit/15 text-hit" },
};

function nextCheck(counted: number): string {
  const next = MILESTONES.find((m) => m > counted);
  return next ? `next check at ${next}` : "past 500";
}

/** Return, adjusted return, likely range and verdict for one group. */
function Figures({ t }: { t: LeagueTally }) {
  const j = judgeTally(t);
  const early = j.verdict === "early";
  return (
    <span className={`shrink-0 text-right ${early ? "opacity-70" : ""}`}>
      <span className={`block text-base font-semibold tabular-nums ${early ? "text-ink" : toneOf(j.roi)}`}>{signedPct(j.roi)}</span>
      <span className="block text-xs text-ink-muted">
        {j.adjusted !== null && `adjusted ${signedPct(j.adjusted)}`}
        {j.low !== null && j.high !== null && t.counted >= 10 && <span className="block">likely {signedPct(j.low)} to {signedPct(j.high)}</span>}
      </span>
      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT[j.verdict].cls}`}>{VERDICT[j.verdict].label}</span>
    </span>
  );
}

function RecordLine({ t }: { t: LeagueTally }) {
  return (
    <span className="text-xs text-ink-muted">
      <span className="text-hit">Won {t.won}</span> · <span className="text-loss">Lost {t.lost}</span> · {t.counted} priced · {nextCheck(t.counted)}
    </span>
  );
}

interface Row {
  id: string;
  name: string;
  sub?: string;
  t: LeagueTally;
  /** Single leagues only: the league and its strategies, for the grid. */
  league?: LeagueReturnRow;
}

/**
 * Leagues → Profit: is each league (or country, or tier) making money, and each strategy within it? Figures are priced
 * exactly as on Profit. Milestone notifications come at 50, 100, 250 and 500 priced picks. A strategy can be stopped in
 * a league once it has 100+ priced picks there; its picks there are then recorded in Sim instead, so it can be judged
 * and restarted.
 */
export default function LeagueProfitView() {
  const [period, setPeriod] = useState<Period>("ALL");
  const [mode, setMode] = useState<Mode>("all");
  const [group, setGroup] = useState<Group>("league");
  const [sort, setSort] = useState<Sort>("picks");
  const [strategy, setStrategy] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const since = period === "ALL" ? null : new Date(now - (period === "30D" ? 30 : 7) * 86_400_000).toISOString();
  const { data, isLoading, error } = useLeagueReturns(since);
  const leagues = useAdminLeagues();
  const names = useStrategyNames();
  const block = useSetLeagueBlock();
  const dialog = useDialog();
  const blockFrom = data?.blockFrom ?? 100;

  // Country and tier as the Leagues page shows them (catalogue, or the admin's own setting).
  const placeOf = useMemo(() => {
    const over = new Map((leagues.data ?? []).map((l) => [l.key, l]));
    return (l: LeagueReturnRow) => {
      const r = resolveLeague(l.league, l.country);
      const o = over.get(l.key);
      return { country: o?.countryOverride?.trim() || r.country, tier: o?.tierOverride ?? r.tier };
    };
  }, [leagues.data]);

  const tallyOf = (m: LeagueModes | undefined) => (m ? m[mode] : EMPTY_TALLY);
  const strategies = useMemo(() => {
    const s = new Set<string>();
    for (const l of data?.leagues ?? []) for (const k of Object.keys(l.byStrategy)) s.add(k);
    return [...s].sort((a, b) => names.name(a).localeCompare(names.name(b)));
  }, [data, names]);

  const rows: Row[] = useMemo(() => {
    const ls = data?.leagues ?? [];
    const pick = (l: LeagueReturnRow) => (strategy ? tallyOf(l.byStrategy[strategy]) : tallyOf(l.modes));
    let out: Row[];
    if (group === "league") {
      out = ls.map((l) => ({ id: l.key, name: l.league, sub: placeOf(l).country, t: pick(l), league: l }));
    } else {
      const by = new Map<string, Row>();
      for (const l of ls) {
        const p = placeOf(l);
        const id = group === "country" ? p.country : String(p.tier);
        const name = group === "country" ? p.country : p.tier === 0 ? "Tier not set" : `Tier ${p.tier} · ${TIER_LABEL[p.tier] ?? ""}`;
        const r = by.get(id) ?? { id, name, t: EMPTY_TALLY };
        r.t = addTally(r.t, pick(l));
        by.set(id, r);
      }
      out = [...by.values()];
    }
    out = out.filter((r) => r.t.picks > 0);
    const key = (r: Row) => (sort === "picks" ? r.t.counted : sort === "roi" ? (judgeTally(r.t).roi ?? -9) : (judgeTally(r.t).adjusted ?? -9));
    return out.sort((a, b) => key(b) - key(a) || b.t.picks - a.t.picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, group, mode, sort, strategy, placeOf]);

  const blocked = useMemo(() => {
    const out: Array<{ strategy: string; leagueKey: string; league: string; at: string }> = [];
    for (const [s, m] of Object.entries(data?.blocks ?? {})) for (const [k, v] of Object.entries(m)) out.push({ strategy: s, leagueKey: k, league: v.league, at: v.at });
    return out;
  }, [data]);

  const setBlock = async (s: string, l: { key: string; name: string }, on: boolean) => {
    const name = names.name(s);
    const ok = await dialog.confirm({
      title: on ? `Stop ${name} in ${l.name}?` : `Restart ${name} in ${l.name}?`,
      tone: "money",
      confirmLabel: on ? "Stop it there" : "Restart it there",
      body: on ? (
        <p>Its picks in {l.name} won&apos;t be bet any more. They&apos;re still recorded in Sim, so you can see whether stopping it was right and restart it here.</p>
      ) : (
        <p>Its picks in {l.name} will be bet again, like everywhere else.</p>
      ),
    });
    if (ok) block.mutate({ strategy: s, leagueKey: l.key, league: l.name, blocked: on });
  };

  const shown = showAll ? rows : rows.slice(0, 40);

  return (
    <div className="space-y-4">
      <PageHeader
        as="h2"
        title="Profit by league"
        subtitle={
          <>
            Is each league making money, and each strategy within it? Priced exactly as on Profit. A league showing a loss after a few dozen picks
            is usually just unlucky: with hundreds of leagues, some will look awful by chance. So nothing is called <b>clearly losing</b> until
            the whole likely range is below zero, and you get a notification as a league, country or strategy-in-a-league reaches 50, 100, 250
            and 500 priced picks. Tap a league to see each strategy in it; one losing clearly over {blockFrom}+ picks can be stopped there.
          </>
        }
      />

      {blocked.length > 0 && (
        <Card title="Stopped in a league" subtitle="Not bet there; their picks there are recorded in Sim, so you can check the call.">
          <ul className="space-y-2 text-sm">
            {blocked.map((b) => (
              <li key={`${b.strategy}@${b.leagueKey}`} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <StrategyName label={b.strategy} /> <span className="text-ink-muted">in {b.league}</span>
                </span>
                <button type="button" disabled={block.isPending} onClick={() => void setBlock(b.strategy, { key: b.leagueKey, name: b.league }, false)} className="rounded-md border border-line px-3 py-1 text-xs font-medium text-ink disabled:opacity-50">
                  Restart
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: "ALL", label: "All" }, { value: "30D", label: "30D" }, { value: "7D", label: "7D" }]} />
        <Segmented label="Live or Sim" value={mode} onChange={setMode} options={[{ value: "all", label: "Live + Sim" }, { value: "live", label: "Live" }, { value: "sim", label: "Sim" }]} />
        <Segmented label="Group by" value={group} onChange={(g) => { setGroup(g); setOpen(null); }} options={[{ value: "league", label: "League" }, { value: "country", label: "Country" }, { value: "tier", label: "Tier" }]} />
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          Strategy
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink">
            <option value="">All strategies</option>
            {strategies.map((s) => (
              <option key={s} value={s}>
                {names.name(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink">
            <option value="picks">Most picks</option>
            <option value="adjusted">Adjusted return</option>
            <option value="roi">Return</option>
          </select>
        </label>
      </div>
      {mode === "all" && <p className="text-xs text-ink-muted">Live + Sim: every pick counts, bet or simulated, so leagues build up a record faster.</p>}

      {error ? (
        <QueryError error={error} next="/more/admin/leagues?tab=profit" />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No settled picks for this choice yet.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {shown.map((r) => {
              const isOpen = open === r.id && !!r.league;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={!r.league}
                    aria-expanded={r.league ? isOpen : undefined}
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    className="flex w-full items-start justify-between gap-3 px-1 py-2.5 text-left disabled:cursor-default"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        {r.name}
                        {r.league && <ChevronDown size={14} aria-hidden className={`text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />}
                      </span>
                      {r.sub && <span className="block text-xs text-ink-muted">{r.sub}</span>}
                      <span className="block">
                        <RecordLine t={r.t} />
                      </span>
                    </span>
                    <Figures t={r.t} />
                  </button>
                  {isOpen && r.league && (
                    <div className="mb-3 rounded-lg bg-surface-2 p-2.5">
                      <p className="mb-1 text-xs font-medium text-ink">Each strategy in {r.name}</p>
                      <ul className="divide-y divide-line">
                        {Object.entries(r.league.byStrategy)
                          .map(([s, m]) => ({ s, t: m[mode] }))
                          .filter((x) => x.t.picks > 0)
                          .sort((a, b) => b.t.counted - a.t.counted)
                          .map(({ s, t }) => {
                            const isBlocked = !!data.blocks[s]?.[r.league!.key];
                            const allTime = r.league!.byStrategy[s]!.all;
                            const canStop = isBlocked || (period === "ALL" && allTime.counted >= blockFrom);
                            const lg = { key: r.league!.key, name: r.sub && r.sub !== "Other" ? `${r.name} (${r.sub})` : r.name };
                            return (
                              <li key={s} className="flex items-start justify-between gap-3 py-2">
                                <span className="min-w-0 text-sm">
                                  <StrategyName label={s} />
                                  {isBlocked && <span className="ml-1.5 rounded-full bg-warn px-2 py-0.5 text-xs font-medium text-warn-ink">Stopped here</span>}
                                  <span className="block">
                                    <RecordLine t={t} />
                                  </span>
                                  {canStop && (
                                    <button
                                      type="button"
                                      disabled={block.isPending}
                                      onClick={() => void setBlock(s, lg, !isBlocked)}
                                      className="mt-1 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink disabled:opacity-50"
                                    >
                                      {isBlocked ? "Restart it here" : "Stop it here"}
                                    </button>
                                  )}
                                </span>
                                <Figures t={t} />
                              </li>
                            );
                          })}
                      </ul>
                      {block.error && <p className="mt-1 text-xs text-destructive">{block.error.message}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length > shown.length && (
            <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-xs font-medium text-accent">
              Show all {rows.length}
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
