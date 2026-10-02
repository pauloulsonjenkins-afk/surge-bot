"use client";

import { useEffect, useState } from "react";
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
import { usePlacements, type Placement } from "@/queries/use-reconcile";
import { useSetManualBet } from "@/queries/use-live";
import { useStrategyNames } from "@/queries/use-strategy-names";

// An alert that has had no result edited in after this long is treated as
// finished rather than still in play. Finished picks live on the Trade Log.
const STILL_LIVE_MS = 3 * 60 * 60 * 1000;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function pairText(pair: [number, number] | undefined): string | null {
  return pair ? `${pair[0]} – ${pair[1]}` : null;
}

/** The newest score we have: half-time once it is in, otherwise the score when the alert fired. */
function latestScore(pick: LivePick): string {
  if (pick.htScore) return pick.htScore.replace(/\s*[-–]\s*/, " – ");
  return pick.goalsHome !== null && pick.goalsAway !== null ? `${pick.goalsHome} – ${pick.goalsAway}` : "– –";
}

/** Re-renders every half minute, so the estimated match clock moves on. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** A pre-match alert's estimated kick-off: "In 1 hour" or "In 45 minutes" from when it arrived (an hour if unsaid). */
function kickoffOf(pick: LivePick): number {
  const m = /in\s+(\d+)\s*(hour|hr|min)/i.exec(pick.detail?.kickoffRaw ?? "");
  const minutes = m ? Number(m[1]) * (m[2]!.toLowerCase().startsWith("h") ? 60 : 1) : 60;
  return Date.parse(pick.firstSeenAt) + minutes * 60_000;
}

/**
 * Roughly where the match is now: the alert's minute plus the time since, with about 15 minutes of half-time and a few
 * of stoppage. Only an estimate (alerts carry no live clock): "HT" in the break, "FT?" once it should be over.
 */
function matchClock(pick: LivePick, now: number): string | null {
  let startMinute: number;
  let from: number;
  if (pick.minute !== null) {
    startMinute = pick.minute;
    from = Date.parse(pick.firstSeenAt);
  } else if (pick.market === "FIRST_HALF_GOALS") {
    const ko = kickoffOf(pick);
    if (now < ko) return `KO ${fmtTime(new Date(ko).toISOString())}`;
    startMinute = 0;
    from = ko;
  } else return null;
  let m = startMinute + (now - from) / 60_000;
  if (startMinute <= 45) {
    if (m > 48 && m <= 63) return "HT";
    if (m > 63) m -= 18;
  }
  if (m > 97) return "FT?";
  return `~${Math.min(90, Math.floor(m))}'`;
}

