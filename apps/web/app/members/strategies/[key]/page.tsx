"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Card, moneyTone } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { useMembersMe, useMembersStrategy } from "@/queries/use-members";
import FollowControl from "@/components/members/FollowControl";
import { LockedFeature, odds, pct, Tile, when, WinLossText } from "@/components/members/ui";

export default function StrategyPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const me = useMembersMe();
  const { data, isLoading, error } = useMembersStrategy(decodeURIComponent(key));
  if (error) return <p className="text-sm text-ink-muted">That strategy isn&apos;t available.</p>;
  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;
  const s = data.strategy;
  const max = Math.max(1, ...s.daily.map((d) => d.wins + d.losses));
  return (
    <div className="space-y-5">
      <Link href="/members/strategies" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
        <ArrowLeft size={14} /> House strategies
      </Link>
      <PageHeader title={s.name} subtitle={s.type === "pre-match" ? "Pre-match strategy" : "In-play strategy"} actions={<FollowControl s={s} />} />

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Today" value={pct(s.results.today.hitRate)} sub={`${s.results.today.wins}W / ${s.results.today.losses}L`} />
        <Tile label="This week" value={pct(s.results.week.hitRate)} sub={`${s.results.week.wins}W / ${s.results.week.losses}L`} />
        <Tile label="30 days" value={pct(s.results.last30.hitRate)} sub={`${s.results.last30.wins}W / ${s.results.last30.losses}L · about ${s.results.perWeek} a week`} />
      </div>

      <Card title="Last 30 days" subtitle="Settled alerts per day: wins (green) and losses (red).">
        <div className="flex h-28 items-end gap-0.5" role="img" aria-label="Daily wins and losses over 30 days">
          {s.daily.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col justify-end" title={`${d.date}: ${d.wins} won, ${d.losses} lost`}>
              <div className="bg-loss/80" style={{ height: `${(d.losses / max) * 100}%` }} />
              <div className="bg-hit/80" style={{ height: `${(d.wins / max) * 100}%` }} />
            </div>
          ))}
        </div>
      </Card>

      {s.locked ? (
        <LockedFeature me={me.data} feature="strategy_details" title="How this strategy works" pitch="The situation it looks for, the bet it makes, and the full record in pounds." />
      ) : (
        <Card title="How it works">
          <p className="text-sm text-ink">{s.description}</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-ink-muted">Triggers when</dt>
              <dd className="text-ink">{s.trigger}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">The bet</dt>
              <dd className="text-ink">{s.bet}</dd>
            </div>
          </dl>
        </Card>
      )}

      {s.money && (
        <Card title="House record in pounds" subtitle="£10 on every alert at its recorded price, after commission.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Profit (all time)" value={gbp(s.money.all.profit)} tone={moneyTone(s.money.all.profit)} sub={`${s.money.all.priced} bets`} />
            <Tile label="ROI" value={pct(s.money.all.roi, true)} />
            <Tile label="Average odds" value={odds(s.money.all.avgOdds)} />
            <Tile label="Worst drawdown" value={gbp(-s.money.all.maxDrawdown)} tone="loss" sub={`longest losing run ${s.money.all.longestLosingRun}`} />
          </div>
        </Card>
      )}

      {s.recent ? (
        <Card title="Recent selections" subtitle="The last two weeks of this strategy's alerts.">
          {s.recent.length === 0 ? (
            <p className="text-sm text-ink-muted">No alerts in the last two weeks.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.recent.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block text-ink">
                      {p.home} v {p.away}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {when(p.at)} · {p.competition} · {p.minute !== null ? `${p.minute}' ` : ""}
                      {p.score ?? ""} · {p.market}
                      {p.selection ? ` · ${p.selection}` : ""} · {odds(p.odds)}
                    </span>
                  </span>
                  <span className={`shrink-0 text-xs font-medium ${p.result === "hit" ? "text-hit" : p.result === "miss" ? "text-loss" : "text-ink-muted"}`}>
                    {p.result === "hit" ? "Won" : p.result === "miss" ? "Lost" : p.state === "void" ? "Void" : p.state === "live" ? "Live" : "Waiting"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <LockedFeature me={me.data} feature="strategy_selections" title="Qualifying selections" pitch="See exactly which games this strategy picked, the market and the price." />
      )}
    </div>
  );
}
