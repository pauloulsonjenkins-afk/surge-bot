"use client";

import { useState } from "react";
import { Card, PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useGoalModel } from "@/queries/use-goal-model";

const signed = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`);
const tone = (n: number | null) => (n === null || n === 0 ? "text-ink" : n > 0 ? "text-hit" : "text-loss");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–");

/** Research: does GoalBrew's own model of InPlayGuru's stats know something the price doesn't? */
export default function GoalModelPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, isLoading, isFetching } = useGoalModel(refreshKey);

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Goal model"
        subtitle="Research. For next-goal alerts, a model of InPlayGuru's stats (minute, score, momentum, attacks, shots) estimates the chance of another goal, starting from the market's own chance. It's trained on older picks and tested on newer ones it never saw. Nothing here bets."
        actions={
          <button
            type="button"
            disabled={isFetching}
            onClick={() => setRefreshKey((k) => k + 1)}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {isFetching ? "Training…" : "Train again"}
          </button>
        }
      />
      {error ? (
        <QueryError error={error} next="/more/admin/goal-model" />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <p className={`rounded-xl border p-3 text-sm text-ink ${data.verdict.startsWith("Promising") ? "border-hit/50 bg-hit/10" : "border-line bg-surface"}`}>{data.verdict}</p>

          {data.test && (
            <>
              <Card
                title="Tested on picks it never saw"
                subtitle={`Trained on ${data.train.n} picks (${day(data.train.from)} – ${day(data.train.to)}), tested on the next ${data.test.n} (${day(data.test.from)} – ${day(data.test.to)}).`}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Goals came", `${data.test.hitRate}%`, "text-ink"],
                    ["Market said", `${data.test.marketChance}%`, "text-ink"],
                    ["Prediction error: market", data.test.logLossMarket.toFixed(4), "text-ink"],
                    ["Prediction error: model", data.test.logLossModel.toFixed(4), data.test.improvement > 0 ? "text-hit" : "text-loss"],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="rounded-xl border border-line bg-surface-2 p-3 text-center">
                      <p className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</p>
                      <p className="text-xs text-ink-muted">{label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Prediction error is log loss: lower is better. The market is the bar to beat; beating it on unseen picks is the only result that counts.
                </p>

                <h4 className="mt-4 text-sm font-medium text-ink">If it had chosen which picks to bet</h4>
                <ul className="mt-1 divide-y divide-line text-sm">
                  {[
                    ["Every pick", data.test.betEvery],
                    ["Only where the model is 3+ points above the market", data.test.modelBets],
                    ["The ones it would skip", data.test.modelSkips],
                  ].map(([label, r]) => {
                    const v = r as { bets: number; roi: number | null };
                    return (
                      <li key={label as string} className="flex items-baseline justify-between gap-3 py-2">
                        <span className="min-w-0 text-ink">{label as string}</span>
                        <span className="shrink-0 tabular-nums">
                          <span className={`font-semibold ${tone(v.roi)}`}>{signed(v.roi)}</span> <span className="text-xs text-ink-muted">· {v.bets} bets</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {data.trainCheck && (
                  <p className="mt-1 text-xs text-ink-muted">
                    Same split on the older picks: its bets {signed(data.trainCheck.modelBets.roi)} ({data.trainCheck.modelBets.bets}), skipped {signed(data.trainCheck.modelSkips.roi)} (
                    {data.trainCheck.modelSkips.bets}). Returns use the alert&apos;s price less 2% commission, not what Betfair matched, so treat them as a guide.
                  </p>
                )}
              </Card>

              {data.test.calibration.length > 0 && (
                <Card title="Does it mean what it says?" subtitle="When the model says 70%, a goal should come about 70% of the time. Unseen picks only.">
                  <ul className="divide-y divide-line text-sm">
                    {data.test.calibration.map((c) => (
                      <li key={c.band} className="flex items-baseline justify-between gap-3 py-2 tabular-nums">
                        <span className="text-ink">Said {c.band}</span>
                        <span className="text-ink-muted">
                          predicted {c.predicted}% · came {c.actual}% · {c.n} picks
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}

          {data.weights.length > 0 && (
            <Card title="What moves its estimate" subtitle={`Trained on all ${data.rows} picks. Plus pushes the chance of a goal up, minus down, measured in spreads of each figure.`}>
              <ul className="divide-y divide-line text-sm">
                {data.weights.map((w) => (
                  <li key={w.feature} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="text-ink">{w.feature}</span>
                    <span className={`tabular-nums ${tone(w.weight)}`}>{w.weight > 0 ? "+" : ""}{w.weight.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