const money = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}£${Math.abs(n).toFixed(2)}`;

/** The admin's view of a sent pick: what Betfair says happened to it (see pickPlacements in the engine). */
function placementChip(p: Placement): { label: string; cls: string; title: string } {
  switch (p.state) {
    case "matched":
      return { label: `Matched £${p.matched.toFixed(2)} @ ${p.odds?.toFixed(2) ?? "–"}`, cls: "bg-hit/15 text-hit", title: "The bet is on Betfair and matched." };
    case "won":
      return { label: `Won ${money(p.profit ?? 0)}`, cls: "bg-hit/15 text-hit", title: `Settled on Betfair at ${p.odds?.toFixed(2) ?? "–"}.` };
    case "lost":
      return { label: `Lost ${money(p.profit ?? 0)}`, cls: "bg-loss/15 text-loss", title: `Settled on Betfair at ${p.odds?.toFixed(2) ?? "–"}.` };
    case "waiting":
      return { label: "Placed, not matched yet", cls: "bg-warn/15 text-warn", title: "The bet is on Betfair, waiting for someone to match it." };
    case "lapsed":
      return { label: "Not matched", cls: "bg-warn/15 text-warn", title: "The bet was placed but lapsed or was cancelled before it matched." };
    case "notPlaced":
      return {
        label: "Not placed",
        cls: "bg-loss/15 text-loss",
        title: "No bet on Betfair 3 minutes after the pick was sent. BF Bot Manager may be off, or turned it down (market types, Time to bet, minimum odds).",
      };
    case "manual":
      return {
        label: `Placed by hand £${p.manual?.stake.toFixed(2) ?? "–"} @ ${p.manual?.odds.toFixed(2) ?? "–"}`,
        cls: "bg-hit/15 text-hit",
        title: "You logged this as placed yourself, so it counts as a live bet.",
      };
    case "beforeKickoff":
      return {
        label: "Sent · until kick-off",
        cls: "bg-accent/15 text-accent",
        title: "A pre-match bet: it stays in the feed until kick-off, so your betting software can place it any time before the start.",
      };
    default:
      return { label: "Sent · checking", cls: "bg-accent/15 text-accent", title: "Sent to your betting software. Checking Betfair for the bet." };
  }
}

/** What Betfair said about the match when the alert arrived; shown to the admin beside the status. */
function ExchangeChip({ pick }: { pick: LivePick }) {
  // The match is on Betfair, but not the exact market or selection the feed sends: the betting software can't place it.
  if (pick.exchange === "on" && (pick.marketCheck === "noMarket" || pick.marketCheck === "noSelection")) {
    return (
      <span
        title={`${pick.marketCheckDetail ?? ""} Fix the market code or selection wording on the Sending page (Bet wording).`}
        className="shrink-0 rounded-full bg-loss/15 px-2 py-0.5 text-xs font-medium text-loss"
      >
        Not on Betfair as sent
      </span>
    );
  }
  if (pick.exchange === "off") {
    return (
      <span title="This match wasn’t on Betfair when the alert arrived, so no bet can be placed. Mark the league “Don’t send” on the Leagues page." className="shrink-0 rounded-full bg-loss/15 px-2 py-0.5 text-xs font-medium text-loss">
        Not on exchange
      </span>
    );
  }
  // On Betfair: its price for the bet as sent, so a price under the strategy's minimum odds is easy to spot.
  if (pick.exchange === "on" && pick.exchangeOdds != null) {
    return (
      <span
        title="Betfair's back price for the bet as sent: read when the alert arrived, and again while a pick waits for its minimum odds."
        className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-ink-muted"
      >
        Betfair {pick.exchangeOdds.toFixed(2)}
      </span>
    );
  }
  if (pick.exchange === "nameDiffers") {
    return (
      <span title={`Betfair lists it as “${pick.exchangeEvent ?? "?"}”. Add the team’s Betfair name under Match names on the Sending page.`} className="shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
        Name differs on Betfair
      </span>
    );
  }
  return null;
}

function StatusChip({ pick, admin, placement }: { pick: LivePick; admin: boolean; placement?: Placement }) {
  // The admin sees which picks are only simulated; for everyone else it's just "Captured".
  if (admin && placement && (pick.sentAt || placement.manual)) {
    const c = placementChip(placement);
    return (
      <span title={c.title} className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${c.cls}`}>
        {c.label}
      </span>
    );
  }
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
 * One alert as a compact row under its match: the minute, the strategy and its status on the first line, the bet
 * and the time it arrived on the second. Tapping it opens the match stats underneath.
 */
/**
 * For the admin, under an alert that didn't get a bet (not placed, not matched, or never sent): log that you placed it
 * yourself, with the stake and price, so it counts as a live bet and its result isn't missed. Once logged, undo it here.
 */
function ManualBet({ pick, placement }: { pick: LivePick; placement?: Placement }) {
  const save = useSetManualBet();
  const [stake, setStake] = useState(placement?.stake ? String(placement.stake) : "");
  const [odds, setOdds] = useState("");
  const inputCls = "w-20 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink tabular-nums";
  if (placement?.manual) {
    return (
      <p className="text-xs text-ink-muted">
        Logged as placed by hand: £{placement.manual.stake.toFixed(2)} at {placement.manual.odds.toFixed(2)}.{" "}
        <button type="button" disabled={save.isPending} onClick={() => save.mutate({ id: pick.id, clear: true })} className="underline disabled:opacity-40">
          Undo
        </button>
      </p>
    );
  }
  // A bet that went on through the betting software needs nothing here.
  if (placement && (placement.state === "matched" || placement.state === "won" || placement.state === "lost")) return null;
  return (
    <div className="space-y-1.5 rounded-md bg-surface-2 p-2.5">
      <p className="text-xs font-medium text-ink">Placed it yourself?</p>
      <div className="flex flex-wrap items-end gap-2 text-xs text-ink-muted">
        <label>
          Stake (£)
          <input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} className={`${inputCls} mt-0.5 block`} />
        </label>
        <label>
          Odds taken
          <input value={odds} placeholder="2.10" onChange={(e) => setOdds(e.target.value)} className={`${inputCls} mt-0.5 block`} />
        </label>
        <button
          type="button"
          disabled={save.isPending || !stake.trim() || !odds.trim()}
          onClick={() => save.mutate({ id: pick.id, stake, odds })}
          className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-ink disabled:opacity-50"
        >
          Log as placed
        </button>
      </div>
      <p className="text-xs text-ink-muted">It then counts as a live bet at your stake and price, and settles with the alert&rsquo;s result.</p>
      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
    </div>
  );
}

