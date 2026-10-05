"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, Card, moneyTone } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { ApiFetchError } from "@/queries/fetch-json";
import { useMembersDashboard, useMembersMe } from "@/queries/use-members";
import Landing from "@/components/members/Landing";
import { LockedFeature, ModeBadge, ModeBanner, pct, StatusPill, Tile, TrialCountdown, TrialEnded, when, WinLossText, odds, btnPrimary } from "@/components/members/ui";

export default function MembersHome() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

function Home() {
  const me = useMembersMe();
  const upgraded = useSearchParams().get("upgraded") === "1";
  if (me.error instanceof ApiFetchError && me.error.status === 401) return <Landing />;
  if (me.isLoading || !me.data) return <Skeleton className="h-64 w-full" />;
  if (me.data.tier === "suspended")
    return (
      <Card title="Account suspended">
        <p className="text-sm text-ink-muted">This membership has been suspended. Contact GoalBrew if you think this is a mistake.</p>
      </Card>
    );
  return <Dashboard upgraded={upgraded} />;
}

function Dashboard({ upgraded }: { upgraded: boolean }) {
  const { data, isLoading } = useMembersDashboard();
  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;
  const { me, sim } = data;
  const s = sim.summary;
  return (
    <div className="space-y-6">
      <PageHeader title={`Hello${me.user.name ? `, ${me.user.name.split(" ")[0]}` : ""}`} subtitle="Your Members dashboard" actions={<ModeBadge mode="sim" large />} />
      {upgraded && <p className="rounded-lg border border-hit/40 bg-hit/10 px-3 py-2 text-sm text-ink">Thank you. Your membership is being confirmed by Stripe and will show here in a moment.</p>}
      <TrialCountdown me={me} />
      <TrialEnded me={me} />
      {me.trial.state === "available" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
          <p className="text-sm text-ink">
            <strong>Try everything free for {me.trial.days} days.</strong> Choose {me.trial.strategyLimit} strategies and see exactly which games they pick.
          </p>
          <Link href="/members/trial" className={btnPrimary}>
            Start trial
          </Link>
        </div>
      )}

      <ModeBanner mode="sim" />
      <section aria-label="Simulation" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label="Bank" value={gbp(sim.bank?.now ?? 0, false)} sub={`started at ${gbp(sim.bank?.start ?? 0, false)}`} />
        <Tile label="Profit" value={gbp(s.profit)} tone={moneyTone(s.profit)} />
        <Tile label="ROI" value={pct(s.roi, true)} tone={s.roi === null ? "muted" : moneyTone(s.roi)} />
        <Tile label="Hit rate" value={pct(s.hitRate)} sub={`${s.wins}W / ${s.losses}L`} />
        <Tile label="Bets" value={String(s.bets)} sub={s.open ? `${s.open} open` : undefined} />
      </section>
      {data.live && (
        <section aria-label="Live" className="space-y-2">
          <ModeBanner mode="live" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Live profit" value={gbp(data.live.profit)} tone={moneyTone(data.live.profit)} />
            <Tile label="Live ROI" value={pct(data.live.roi, true)} />
            <Tile label="Hit rate" value={pct(data.live.hitRate)} />
            <Tile label="Bets" value={String(data.live.bets)} />
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Upcoming opportunities" actions={<Link href="/members/upcoming" className="text-xs text-accent">All</Link>}>
          {data.upcoming.open.length === 0 && data.upcoming.locked.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing live right now. Alerts arrive as matches unfold.</p>
          ) : (
            <ul className="space-y-2">
              {data.upcoming.open.map((p) => (
                <li key={p.id} className="text-sm">
                  <span className="font-medium text-ink">
                    {p.home} v {p.away}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {p.strategyName} · {p.market} · {odds(p.odds)}
                  </span>
                </li>
              ))}
              {data.upcoming.locked.map((l) => (
                <li key={l.strategyKey} className="text-xs text-ink-muted">
                  {l.strategyName}: {l.live} live now 🔒
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="House performance" subtitle="Official strategies. Separate from your own results." actions={<Link href="/members/strategies" className="text-xs text-accent">All</Link>}>
          <ul className="divide-y divide-line">
            {data.house.slice(0, 8).map((h) => (
              <li key={h.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/members/strategies/${encodeURIComponent(h.key)}`} className="min-w-0 truncate text-ink">
                  {h.name}
                </Link>
                <span className="shrink-0 text-xs">
                  <span className="text-ink-muted">Today </span>
                  <WinLossText wl={h.today} />
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recent bets" actions={<Link href="/members/history" className="text-xs text-accent">History</Link>}>
          {data.recent.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No bets yet. <Link href="/members/strategies" className="text-accent underline">Follow a strategy</Link> to start simulating.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recent.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{b.pick ? `${b.pick.home} v ${b.pick.away}` : b.strategyName}</span>
                    <span className="block text-xs text-ink-muted">
                      {b.strategyName} · {when(b.settledAt ?? b.at)} · <ModeBadge mode={b.mode} />
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {b.profit !== null && <span className={`text-xs tabular-nums ${b.profit > 0 ? "text-hit" : b.profit < 0 ? "text-loss" : "text-ink-muted"}`}>{gbp(b.profit)}</span>}
                    <StatusPill status={b.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Automation" actions={<Link href="/members/automation" className="text-xs text-accent">Manage</Link>}>
          <p className="text-sm text-ink">
            Following <strong>{data.automation.following}</strong> strateg{data.automation.following === 1 ? "y" : "ies"}: {data.automation.sim} in simulation
            {data.automation.live > 0 ? `, ${data.automation.live} live` : ""}.
          </p>
          <p className="mt-1 text-xs text-ink-muted">Live betting: {data.automation.liveBlockedReason ?? "on"}</p>
        </Card>
      </div>

      {me.tier === "free" || me.tier === "expired" ? (
        <LockedFeature me={me} feature="dashboard_selections" title="See which games qualify" pitch="Members see every qualifying match, market and price the moment a strategy fires." />
      ) : null}
    </div>
  );
}
