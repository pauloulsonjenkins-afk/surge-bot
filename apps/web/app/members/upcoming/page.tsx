"use client";

import Link from "next/link";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMembersAction, useMembersMe, useMembersUpcoming } from "@/queries/use-members";
import { btnPrimary, LockedFeature, ModeBadge, odds, when } from "@/components/members/ui";

/**
 * Opportunities now: alerts that can still be bet (in-play ones for a few minutes after they fire; pre-match ones until
 * kick-off) and recent ones awaiting a result. Most strategies fire in-play, so there is no long schedule in advance.
 */
export default function UpcomingPage() {
  const me = useMembersMe();
  const { data, isLoading } = useMembersUpcoming();
  const simulate = useMembersAction<{ pickId: number }>("simulate");
  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;
  const live = data.open.filter((p) => p.state === "live");
  const waiting = data.open.filter((p) => p.state === "waiting");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Upcoming opportunities"
        subtitle="In-play strategies fire as matches unfold, so opportunities appear here live and stay bettable for a few minutes. Pre-match picks stay open until kick-off."
      />
      <Card title="Bettable now" subtitle="Refreshes every 15 seconds.">
        {live.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing bettable right now for your strategies.</p>
        ) : (
          <ul className="divide-y divide-line">
            {live.map((p) => (
              <li key={p.id} id={`pick-${p.id}`} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {p.home} v {p.away}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {p.strategyName} · {p.competition}
                    {p.minute !== null ? ` · ${p.minute}'` : ""}
                    {p.score ? ` · ${p.score}` : ""}
                    {p.kickoffAt ? ` · kick-off about ${when(p.kickoffAt)}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    {p.market}
                    {p.selection ? ` · ${p.selection}` : ""} · <strong>{odds(p.odds)}</strong>
                  </p>
                  <p className="text-xs text-ink-muted">Bettable until {when(p.betableUntil)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p.simulated && <ModeBadge mode="sim" />}
                  {p.live && <span className="text-xs text-ink-muted">Live: {p.live}</span>}
                  {p.canSimulate && (
                    <button type="button" className={btnPrimary} disabled={simulate.isPending} onClick={() => simulate.mutate({ pickId: p.id })}>
                      Simulate bet
                    </button>
                  )}
                  <Link href={`/members/strategies/${encodeURIComponent(p.strategyKey)}`} className="text-xs text-accent">
                    View strategy
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        {simulate.error && <p className="mt-2 text-sm text-destructive">{simulate.error.message}</p>}
      </Card>

      {waiting.length > 0 && (
        <Card title="Waiting for a result">
          <ul className="divide-y divide-line">
            {waiting.map((p) => (
              <li key={p.id} className="py-2 text-sm">
                <span className="text-ink">
                  {p.home} v {p.away}
                </span>
                <span className="block text-xs text-ink-muted">
                  {p.strategyName} · {p.market} · {odds(p.odds)} · {when(p.at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.locked.length > 0 && (
        <>
          <Card title="Other strategies firing now">
            <ul className="space-y-1 text-sm">
              {data.locked.map((l) => (
                <li key={l.strategyKey} className="flex justify-between">
                  <span className="text-ink">{l.strategyName}</span>
                  <span className="text-ink-muted">
                    {l.live} bettable · {l.waiting} awaiting result
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <LockedFeature me={me.data} feature="upcoming" title="See exactly which games qualify" pitch="Members see the match, market and price for every opportunity the moment it fires, and can simulate or bet it." />
        </>
      )}
    </div>
  );
}
