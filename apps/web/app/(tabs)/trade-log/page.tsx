"use client";

import { useState } from "react";
import Link from "next/link";
import { PencilLine } from "lucide-react";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ModeBadge, ModeToggle, usePickMode } from "@/components/ui/ModeToggle";
import { betText } from "@/lib/markets";
import { gbp } from "@/lib/format";
import { useMe } from "@/queries/use-me";
import { useAdminLivePicks, useLivePicks, type LivePick, type PublicPick } from "@/queries/use-live";
import { strategyKey, useStrategyNames } from "@/queries/use-strategy-names";

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });

/** A pick as this page shows it. Money and the Live / Sim tag are only there for the admin. */
type Row = PublicPick & { pnl?: LivePick["pnl"]; excluded?: boolean };

const moneyTone = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink-muted");

/** Live = money was staked; Not placed = sent but never bet; Sim = never sent. An older engine only says whether it was sent. */
function modeOf(pick: Row): "live" | "sim" | "notPlaced" {
  const placement = pick.pnl?.placement;
  if (placement === "notPlaced") return "notPlaced";
  if (placement === "sim") return "sim";
  if (placement) return "live";
  return pick.sentAt ? "live" : "sim";
}

/** Money the admin can count for a pick: priced, and not a pick that was sent but never placed. */
const priced = (p: Row) => (p.pnl && p.pnl.placement !== "notPlaced" ? p.pnl : null);

/** Alerts for the same match share a key, whichever strategy sent them (as on Live). */
const matchKey = (p: Row) => `${(p.home ?? "?").toLowerCase().trim()}|${(p.away ?? "?").toLowerCase().trim()}`;

/** One pick under its match: the strategy and bet on the left; the money (admin) or the result on the right. */
function PickLine({ pick, admin }: { pick: Row; admin: boolean }) {
  const hit = pick.result === "hit";
  const strategyNames = useStrategyNames();
  const money = admin ? priced(pick) : null;
  const mode = modeOf(pick);
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink">
          <span className="min-w-0 truncate">{strategyNames.name(pick.strategy)}</span>
          {admin && mode !== "live" && <ModeBadge mode={mode} />}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">{betText(pick.market, pick.selection) ?? "No market set"}</p>
      </div>
      <div className="shrink-0 text-right">
        {admin ? (
          <p className={`text-sm font-semibold tabular-nums ${money ? moneyTone(money.profit) : "text-ink-muted"}`}>{money ? gbp(money.profit) : "–"}</p>
        ) : null}
        <p className={`text-xs font-medium ${admin ? "" : "text-sm font-semibold"} ${hit ? "text-hit" : "text-loss"}`}>
          {hit ? "Hit" : "Miss"}
          <span className="font-normal text-ink-muted">
            {admin && money?.real ? " · Betfair" : ""}
            {pick.resultOverridden ? " · amended" : ""}
          </span>
          {admin && money?.assumed ? <span className="font-normal text-warn"> · assumed odds</span> : null}
        </p>
      </div>
    </li>
  );
}

