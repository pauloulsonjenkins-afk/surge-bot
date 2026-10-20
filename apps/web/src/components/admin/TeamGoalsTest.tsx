"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { TeamGoalsGroup, TeamGoalsReport } from "@/server/engine-client";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { toneOf } from "@/lib/format";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
const signed = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`);

function Box({ label, g }: { label: string; g: TeamGoalsGroup }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${toneOf(g.roi)}`}>{signed(g.roi)}</p>
      <p className="text-xs text-ink-muted">
        {g.picks} pick{g.picks === 1 ? "" : "s"}
        {g.hitRate !== null ? ` · hit ${g.hitRate}%` : ""}
      </p>
    </div>
  );
}

/**
 * The Sim-only test of GoalSignal's "lively teams" filter on next-goal picks: picks that pass against picks that don't,
 * since the test started, and on the picks before it (backfilled from history). Nothing bets differently.
 */
export function TeamGoalsTest({ r }: { r: TeamGoalsReport }) {
  const names = useStrategyNames();
  // The page's clock, read once.
  const [now] = useState(() => Date.now());
  const due = now >= Date.parse(r.reviewAt);
  return (
    <Card
      title="Test: lively teams filter (from GoalSignal)"
      subtitle={`${r.rule}. Checked on every next-goal pick from the 38 football-data leagues; nothing is bet differently. Started ${day(r.start)}, review on ${day(r.reviewAt)}.`}
    >
      {due && <p className="mb-3 rounded-lg border border-accent/50 bg-accent/10 p-2 text-sm text-ink">A week is up: time to review this test.</p>}
      <p className="mb-1 text-xs font-medium text-ink-muted">Since the test started</p>
      <div className="grid grid-cols-2 gap-2">
        <Box label="Passes the filter" g={r.sinceStart.pass} />
        <Box label="Fails it" g={r.sinceStart.fail} />
      </div>
      <p className="mb-1 mt-3 text-xs font-medium text-ink-muted">Earlier picks, checked the same way (backfilled)</p>
      <div className="grid grid-cols-2 gap-2">
        <Box label="Passes the filter" g={r.backfilled.pass} />
        <Box label="Fails it" g={r.backfilled.fail} />
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {r.covered} of {r.checked} settled next-goal picks are in leagues the history covers. Returns per £1 at each pick&apos;s price, less commission.
      </p>
      {r.byStrategy.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">By strategy (all picks)</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {r.byStrategy.map((s) => (
              <li key={s.strategy} className="py-2">
                <span className="text-ink">{names.name(s.strategy)}</span>
                <span className="block text-xs text-ink-muted">
                  passes <span className={toneOf(s.pass.roi)}>{signed(s.pass.roi)}</span> ({s.pass.picks}) · fails <span className={toneOf(s.fail.roi)}>{signed(s.fail.roi)}</span> ({s.fail.picks})
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