function PickRow({ pick, admin, placement }: { pick: LivePick; admin: boolean; placement?: Placement }) {
  const [open, setOpen] = useState(false);
  const strategyNames = useStrategyNames();
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
          <span className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium text-ink">{strategyNames.name(pick.strategy)}</span>
            <span className="flex shrink-0 items-center gap-1">
              {admin && <ExchangeChip pick={pick} />}
              <StatusChip pick={pick} admin={admin} placement={placement} />
            </span>
          </span>
          <span className="mt-1 block truncate text-xs text-ink-muted">
            {[betText(pick.market, pick.selection) ?? "No market set", `at ${fmtTime(pick.firstSeenAt)}`].join(" · ")}
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

          {admin && <ManualBet pick={pick} placement={placement} />}

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

/** Alerts for the same match share a key, whichever strategy sent them. */
function matchKey(p: LivePick): string {
  const name = (s: string | null) => (s ?? "?").toLowerCase().replace(/\s+/g, " ").trim();
  return `${name(p.home)}|${name(p.away)}`;
}

/**
 * One match with every alert it has had: the teams, latest score and league once at the top, then one row per alert.
 * Several strategies often fire on the same match, and without this the same teams were listed again and again.
 */
function MatchGroup({ picks, admin, placements }: { picks: LivePick[]; admin: boolean; placements: Record<string, Placement> }) {
  // picks arrive newest first, so the first holds the latest score and minute.
  const latest = picks[0]!;
  const now = useNow();
  const minute = latest.minute !== null ? `${latest.minute}'` : latest.market === "FIRST_HALF_GOALS" ? "Pre-match" : null;
  const clock = matchClock(latest, now);
  const sent = picks.filter((p) => p.sentAt).length;
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-2/40 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">
            {latest.home ?? "Unknown"} <span className="font-normal text-ink-muted">v</span> {latest.away ?? "Unknown"}
          </h2>
          <p className="truncate text-xs text-ink-muted">
            {[
              latest.competition,
              clock && (clock === "FT?" ? "should be over, result due" : clock.startsWith("KO") ? `kick-off about ${clock.slice(3)}` : `about ${clock.replace("~", "")} now`),
              minute && `latest alert ${minute}`,
              `${picks.length} alert${picks.length === 1 ? "" : "s"}`,
              sent > 0 && `${sent} sent`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className="shrink-0 text-right">
          <span className="block text-base font-semibold tabular-nums text-ink">{latestScore(latest)}</span>
          {/* The score is only ever what an alert said: say which. */}
          <span className="block text-[11px] text-ink-muted">{latest.htScore ? "half-time" : "at alert"}</span>
        </span>
      </div>
      <ul className="divide-y divide-line">
        {picks.map((p) => (
          <PickRow key={p.id} pick={p} admin={admin} placement={placements[String(p.id)]} />
        ))}
      </ul>
    </li>
  );
}

export default function LivePage() {
  const { data, isLoading, error } = useLivePicks(50);
  const admin = useMe().data?.admin === true;
  // Admin only: whether each sent pick was actually placed and matched on Betfair.
  const placements = usePlacements(admin).data?.picks ?? {};

  if (isLoading) return <ListSkeleton />;

  const header = <PageHeader title="Live" subtitle="Matches in play with their alerts, most recent first" />;

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
  // Grouped by match, in order of each match's newest alert (Map keeps insertion order, and the list is newest first).
  const matches = new Map<string, LivePick[]>();
  for (const p of inPlay) (matches.get(matchKey(p)) ?? matches.set(matchKey(p), []).get(matchKey(p))!).push(p);

  return (
    <div className="space-y-6 px-4 py-4">
      {header}

      {inPlay.length === 0 ? (
        <EmptyState title="Nothing in play" detail="New alerts appear here as they arrive." />
      ) : (
        <ul className="space-y-3">
          {[...matches.entries()].map(([key, picks]) => (
            <MatchGroup key={key} picks={picks} admin={admin} placements={placements} />
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
