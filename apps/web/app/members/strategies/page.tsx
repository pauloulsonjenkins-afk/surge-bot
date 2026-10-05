"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { useMembersMe, useMembersStrategies } from "@/queries/use-members";
import FollowControl from "@/components/members/FollowControl";
import { pct, TrialCountdown, WinLossText } from "@/components/members/ui";

/** House strategies: results for everyone; detail and money figures where the membership covers them. */
export default function StrategiesPage() {
  const me = useMembersMe();
  const { data, isLoading } = useMembersStrategies();
  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-5">
      <PageHeader title="House strategies" subtitle="The official GoalBrew strategies. Results are worked out from every alert's real result; this is the house record, not yours." />
      <TrialCountdown me={me.data} />
      <ul className="grid gap-3 md:grid-cols-2">
        {data.strategies.map((s) => (
          <li key={s.key} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/members/strategies/${encodeURIComponent(s.key)}`} className="text-base font-semibold text-ink hover:underline">
                  {s.name}
                </Link>
                <p className="text-xs text-ink-muted">
                  {s.type === "pre-match" ? "Pre-match" : "In-play"}
                  {s.trialSelected && " · in your trial"}
                  {s.locked && (
                    <span className="ml-1 inline-flex items-center gap-0.5">
                      · <Lock size={11} aria-hidden /> details for members
                    </span>
                  )}
                </p>
              </div>
              <FollowControl s={s} />
            </div>
            {!s.locked && s.description && <p className="mt-2 text-sm text-ink-muted">{s.description}</p>}
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-ink-muted">Today</dt>
                <dd>
                  <WinLossText wl={s.results.today} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">This week</dt>
                <dd>
                  <WinLossText wl={s.results.week} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">30 days</dt>
                <dd>
                  <WinLossText wl={s.results.last30} />
                </dd>
              </div>
            </dl>
            {s.money && (
              <p className="mt-2 text-xs text-ink-muted">
                30 days at £10 a bet: <span className={s.money.last30.profit >= 0 ? "text-hit" : "text-loss"}>{gbp(s.money.last30.profit)}</span> · ROI {pct(s.money.last30.roi, true)} · avg odds{" "}
                {s.money.last30.avgOdds?.toFixed(2) ?? "–"}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">Hit rate counts settled alerts only. House money figures assume £10 on every alert at the price recorded for it, after commission.</p>
    </div>
  );
}
