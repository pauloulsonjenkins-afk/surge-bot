"use client";

import Link from "next/link";
import { PencilLine } from "lucide-react";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ModeBadge } from "@/components/ui/ModeToggle";
import { betText } from "@/lib/markets";
import { gbp } from "@/lib/format";
import { useMe } from "@/queries/use-me";
import { useAdminLivePicks, useLivePicks, type LivePick, type PublicPick } from "@/queries/use-live";
import { useStrategyNames } from "@/queries/use-strategy-names";

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

function PickRow({ pick, admin }: { pick: Row; admin: boolean }) {
  const hit = pick.result === "hit";
  const strategyNames = useStrategyNames();
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="truncate">
            {pick.home ?? "Unknown"} <span className="text-ink-muted">v</span> {pick.away ?? "Unknown"}
          </span>
          {admin && <ModeBadge mode={modeOf(pick)} />}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {[strategyNames.name(pick.strategy), betText(pick.market, pick.selection)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {admin && pick.pnl && pick.pnl.placement !== "notPlaced" ? (
          <p className={`text-sm font-semibold tabular-nums ${moneyTone(pick.pnl.profit)}`}>{gbp(pick.pnl.profit)}</p>
        ) : (
          <p className={`text-sm font-semibold ${hit ? "text-hit" : "text-loss"}`}>{hit ? "Hit" : "Miss"}</p>
        )}
        <p className="text-xs tabular-nums text-ink-muted">
          {admin && pick.pnl && pick.pnl.placement !== "notPlaced" ? `${hit ? "Hit" : "Miss"} · ` : ""}
          {admin && pick.pnl?.real ? "Betfair · " : ""}
          {admin && pick.pnl?.assumed ? <span className="text-warn">assumed odds · </span> : ""}
          {pick.ftScore ?? "–"}
          {pick.resultOverridden && " · amended"}
        </p>
      </div>
    </li>
  );
}

export default function TradeLogPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const admin = me?.admin === true;
  // The admin's list carries each pick's stake and profit; everyone else gets the public list.
  const pub = useLivePicks(200, !meLoading && !admin);
  const adm = useAdminLivePicks(200, admin);
  const { data, isLoading, error } = admin ? adm : pub;

  if (meLoading || isLoading) return <ListSkeleton />;

  const settled = ((data ?? []) as Row[]).filter((p) => !p.excluded && (p.result === "hit" || p.result === "miss"));

  // Group by UK day, newest first (the list already arrives newest first).
  const groups: Array<{ day: string; picks: Row[]; hits: number; profit: number; priced: number }> = [];
  for (const p of settled) {
    const day = dayFmt.format(new Date(p.firstSeenAt));
    let last = groups[groups.length - 1];
    if (!last || last.day !== day) {
      last = { day, picks: [], hits: 0, profit: 0, priced: 0 };
      groups.push(last);
    }
    last.picks.push(p);
    if (p.result === "hit") last.hits += 1;
    if (p.pnl && p.pnl.placement !== "notPlaced") {
      last.profit += p.pnl.profit;
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

      {error ? (
        <QueryError error={error} next="/trade-log" />
      ) : settled.length === 0 ? (
        <EmptyState title="No settled picks yet" detail="Results appear here once matches finish." />
      ) : (
        groups.map((g) => {
          const misses = g.picks.length - g.hits;
          const profit = Math.round(g.profit * 100) / 100;
          return (
            <section key={g.day} className="space-y-3">
              <h2 className="flex items-baseline justify-between gap-3 text-base font-semibold text-ink">
                {g.day}
                <span className="text-xs font-medium tabular-nums">
                  <span className="text-hit">{g.hits}</span>
                  <span className="text-ink-muted"> – </span>
                  <span className="text-loss">{misses}</span>
                  <span className="text-ink-muted"> · {Math.round((g.hits / g.picks.length) * 100)}%</span>
                  {admin && g.priced > 0 && <span className={moneyTone(profit)}> · {gbp(profit)}</span>}
                </span>
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {g.picks.map((p) => (
                  <PickRow key={p.id} pick={p} admin={admin} />
                ))}
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
