"use client";

import { Card, PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { signedPct, toneOf } from "@/lib/format";
import { useClaudeVerdictCheck, useSetClaudeBadgeVisible, type ClaudeVerdictCheck } from "@/queries/use-claude-verdict-check";

/** Below this many priced picks a return is noise, same rule as the Golden page. */
const FEW = 20;
const judged = (roi: number | null, n: number) => (n < FEW ? "text-ink-muted" : toneOf(roi));

const LABELS: Record<keyof ClaudeVerdictCheck["byVerdict"], string> = {
  stronger: "Stronger",
  in_line: "In line",
  weaker: "Weaker",
};

function Row({ label, row }: { label: string; row: ClaudeVerdictCheck["byVerdict"][keyof ClaudeVerdictCheck["byVerdict"]] }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      {row.n === 0 ? (
        <p className="mt-0.5 text-sm text-ink-muted">None yet</p>
      ) : (
        <>
          <p className={`mt-0.5 font-display text-lg font-bold tabular-nums [font-stretch:112%] ${judged(row.roi, row.counted)}`}>{row.counted > 0 ? signedPct(row.roi) : "–"}</p>
          <p className="text-xs tabular-nums text-ink-muted">
            {row.hits}–{row.n - row.hits} ({row.hitRate ?? "–"}%){row.counted > 0 && ` · ${row.counted} priced`}
            {row.counted > 0 && row.counted < FEW && " · too few to judge"}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The Claude verdict check (claude-verdict-check.ts): once enough of Claude's per-alert verdicts have settled,
 * compares them by verdict — does "weaker" really do worse than "in line"? Also the shadow-mode switch for the
 * badge shown on the Live tab: off until this page shows the warnings mean something.
 */
export default function ClaudeVerdictCheckPage() {
  const { data, isLoading, error } = useClaudeVerdictCheck();
  const setVisible = useSetClaudeBadgeVisible();

  return (
    <div className="space-y-4 p-4">
      <PageHeader title="Claude verdict check" subtitle="Does Claude's per-alert warning actually predict a worse result?" />

      <details className="space-y-2 rounded-md bg-surface-2 p-3 text-sm text-ink-muted">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink">How this works</summary>
        <div className="space-y-2 pb-3">
          <p>
            Every new alert gets a quick second opinion from Claude — stronger, in line, or weaker than that strategy&apos;s usual pattern (advisory only: it never places,
            skips or changes a bet). Once {data?.threshold ?? 100}+ of those verdicts have settled, this page compares their results, priced exactly as the Strategies page
            does, to see whether &ldquo;weaker&rdquo; alerts really have done worse.
          </p>
          <p>
            The badge itself starts <b className="text-ink">hidden</b> on the Live tab (shadow mode): Claude&apos;s verdicts are stored either way, but nothing is shown while
            placing a bet until you turn it on below, once this check shows the warnings mean something.
          </p>
        </div>
      </details>

      {error ? (
        <QueryError error={error} next="/more/admin/claude" />
      ) : isLoading || !data ? (
        <Skeleton className="h-48 w-full" />
      ) : !data.ready ? (
        <Card title="Not enough settled yet">
          <p className="text-sm text-ink-muted">{data.summary}</p>
        </Card>
      ) : (
        <Card title="By verdict" subtitle={`${data.settledCount} settled`}>
          <p className="mb-3 text-sm text-ink">{data.summary}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((k) => (
              <Row key={k} label={LABELS[k]} row={data.byVerdict[k]} />
            ))}
          </div>
        </Card>
      )}

      {data && (
        <Card title="Live tab badge">
          <p className="mb-3 text-sm text-ink-muted">
            {data.badgeVisible
              ? "Claude's per-alert verdict is shown as a badge on the Live tab."
              : "Shadow mode: Claude's verdicts are stored, but no badge shows on the Live tab yet."}
          </p>
          <button
            type="button"
            aria-pressed={data.badgeVisible}
            disabled={setVisible.isPending}
            onClick={() => setVisible.mutate(!data.badgeVisible)}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium text-ink ring-1 ring-inset ring-line disabled:opacity-40"
          >
            Badge on Live tab: {data.badgeVisible ? "on" : "off"}
          </button>
          {setVisible.error && <p className="mt-2 text-destructive">Couldn&apos;t save that: {setVisible.error.message}</p>}
        </Card>
      )}
    </div>
  );
}
