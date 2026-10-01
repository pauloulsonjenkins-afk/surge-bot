"use client";

import { useMemo, useState } from "react";
import { Card, Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCheckCoverage, useCoverage, type CoverageReport, type CoverageResult } from "@/queries/use-leagues";

const whenFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

type Filter = "not" | "maybe" | "on";
const BADGE: Record<Filter, { label: string; cls: string }> = {
  not: { label: "Not found", cls: "bg-loss/15 text-loss" },
  maybe: { label: "Possible", cls: "bg-warn/15 text-warn" },
  on: { label: "On Betfair", cls: "bg-hit/15 text-hit" },
};

/** The results with a filter, a count per status, and a button that copies the shown names one per line. */
function Results({ leagues, source }: { leagues: CoverageResult[]; source: "alerts" | "list" }) {
  const [filter, setFilter] = useState<Filter>("not");
  const [copied, setCopied] = useState(false);
  const count = (f: Filter) => leagues.filter((l) => l.status === f).length;
  const shown = leagues.filter((l) => l.status === filter).sort((a, b) => a.name.localeCompare(b.name));

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown.map((l) => l.name).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the list is on screen to select by hand.
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={(["not", "maybe", "on"] as const).map((f) => ({ value: f, label: `${BADGE[f].label} (${count(f)})` }))}
        />
        {shown.length > 0 && (
          <button type="button" onClick={() => void copy()} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2">
            {copied ? "Copied" : `Copy ${shown.length} name${shown.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        {filter === "not"
          ? "No Betfair competition for the country fits. Double-check any you know are on Betfair: it only lists a league while it has upcoming matches."
          : filter === "maybe"
            ? "Betfair has a competition for the country under a different name. Check the name shown: if it's the same league, it's on Betfair."
            : "A Betfair competition matches."}
      </p>
      {shown.length === 0 ? (
        <p className="text-xs text-ink-muted">None.</p>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {shown.map((l) => (
            <li key={l.name} className="flex items-start justify-between gap-3 px-2.5 py-2 text-xs">
              <span className="min-w-0">
                <span className="block text-ink">{l.name}</span>
                {l.betfair && (
                  <span className="block text-ink-muted">
                    Betfair: {l.betfair.name}
                    {l.status !== "on" || source === "list" ? ` · last listed ${dayFmt.format(new Date(l.betfair.lastSeen))}` : ""}
                  </span>
                )}
                {source === "alerts" && ((l.alertsOn ?? 0) > 0 || (l.alertsOff ?? 0) > 0) && (
                  <span className="block text-ink-muted">
                    Your alerts: {l.alertsOn ?? 0} on Betfair, {l.alertsOff ?? 0} not
                  </span>
                )}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${BADGE[l.status].cls}`}>{BADGE[l.status].label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Which leagues are on the Betfair exchange: the ones your alerts came from (checked automatically) or a pasted list
 * such as InPlayGuru's, so the ones that aren't can be switched off in InPlayGuru.
 */
export function BetfairCoverage() {
  const [tab, setTab] = useState<"alerts" | "list">("alerts");
  const { data, isLoading, error } = useCoverage();
  const check = useCheckCoverage();
  const [text, setText] = useState("");
  const names = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [text]);
  const report: CoverageReport | undefined = tab === "alerts" ? data : check.data;

  return (
    <Card
      title="Betfair coverage"
      subtitle="Which leagues have matches on the Betfair exchange, so you can switch the others off in InPlayGuru and stop alerts you can't bet."
    >
      <div className="space-y-3">
        {data &&
          (data.competitionCount === 0 ? (
            <p className="text-xs text-warn">
              Betfair’s list of competitions hasn’t been saved yet. It’s read every 6 hours once the live check on Betfair is connected (see
              Reconcile).
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              Checked against {data.competitionCount} football competitions Betfair has listed
              {data.competitionsUpdatedAt && `, last read ${whenFmt.format(new Date(data.competitionsUpdatedAt))}`}. Betfair only lists a league
              while it has matches coming up, so the list fills out over a few weeks.
            </p>
          ))}

        <Segmented
          label="Which leagues"
          value={tab}
          onChange={setTab}
          options={[
            { value: "alerts", label: "Your alert leagues" },
            { value: "list", label: "Check a list" },
          ]}
        />

        {tab === "list" && (
          <div className="space-y-2">
            <label className="block text-xs text-ink-muted">
              Paste InPlayGuru’s leagues, one per line (country first, as InPlayGuru writes them, e.g. “Spain La Liga”)
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder={"England Premier League\nSpain La Liga\nBolivia Copa Division Profesional"}
                className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink"
              />
            </label>
            <button
              type="button"
              disabled={names.length === 0 || check.isPending}
              onClick={() => check.mutate(names)}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
            >
              {check.isPending ? "Checking…" : `Check ${names.length || ""} league${names.length === 1 ? "" : "s"}`.replace("  ", " ")}
            </button>
            {check.error && <p className="text-xs text-destructive">{check.error.message}</p>}
          </div>
        )}

        {tab === "alerts" && error ? (
          <p className="text-xs text-destructive">{error.message}</p>
        ) : tab === "alerts" && (isLoading || !data) ? (
          <Skeleton className="h-32 w-full" />
        ) : report ? (
          <Results key={tab} leagues={report.leagues} source={tab} />
        ) : null}
      </div>
    </Card>
  );
}
