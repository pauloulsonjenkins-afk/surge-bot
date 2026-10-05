"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMembersAction, useMembersMe, useMembersStrategies } from "@/queries/use-members";
import { btnPrimary, WinLossText } from "@/components/members/ui";

/**
 * Starting the 7-day Premium Trial: choose the strategies (3) and start, in one step. The choice is fixed for the
 * trial, so each strategy's real 30-day record is shown to choose by (no methodology).
 */
export default function TrialPage() {
  const router = useRouter();
  const me = useMembersMe();
  const list = useMembersStrategies();
  const start = useMembersAction<{ strategies: string[] }>("trial/start");
  const [chosen, setChosen] = useState<string[]>([]);
  if (!me.data || !list.data) return <Skeleton className="h-96 w-full" />;
  const t = me.data.trial;
  const limit = t.strategyLimit;

  if (t.state !== "available") {
    return (
      <Card title="Premium Trial">
        <p className="text-sm text-ink-muted">{t.state === "active" ? "Your trial is running." : (t.reason ?? "A trial isn't available on this account.")}</p>
      </Card>
    );
  }

  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : c.length < limit ? [...c, k] : c));
  return (
    <div className="space-y-5">
      <PageHeader title={`Choose your ${limit} trial strategies`} subtitle={`For ${t.days} days you get the full premium view of these ${limit}: how they work, every qualifying game, and upcoming opportunities. Simulation only, no real money.`} />
      <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink">
        Choose carefully: the strategies are fixed for the whole trial and can&apos;t be swapped. The trial starts as soon as you press Start.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.data.strategies.map((s) => {
          const on = chosen.includes(s.key);
          return (
            <li key={s.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s.key)}
                disabled={!on && chosen.length >= limit}
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left disabled:opacity-50 ${on ? "border-accent bg-accent/10" : "border-line bg-surface"}`}
              >
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>{on && <Check size={14} />}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{s.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {s.type === "pre-match" ? "Pre-match" : "In-play"} · about {s.results.perWeek} a week
                  </span>
                  <span className="mt-1 block text-xs">
                    <span className="text-ink-muted">Last 30 days </span>
                    <WinLossText wl={s.results.last30} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {start.error && <p className="text-sm text-destructive">{start.error.message}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={chosen.length !== Math.min(limit, list.data.strategies.length) || start.isPending}
          onClick={() => start.mutate({ strategies: chosen }, { onSuccess: () => router.replace("/members") })}
          className={`${btnPrimary} px-5 py-2 text-sm`}
        >
          {start.isPending ? "Starting…" : `Start ${t.days}-day trial`}
        </button>
        <span className="text-xs text-ink-muted">
          {chosen.length} of {limit} chosen
        </span>
      </div>
    </div>
  );
}
