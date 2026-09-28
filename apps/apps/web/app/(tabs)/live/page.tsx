"use client";

import Link from "next/link";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { formatCurrency } from "@/lib/format";
import { LiveFetchError, useLivePicks, type LivePick } from "@/queries/use-live";

// An alert that has had no result edited in after this long is treated as
// "earlier" rather than still in play.
const STILL_LIVE_MS = 3 * 60 * 60 * 1000;

const MARKET_LABEL: Record<string, string> = {
  NEXT_GOAL: "Next goal",
  BOTH_TEAMS_TO_SCORE: "Both teams to score",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function pairText(pair: [number, number] | undefined): string | null {
  return pair ? `${pair[0]} – ${pair[1]}` : null;
}

function StatusChip({ pick }: { pick: LivePick }) {
  // "Sent to bet" will join this list once orders are actually sent.
  let label = "Captured";
  let cls = "bg-surface-2 text-ink-muted";
  if (pick.status === "settled") {
    if (pick.result === "hit") {
      label = "Hit";
      cls = "bg-surface-2 text-accent";
    } else if (pick.result === "miss") {
      label = "Miss";
      cls = "bg-surface-2 text-danger";
    } else {
      label = "Settled";
    }
  } else if (pick.status === "flagged") {
    label = "Needs review";
    cls = "bg-surface-2 text-danger";
  } else if (pick.status === "unmapped") {
    label = "Unmapped";
    cls = "bg-surface-2 text-danger";
  }
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function PickCard({ pick }: { pick: LivePick }) {
  const settled = pick.status === "settled";
  const stats = pick.detail?.stats ?? {};
  const keyStats: Array<[string, string | null]> = [
    ["Momentum", pairText(stats["Momentum"])],
    ["xG", pairText(stats["xG"])],
    ["Shots on target", pairText(stats["Shots On Target"])],
  ];
  const shownStats = keyStats.filter(([, v]) => v !== null) as Array<[string, string]>;
  const score =
    pick.goalsHome !== null && pick.goalsAway !== null ? `${pick.goalsHome} – ${pick.goalsAway}` : "– –";

  return (
    <article className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-muted">{pick.strategy}</p>
        <StatusChip pick={pick} />
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <p className="text-sm font-medium text-ink">{pick.home ?? "Unknown"}</p>
        <p className="text-lg font-semibold tabular-nums text-ink">{score}</p>
        <p className="text-right text-sm font-medium text-ink">{pick.away ?? "Unknown"}</p>
      </div>

      <p className="mt-1 text-center text-xs text-ink-muted">
        {[pick.competition, settled ? null : pick.timerRaw ? `Alerted at ${pick.timerRaw}` : null, fmtTime(pick.firstSeenAt)]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div className="mt-3 flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-sm">
        <span className="text-ink-muted">Bet</span>
        <span className="font-medium text-ink">
          {pick.market
            ? `${MARKET_LABEL[pick.market] ?? pick.market}${pick.selection ? ` · ${pick.selection}` : ""}`
            : "No market set"}
        </span>
      </div>

      {shownStats.length > 0 && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {shownStats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] text-ink-muted">{label}</dt>
              <dd className="text-xs font-medium tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {settled && (
        <p className="mt-3 text-center text-xs text-ink-muted">
          {[pick.htScore ? `Half-time ${pick.htScore}` : null, pick.ftScore ? `Full-time ${pick.ftScore}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {!settled && pick.flags.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-danger">
          {pick.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {pick.detail?.matched != null && pick.detail.strikeRate != null && !settled && (
        <p className="mt-3 text-center text-[11px] text-ink-muted">
          {formatCurrency(pick.detail.matched)} matched · {pick.detail.strikeRate}% strike rate
        </p>
      )}
    </article>
  );
}

function Section({ title, picks }: { title: string; picks: LivePick[] }) {
  if (picks.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</h2>
      {picks.map((p) => (
        <PickCard key={p.id} pick={p} />
      ))}
    </section>
  );
}

export default function LivePage() {
  const { data, isLoading, error } = useLivePicks(50);

  if (isLoading) return <ListSkeleton />;

  if (error) {
    const needsLogin = error instanceof LiveFetchError && error.status === 401;
    return (
      <div className="px-4 py-4">
        <h1 className="text-lg font-medium tracking-tight text-ink">Live</h1>
        {needsLogin ? (
          <p className="mt-2 text-sm text-ink-muted">
            Sign in to see live picks.{" "}
            <Link href="/more/admin/login?next=/live" className="text-accent underline">
              Sign in
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-sm text-danger">{error.message}</p>
        )}
      </div>
    );
  }

  const picks = data ?? [];
  const now = Date.now();
  const inPlay = picks.filter((p) => p.status !== "settled" && now - new Date(p.firstSeenAt).getTime() < STILL_LIVE_MS);
  const earlier = picks.filter((p) => !inPlay.includes(p));

  return (
    <div className="space-y-5 px-4 py-4">
      <h1 className="text-lg font-medium tracking-tight text-ink">Live</h1>

      {picks.length === 0 ? (
        <EmptyState title="No picks yet" detail="New picks appear here as they arrive." />
      ) : (
        <>
          <Section title="Live in play" picks={inPlay} />
          <Section title="Earlier" picks={earlier} />
        </>
      )}
    </div>
  );
}
