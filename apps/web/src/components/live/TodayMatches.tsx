"use client";

import Link from "next/link";
import { useSchedule } from "@/queries/use-schedule";
import { countTodayMatches } from "@/lib/today-matches";

const ukTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/**
 * The top of Live (owner, 8 Nov 2026): matches in play now and still to kick off today, across the leagues GoalBrew can
 * bet (the Schedule's list), and how many of the ones in play have alerts on this page. Nothing until the day's fixtures
 * have been pulled.
 */
export function TodayMatches({ now, withAlerts }: { now: number; withAlerts: number }) {
  const { data } = useSchedule("today");
  if (!data || data.fixtures.length === 0) return null;
  const c = countTodayMatches(data.fixtures, now);
  const cell = "flex flex-col gap-0.5 bg-surface px-3 py-3 whitespace-nowrap";
  return (
    <section aria-label="Today's matches" className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
      <div className={cell}>
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          {c.inPlay > 0 && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-hit" />}
          In play
        </span>
        <span className="font-display text-2xl font-bold tabular-nums text-ink [font-stretch:112%]">{c.inPlay}</span>
        <span className="text-xs text-ink-muted">today&apos;s matches</span>
      </div>
      <Link href="/schedule" className={`${cell} hover:bg-surface-2`}>
        <span className="text-xs text-ink-muted">To kick off</span>
        <span className="font-display text-2xl font-bold tabular-nums text-ink [font-stretch:112%]">{c.toPlay}</span>
        <span className="text-xs text-ink-muted">{c.nextKickoff ? `next ${ukTime.format(new Date(c.nextKickoff))}` : "none left today"}</span>
      </Link>
      <div className={cell}>
        <span className="text-xs text-ink-muted">With alerts</span>
        <span className="font-display text-2xl font-bold tabular-nums text-ink [font-stretch:112%]">{withAlerts}</span>
        <span className="text-xs text-ink-muted">on this page</span>
      </div>
    </section>
  );
}
