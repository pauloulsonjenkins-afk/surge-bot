"use client";

import { PageHeader, Segmented } from "@/components/ui/Card";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { RawAlerts } from "@/components/admin/RawAlerts";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { betText } from "@/lib/markets";
import { usePickDays, useAdminPicksWindow, useSetPickExcluded, useSetPickResult, type LivePick, type ResultsWindow } from "@/queries/use-live";

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-09-29" -> "Tue 29 Sep" (the date is a plain calendar date, so no time zone shifts it). */
function dayLabel(date: string): string {
  return dayFmt.format(new Date(`${date}T12:00:00Z`));
}

function label(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || raw;
}

function ResultChip({ pick }: { pick: LivePick }) {
  if (pick.result === "hit") return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-hit">Hit</span>;
  if (pick.result === "miss") return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-loss">Miss</span>;
  return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">No result yet</span>;
}

function SettledPicks() {
  const [mode, setMode] = useState<"recent" | "date">("recent");
  const [picked, setPicked] = useState<string | null>(null);
  const days = usePickDays();
  // By date starts on the newest day that has picks, until one is chosen.
  const chosenDate = picked ?? days.data?.[0]?.date ?? null;
  const range: ResultsWindow = mode === "recent" || chosenDate === null ? { kind: "recent" } : { kind: "date", date: chosenDate };
  const waitingForDays = mode === "date" && chosenDate === null && days.isLoading;
  const { data, isLoading, error } = useAdminPicksWindow(range);
  const setResult = useSetPickResult();
  const setExcluded = useSetPickExcluded();
  const dialog = useDialog();

  async function change(pick: LivePick, result: "hit" | "miss" | null) {
    const ok = await dialog.confirm({
      title: result === null ? "Put back the alert’s own result?" : `Set this result to ${result === "hit" ? "Hit" : "Miss"}?`,
      confirmLabel: result === null ? "Put back the alert’s result" : `Mark as ${result === "hit" ? "Hit" : "Miss"}`,
      details: [{ label: "Match", value: `${pick.home ?? "?"} v ${pick.away ?? "?"}` }],
      body: <p>The Dashboard, Strategies and Trade Log will use it. Nothing changes in your betting software.</p>,
    });
    if (ok) setResult.mutate({ id: pick.id, result });
  }

  async function toggleExcluded(pick: LivePick) {
    const ok = await dialog.confirm(
      pick.excluded
        ? {
            title: "Put this pick back into your results?",
            confirmLabel: "Put back",
            details: [{ label: "Match", value: `${pick.home ?? "?"} v ${pick.away ?? "?"}` }],
            body: <p>It counts again on the Dashboard, Trade Log and Win/Loss.</p>,
          }
        : {
            title: "Remove this pick from your results?",
            tone: "danger",
            confirmLabel: "Remove from results",
            details: [{ label: "Match", value: `${pick.home ?? "?"} v ${pick.away ?? "?"}` }],
            body: (
              <>
                <p>Use this when the bet was wrong or never actually went on. It comes out of the Dashboard, Trade Log and Win/Loss straight away.</p>
                <p>The original alert stays on the Raw alerts tab, and you can put it back at any time.</p>
              </>
            ),
          },
    );
    if (ok) setExcluded.mutate({ id: pick.id, excluded: !pick.excluded });
  }

  if (error) return <QueryError error={error} next="/more/admin/results" />;
  const rows = data ?? [];
  const counted = rows.filter((p) => !p.excluded);
  const summary = {
    picks: counted.length,
    hits: counted.filter((p) => p.result === "hit").length,
    misses: counted.filter((p) => p.result === "miss").length,
    pending: counted.filter((p) => p.result === null).length,
    removed: rows.length - counted.length,
  };

  const dayList = days.data ?? [];
  const dayIndex = chosenDate === null ? -1 : dayList.findIndex((d) => d.date === chosenDate);

  const loading = isLoading || !data || waitingForDays;
  // By date with no days to choose from: only the "no days" message is shown, not the last-24-hours list.
  const noDays = mode === "date" && chosenDate === null && !days.isLoading;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Change a result by hand if the alert got it wrong. Your change is kept even if the alert is edited again, and
        you can put the original back at any time.
      </p>

      <Segmented
        label="Which results"
        value={mode}
        onChange={setMode}
        options={[
          { value: "recent", label: "Last 24 hours" },
          { value: "date", label: "By date" },
        ]}
      />

      {mode === "date" &&
        (dayList.length === 0 ? (
          <p className="text-sm text-ink-muted">{days.isLoading ? "Loading days…" : "No days with picks yet."}</p>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous day"
              disabled={dayIndex < 0 || dayIndex >= dayList.length - 1}
              onClick={() => setPicked(dayList[dayIndex + 1]?.date ?? null)}
              className="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink disabled:opacity-40"
            >
              ‹
            </button>
            <select
              value={chosenDate ?? ""}
              onChange={(e) => setPicked(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              {dayList.map((d) => (
                <option key={d.date} value={d.date}>
                  {dayLabel(d.date)} · {d.picks} pick{d.picks === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next day"
              disabled={dayIndex <= 0}
              onClick={() => setPicked(dayList[dayIndex - 1]?.date ?? null)}
              className="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink disabled:opacity-40"
            >
              ›
            </button>
          </div>
        ))}

      {!loading && !noDays && (
        <p className="text-xs text-ink-muted">
          {mode === "recent" ? "Last 24 hours" : chosenDate ? dayLabel(chosenDate) : ""} · {summary.picks} pick{summary.picks === 1 ? "" : "s"} ·{" "}
          {summary.hits} hit · {summary.misses} miss · {summary.pending} no result yet
          {summary.removed > 0 ? ` · ${summary.removed} removed` : ""}
        </p>
      )}

      {setResult.error && <p className="text-sm text-destructive">{setResult.error.message}</p>}
      {setExcluded.error && <p className="text-sm text-destructive">{setExcluded.error.message}</p>}

      {noDays ? null : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {mode === "recent" ? "No picks in the last 24 hours. Use By date to look further back." : "No picks on that day."}
        </p>
      ) : (
        data.map((p) => (
          <article key={p.id} className={`rounded-xl border border-line bg-surface p-3.5 ${p.excluded ? "opacity-50" : ""}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label(p.strategy)}</p>
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
              {betText(p.market, p.selection) ?? "No market set"}
            </p>

            {p.excluded && (
              <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-ink-muted">
                Removed from results — not counted anywhere.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ResultChip pick={p} />
              {p.resultOverridden && (
                <span className="text-xs text-ink-muted">
                  Amended{p.originalResult ? ` (before: ${p.originalResult === "hit" ? "Hit" : "Miss"})` : ""}
                </span>
              )}
            </div>
            {p.detail?.resultSource === "score" && p.detail.alertResult && p.detail.alertResult !== p.detail.result && (
              <p className="mt-2 text-xs text-ink-muted">
                The alert&rsquo;s own tick said {p.detail.alertResult === "hit" ? "Hit" : "Miss"}, but the final score
                makes it a {p.detail.result === "hit" ? "Hit" : "Miss"}, so that is what is used.
              </p>
            )}

            {!p.excluded && (
              <div className="mt-3 flex flex-wrap gap-2">
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
                  className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-loss disabled:opacity-40"
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
            )}

            <div className="mt-2">
              <button
                type="button"
                disabled={setExcluded.isPending}
                onClick={() => toggleExcluded(p)}
                className={`text-xs underline disabled:opacity-40 ${p.excluded ? "text-ink-muted" : "text-destructive"}`}
              >
                {p.excluded ? "Put back" : "Remove from results"}
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

/**
 * The admin's editing view of the Trade Log: settled picks with buttons to correct them, and the alerts exactly as
 * they arrived. Opened from the Trade Log's "Amend results" button or the admin menu.
 */
export default function AmendResultsPage() {
  const [view, setView] = useState<"settled" | "raw">("settled");

  // The old Picks page sends people here with ?view=raw.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "raw") setView("raw");
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Amend results"
        subtitle="The Trade Log, with the tools to correct it."
        actions={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "settled", label: "Picks" },
              { value: "raw", label: "Raw alerts" },
            ]}
          />
        }
      />
      {view === "settled" ? <SettledPicks /> : <RawAlerts />}
    </div>
  );
}
