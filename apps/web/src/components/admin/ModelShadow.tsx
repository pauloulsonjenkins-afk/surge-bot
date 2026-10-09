"use client";

import type { ShadowGroup, ShadowReport } from "@/server/engine-client";
import { Card } from "@/components/ui/Card";
import { StrategyName } from "@/components/ui/StrategyName";
import { usePublishGoalModel } from "@/queries/use-goal-model";

const signed = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`);
const tone = (n: number | null) => (n === null || n === 0 ? "text-ink" : n > 0 ? "text-hit" : "text-loss");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");

function GroupTile({ label, g }: { label: string; g: ShadowGroup }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone(g.roi)}`}>{signed(g.roi)}</p>
      <p className="text-xs text-ink-muted">
        {g.settled} settled of {g.picks}
        {g.hitRate !== null ? ` · hit ${g.hitRate}%` : ""}
      </p>
    </div>
  );
}

/**
 * The goal model in shadow: every new next-goal pick scored as it arrives by a frozen model version, and how the
 * picks it "would bet" compare with the ones it "would skip". Nothing is bet differently.
 */
export function ModelShadow({ s }: { s: ShadowReport }) {
  const publish = usePublishGoalModel();
  return (
    <Card
      title="In shadow: live picks it never saw"
      subtitle="Every new next-goal pick is scored as it arrives. 'Would bet' means the model's chance is 3+ points above what Betfair's price needs to break even after 2% commission. Picks are only labelled: nothing is held back or bet differently."
    >
      <div className={`rounded-md p-2.5 text-xs ${s.ready.met ? "bg-hit/15 text-ink" : "bg-surface-2 text-ink"}`}>
        {s.ready.met ? (
          <p className="font-medium text-hit">Proved in shadow. Turn it on for one Live strategy at £1: Strategies, open a next-goal strategy, Goal model filter: On.</p>
        ) : (
          <>
            <p className="font-medium">Not proved yet. You&apos;ll get a notification the moment it is. Still needed:</p>
            <ul className="mt-1 list-disc pl-4 text-ink-muted">
              {s.ready.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <GroupTile label="Would bet" g={s.wouldBet} />
        <GroupTile label="Would skip" g={s.wouldSkip} />
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {s.scored} picks scored since {when(s.since)}
        {s.betfairShare !== null ? ` · ${s.betfairShare}% against Betfair's price, the rest the alert's` : ""}. Returns per £1 at the price scored, less 2% commission.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        {s.model ? (
          <span>
            Model {s.model.version}, trained on {s.model.rows} picks. A new version is trained and frozen each week.
          </span>
        ) : (
          <span>No model yet: it needs 200 settled next-goal picks to train on.</span>
        )}
        <button
          type="button"
          disabled={publish.isPending}
          onClick={() => publish.mutate()}
          className="rounded-md border border-line px-2 py-0.5 text-ink hover:bg-surface-2 disabled:opacity-50"
        >
          {publish.isPending ? "Training…" : "Train a new version now"}
        </button>
        {publish.error && <span className="text-destructive">{publish.error.message}</span>}
      </div>

      {s.byStrategy.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">By strategy</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {s.byStrategy.map((b) => (
              <li key={b.strategy} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 text-ink">
                  <StrategyName label={b.strategy} />
                </span>
                <span className="text-xs tabular-nums text-ink-muted">
                  bet <span className={tone(b.wouldBet.roi)}>{signed(b.wouldBet.roi)}</span> ({b.wouldBet.settled}) · skip{" "}
                  <span className={tone(b.wouldSkip.roi)}>{signed(b.wouldSkip.roi)}</span> ({b.wouldSkip.settled})
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {s.recent.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-ink">Latest scored picks</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {s.recent.map((r) => (
              <li key={r.pickId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="min-w-0">
                  <span className="block text-ink">{r.match}</span>
                  <span className="text-xs text-ink-muted">
                    <StrategyName label={r.strategy} />
                    {r.minute !== null ? ` · ${r.minute}'` : ""} · model {r.pModel}% vs needs {r.pNeeded}% at {r.price.toFixed(2)} ({r.priceFrom === "betfair" ? "Betfair" : "alert"})
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium">
                  <span className={r.wouldBet ? "text-hit" : "text-ink-muted"}>{r.wouldBet ? "Would bet" : "Would skip"}</span>
                  {r.result && <span className={r.result === "hit" ? "text-hit" : "text-loss"}> · {r.result === "hit" ? "goal" : "no goal"}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
