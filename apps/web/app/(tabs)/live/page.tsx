"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { formatCurrency } from "@/lib/format";
import { QueryError } from "@/components/ui/QueryError";
import { betText } from "@/lib/markets";
import { useLivePicks, type PublicPick as LivePick } from "@/queries/use-live";
import { useMe } from "@/queries/use-me";
import { ModeBadge } from "@/components/ui/ModeToggle";

// An alert that has had no result edited in after this long is treated as
// finished rather than still in play. Finished picks live on the Trade Log.
const STILL_LIVE_MS = 3 * 60 * 60 * 1000;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function pairText(pair: [number, number] | undefined): string | null {
  return pair ? `${pair[0]} – ${pair[1]}` : null;
}

/** Strategy names carry a bracketed note from the alert ("Goal Brewing (v2)"); the row only has room for the name. */
function shortStrategy(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || raw;
}

/** The newest score we have: half-time once it is in, otherwise the score when the alert fired. */
function latestScore(pick: LivePick): string {
  if (pick.htScore) return pick.htScore.replace(/\s*[-–]\s*/, " – ");
  return pick.goalsHome !== null && pick.goalsAway !== null ? `${pick.goalsHome} – ${pick.goalsAway}` : "– –";
}

function StatusChip({ pick, admin }: { pick: LivePick; admin: boolean }) {
  // The admin sees which picks are only simulated; for everyone else it's just "Captured".
  if (admin && !pick.sentAt && pick.status !== "flagged" && pick.status !== "unmapped") return <ModeBadge mode="sim" />;
  let label = "Captured";
  let cls = "bg-surface-2 text-ink-muted";
  if (pick.sentAt) {
    label = "Sent to bet";
    cls = "bg-accent/15 text-accent";
  } else if (pick.status === "flagged") {
    label = "Needs review";
    cls = "bg-warn/15 text-warn";
  } else if (pick.status === "unmapped") {
    label = "Unmapped";
    cls = "bg-warn/15 text-warn";
  }
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

/**
 * One alert as a compact row (about 72px): the minute, the teams and the score on the first line, the strategy
 * and bet on the second. Tapping it opens the match stats underneath.
 */
function PickRow({ pick, admin }: { pick: LivePick; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const stats = pick.detail?.stats ?? {};
  // Corners lead for the corners strategy; for the rest they come last.
  const cornersFirst = pick.market === "FIRST_HALF_CORNERS";
  const corners: Array<[string, string | null]> = [["Corners", pairText(stats["Corners"])]];
  const keyStats: Array<[string, string | null]> = [
    ...(cornersFirst ? corners : []),
    ["Momentum", pairText(stats["Momentum"])],
    ["xG", pairText(stats["xG"])],
    ["Shots on target", pairText(stats["Shots On Target"])],
    ...(cornersFirst ? [] : corners),
  ];
  const shownStats = keyStats.filter(([, v]) => v !== null) as Array<[string, string]>;
  // Pre-match alerts (First Half Goal) arrive before kick-off, so they have no match minute.
  const preMatch = pick.minute === null && pick.market === "FIRST_HALF_GOALS";
  const minute = pick.minute !== null ? `${pick.minute}'` : preMatch ? "Pre" : (pick.timerRaw ?? "–");

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2/60"
      >
        <span
          title={preMatch ? "Sent before kick-off" : "Match minute when the alert fired"}
          className="mt-0.5 w-10 shrink-0 rounded-md bg-surface-2 py-0.5 text-center text-xs font-semibold tabular-nums text-ink"
        >
          {minute}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-ink">
              {pick.home ?? "Unknown"} <span className="text-ink-muted">v</span> {pick.away ?? "Unknown"}
            </span>
            <span className="shrink-0 text-base font-semibold tabular-nums text-ink">{latestScore(pick)}</span>
          </span>
          <span className="mt-1 flex items-center justify-between gap-3">
            <span className="truncate text-xs text-ink-muted">
              {[shortStrategy(pick.strategy), betText(pick.market, pick.selection) ?? "No market set"].join(" · ")}
            </span>
            <StatusChip pick={pick} admin={admin} />
          </span>
        </span>

        <ChevronDown
          size={16}
          aria-hidden
          className={`mt-1 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-line bg-surface-2/40 py-3 pl-16 pr-3">
          <p className="text-xs text-ink-muted">
            {[pick.competition, preMatch ? "Pre-match alert" : `Alert at ${minute}`, fmtTime(pick.firstSeenAt)].filter(Boolean).join(" · ")}
          </p>

          {shownStats.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {shownStats.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-ink-muted">{label}</dt>
                  <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {pick.flags.length > 0 && (
            <ul className="space-y-1 text-xs text-warn">
              {pick.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}

          {pick.detail?.matched != null && pick.detail.strikeRate != null && (
            <p className="text-xs text-ink-muted">
              {formatCurrency(pick.detail.matched)} matched · {pick.detail.strikeRate}% strike rate
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function LivePage() {
  const { data, isLoading, error } = useLivePicks(50);
  const admin = useMe().data?.admin === true;

  if (isLoading) return <ListSkeleton />;

  const header = <PageHeader title="Live" subtitle="Alerts for matches in play, newest first" />;

  if (error) {
    return (
      <div className="space-y-6 px-4 py-4">
        {header}
        <QueryError error={error} next="/live" />
      </div>
    );
  }

  const now = Date.now();
  const inPlay = (data ?? []).filter(
    (p) => p.status !== "settled" && now - new Date(p.firstSeenAt).getTime() < STILL_LIVE_MS,
  );

  return (
    <div className="space-y-6 px-4 py-4">
      {header}

      {inPlay.length === 0 ? (
        <EmptyState title="Nothing in play" detail="New alerts appear here as they arrive." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {inPlay.map((p) => (
            <PickRow key={p.id} pick={p} admin={admin} />
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-ink-muted">
        Finished matches move to the{" "}
        <Link href="/trade-log" className="text-ink underline">
          Trade Log
        </Link>
        .
      </p>
    </div>
  );
}
