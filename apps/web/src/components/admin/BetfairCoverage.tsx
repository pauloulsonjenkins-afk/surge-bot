"use client";

import { useMemo, useState } from "react";
import { Card, Segmented } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCheckCoverage, useCoverage, useSetLeagueOverride, type CoverageReport, type CoverageResult } from "@/queries/use-leagues";

const whenFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

type Filter = "not" | "maybe" | "on";
const BADGE: Record<Filter, { label: string; cls: string }> = {
  not: { label: "Not found", cls: "bg-loss/15 text-loss" },
  maybe: { label: "Possible", cls: "bg-warn/15 text-warn" },
  on: { label: "On Betfair", cls: "bg-hit/15 text-hit" },
};

/**
 * Says by hand which Betfair competition a league is, when the names don't line up ("Poland III Liga" / "Polish 3 Liga"),
 * or that it isn't on Betfair; or puts it back to matching by name.
 */
function MatchLeague({ league, competitions }: { league: CoverageResult; competitions: string[] }) {
  const save = useSetLeagueOverride();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const listId = `bf-competitions-${league.name.replace(/[^a-z0-9]+/gi, "-")}`;
  if (league.overridden && !open) {
    return (
      <span className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-ink-muted">Set by you.</span>
        <button type="button" disabled={save.isPending} onClick={() => save.mutate({ league: league.name, competition: null })} className="underline disabled:opacity-40">
          Undo
        </button>
        <button type="button" onClick={() => setOpen(true)} className="underline">
          Change
        </button>
      </span>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 underline">
        {league.status === "on" ? "Wrong competition?" : "Match to a Betfair competition"}
      </button>
    );
  }
  return (
    <span className="mt-1.5 block space-y-1.5">
      <input
        list={listId}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        placeholder="Type to search Betfair's competitions"
        className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
      />
      <datalist id={listId}>
        {competitions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <span className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={save.isPending || !competitions.includes(choice)}
          onClick={() => save.mutate({ league: league.name, competition: choice }, { onSuccess: () => setOpen(false) })}
          className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-ink disabled:opacity-40"
        >
          Use this competition
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ league: league.name, competition: "none" }, { onSuccess: () => setOpen(false) })}
          className="rounded-md border border-line px-2.5 py-1 font-medium text-ink disabled:opacity-40"
        >
          Not on Betfair
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-1.5 py-1 text-ink-muted underline">
          Cancel
        </button>
      </span>
      {save.error && <span className="block text-destructive">{save.error.message}</span>}
    </span>
  );
}

/** The results with a filter, a count per status, and a button that copies the shown names one per line. */
function Results({ leagues, source, competitions = [] }: { leagues: CoverageResult[]; source: "alerts" | "list"; competitions?: string[] }) {
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
          ? "No Betfair competition for the country fits. If you know it's on Betfair under another name, match it below: Betfair only lists a league while it has upcoming matches."
          : filter === "maybe"
            ? "Betfair has a competition for the country under a different name. If it's the same league, or a different one is, match it below."
            : "A Betfair competition matches. These labels don't change what's sent: each match is checked on Betfair by its teams."}
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
                {competitions.length > 0 && <MatchLeague league={l} competitions={competitions} />}
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
  const [remember, setRemember] = useState(true);
  const names = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [text]);
  // The list tab shows a fresh check if one was just run, else the saved list re-checked against today's Betfair list.
  const saved = data?.saved ?? null;
  const report: CoverageReport | undefined =
    tab === "alerts" ? data : (check.data ?? (saved && data ? { ...data, leagues: saved.leagues } : undefined));

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
              onClick={() => check.mutate({ names, save: remember })}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
            >
              {check.isPending ? "Checking…" : `Check ${names.length || ""} league${names.length === 1 ? "" : "s"}`.replace("  ", " ")}
            </button>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "var(--accent)" }} className="h-4 w-4" />
              Remember this list and re-check it as Betfair’s competitions build up
            </label>
            {!check.data && saved && (
              <p className="text-xs text-ink-muted">
                Showing your saved list of {saved.leagues.length} leagues (saved {whenFmt.format(new Date(saved.savedAt))}), checked against today’s
                Betfair list.
              </p>
            )}
            {check.error && <p className="text-xs text-destructive">{check.error.message}</p>}
          </div>
        )}

        {tab === "alerts" && error ? (
          <p className="text-xs text-destructive">{error.message}</p>
        ) : tab === "alerts" && (isLoading || !data) ? (
          <Skeleton className="h-32 w-full" />
        ) : report && (tab === "alerts" || check.data || saved) ? (
          <Results key={tab} leagues={report.leagues} source={tab} competitions={data?.competitions ?? []} />
        ) : null}
      </div>
    </Card>
  );
}