export default function TradeLogPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const admin = me?.admin === true;
  const mode = usePickMode();
  const strategyNames = useStrategyNames();
  const [strategy, setStrategy] = useState<string>("");
  // The admin's list carries each pick's stake and profit; everyone else gets the public list.
  const pub = useLivePicks(200, !meLoading && !admin);
  const adm = useAdminLivePicks(200, admin);
  const { data, isLoading, error } = admin ? adm : pub;

  if (meLoading || isLoading) return <ListSkeleton />;

  const settledAll = ((data ?? []) as Row[]).filter((p) => !p.excluded && (p.result === "hit" || p.result === "miss"));
  // Live / Sim / All follows the switch shared with the Dashboard (Live = money was staked, as there).
  const inMode = settledAll.filter((p) => !admin || mode === "all" || modeOf(p) === mode);
  const strategies = [...new Map(inMode.map((p) => [strategyKey(p.strategy), p.strategy])).entries()].sort((a, b) =>
    strategyNames.name(a[1]).localeCompare(strategyNames.name(b[1])),
  );
  const settled = strategy ? inMode.filter((p) => strategyKey(p.strategy) === strategy) : inMode;

  // Group by UK day, newest first (the list already arrives newest first), then by match within the day.
  const groups: Array<{ day: string; matches: Map<string, Row[]>; hits: number; picks: number; profit: number; priced: number }> = [];
  for (const p of settled) {
    const day = dayFmt.format(new Date(p.firstSeenAt));
    let last = groups[groups.length - 1];
    if (!last || last.day !== day) {
      last = { day, matches: new Map(), hits: 0, picks: 0, profit: 0, priced: 0 };
      groups.push(last);
    }
    const key = matchKey(p);
    (last.matches.get(key) ?? last.matches.set(key, []).get(key)!).push(p);
    last.picks += 1;
    if (p.result === "hit") last.hits += 1;
    const money = priced(p);
    if (money) {
      last.profit += money.profit;
      last.priced += 1;
    }
  }

  return (
    <div className="space-y-6 px-4 py-4">
      <PageHeader
        title="Trade Log"
        subtitle={admin ? "Every settled pick with its profit, most recent first" : "Every settled pick, most recent first"}
        actions={
          admin ? (
            <Link
              href="/more/admin/results"
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink"
            >
              <PencilLine size={14} />
              Amend results
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ModeToggle />
        {strategies.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="sr-only">Strategy</span>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink"
            >
              <option value="">All strategies</option>
              {strategies.map(([key, raw]) => (
                <option key={key} value={key}>
                  {strategyNames.name(raw)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error ? (
        <QueryError error={error} next="/trade-log" />
      ) : settled.length === 0 ? (
        <EmptyState
          title={settledAll.length === 0 ? "No settled picks yet" : "Nothing settled for this choice"}
          detail={settledAll.length === 0 ? "Results appear here once matches finish." : "Try All, or another strategy."}
        />
      ) : (
        groups.map((g) => {
          const misses = g.picks - g.hits;
          const profit = Math.round(g.profit * 100) / 100;
          const showMoney = admin && g.priced > 0;
          return (
            <section key={g.day} className="space-y-3">
              {/* The day's money is the figure to read first; the record sits under it. */}
              <header className="flex items-end justify-between gap-3">
                <h2 className="text-base font-semibold text-ink">{g.day}</h2>
                <div className="text-right">
                  {showMoney && (
                    <p className={`font-display text-xl font-bold tabular-nums [font-stretch:108%] ${moneyTone(profit)}`}>{gbp(profit)}</p>
                  )}
                  <p className={`tabular-nums ${showMoney ? "text-xs" : "text-sm font-medium"}`}>
                    <span className="text-hit">{g.hits}</span>
                    <span className="text-ink-muted">–</span>
                    <span className="text-loss">{misses}</span>
                    <span className="text-ink-muted"> · {Math.round((g.hits / g.picks) * 100)}% hit rate</span>
                  </p>
                </div>
              </header>
              <ul className="space-y-3">
                {[...g.matches.values()].map((picks) => {
                  const first = picks[0]!;
                  return (
                    <li key={`${g.day}:${matchKey(first)}`} className="overflow-hidden rounded-xl border border-line bg-surface">
                      <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-2/40 px-3 py-2">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-ink">
                            {first.home ?? "Unknown"} <span className="font-normal text-ink-muted">v</span> {first.away ?? "Unknown"}
                          </p>
                          {first.competition && <p className="truncate text-xs text-ink-muted">{first.competition}</p>}
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{first.ftScore ?? "–"}</span>
                      </div>
                      <ul className="divide-y divide-line">
                        {picks.map((p) => (
                          <PickLine key={p.id} pick={p} admin={admin} />
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {admin && (
        <p className="text-center text-xs text-ink-muted">
          Live bets matched on Betfair (marked “Betfair”) show the real stake and profit; other figures are estimated from the
          alert’s odds, as on Win/Loss. Sim picks show what the bet would have made. Not placed: sent to your betting
          software but never bet, so nothing was staked.
        </p>
      )}
    </div>
  );
}
