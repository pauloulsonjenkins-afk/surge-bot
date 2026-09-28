"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { marketName } from "@/lib/markets";
import { useAdminLivePicks, useSetPickResult, type LivePick } from "@/queries/use-live";

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

function label(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || raw;
}

function ResultChip({ pick }: { pick: LivePick }) {
  if (pick.result === "hit") return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-hit">Hit</span>;
  if (pick.result === "miss") return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-danger">Miss</span>;
  return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">No result yet</span>;
}

export default function ResultsPage() {
  const { data, isLoading, error } = useAdminLivePicks(100);
  const setResult = useSetPickResult();

  function change(pick: LivePick, result: "hit" | "miss" | null) {
    const wording =
      result === null
        ? "Put back the result the alert itself gave?"
        : `Set this result to ${result === "hit" ? "Hit" : "Miss"}?`;
    const ok = window.confirm(
      `${wording}\n\n${pick.home ?? "?"} v ${pick.away ?? "?"}\n\nThe Dashboard, Strategies and Trade Log will use it. Nothing changes in your betting software.`,
    );
    if (ok) setResult.mutate({ id: pick.id, result });
  }

  if (error) return <QueryError error={error} next="/more/admin/results" />;
  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-medium tracking-tight text-ink">Results</h2>
        <p className="text-xs text-ink-muted">
          Change a result by hand if the alert got it wrong. Your change is kept even if the alert is edited again, and
          you can put the original back at any time.
        </p>
      </div>

      {setResult.error && <p className="text-sm text-danger">{setResult.error.message}</p>}

      {data.length === 0 ? (
        <p className="text-sm text-ink-muted">No picks yet.</p>
      ) : (
        data.map((p) => (
          <article key={p.id} className="rounded-xl border border-line bg-surface p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label(p.strategy)}</p>
            <p className="mt-1 text-sm font-medium text-ink">
              {p.home ?? "Unknown"} v {p.away ?? "Unknown"}
            </p>
            <p className="text-xs text-ink-muted">
              {[
                p.competition,
                whenFmt.format(new Date(p.firstSeenAt)),
                p.goalsHome !== null && p.goalsAway !== null ? `Alert at ${p.goalsHome}–${p.goalsAway}` : null,
                p.ftScore ? `Full-time ${p.ftScore}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {p.market ? `${marketName(p.market)}${p.selection ? ` · ${p.selection}` : ""}` : "No market set"}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ResultChip pick={p} />
              {p.resultOverridden && (
                <span className="text-[11px] text-ink-muted">
                  Amended{p.originalResult ? ` (before: ${p.originalResult === "hit" ? "Hit" : "Miss"})` : ""}
                </span>
              )}
            </div>
            {p.detail?.resultSource === "score" && p.detail.alertResult && p.detail.alertResult !== p.detail.result && (
              <p className="mt-2 text-[11px] text-ink-muted">
                The alert&rsquo;s own tick said {p.detail.alertResult === "hit" ? "Hit" : "Miss"}, but the final score
                makes it a {p.detail.result === "hit" ? "Hit" : "Miss"}, so that is what is used.
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={setResult.isPending || p.result === "hit"}
                onClick={() => change(p, "hit")}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-hit disabled:opacity-40"
              >
                Set Hit
              </button>
              <button
                type="button"
                disabled={setResult.isPending || p.result === "miss"}
                onClick={() => change(p, "miss")}
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-danger disabled:opacity-40"
              >
                Set Miss
              </button>
              {p.resultOverridden && (
                <button
                  type="button"
                  disabled={setResult.isPending}
                  onClick={() => change(p, null)}
                  className="rounded-md px-3 py-1.5 text-xs text-ink-muted underline disabled:opacity-40"
                >
                  Put back original
                </button>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
