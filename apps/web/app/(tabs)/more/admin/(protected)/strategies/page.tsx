"use client";

import { PageHeader, Segmented } from "@/components/ui/Card";
import { useMemo, useState } from "react";
import { useAdminStrategies, useDeleteStrategy, useIgnoreStrategy, useMergeStrategy, useStrategyWeeks, type AdminStrategy } from "@/queries/use-strategies";
import { StrategyWeekly } from "@/components/admin/StrategyWeekly";
import { useFreshStart } from "@/queries/use-fresh-start";
import { useDeleteStrategyFlow } from "@/components/admin/useDeleteStrategyFlow";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { ChevronDown } from "lucide-react";
import { useSending } from "@/queries/use-sending";
import { type SendingStrategy } from "@/components/admin/StrategyBetting";
import Link from "next/link";
import { PriceCheck } from "@/components/admin/PriceCheck";
import { usePriceCheck } from "@/queries/use-price-check";
import { useToday } from "@/queries/use-today";
import type { StrategyAdvice } from "@/server/engine-client";
import { AdviceRow } from "@/components/admin/Advice";
import { isLayRow, LaySection } from "@/components/admin/LaySection";
import { INACTIVE_DAYS, modeOf, ownMode, hasPicks, CheckResult, SAMPLE, Period, PERIODS, periodStart, SortBy, View, VIEWS, SORTS, sortValue } from "@/components/admin/strategies/strategy-parts";
import { StrategyCard } from "@/components/admin/strategies/StrategyCard";

export default function StrategiesPage() {
  const [period, setPeriod] = useState<Period>("ALL");
  const since = useMemo(() => periodStart(period), [period]);
  const { data, isLoading, error, isPlaceholderData } = useAdminStrategies(since);
  const merge = useMergeStrategy();
  const remove = useDeleteStrategyFlow();
  const sending = useSending();
  // Price check results by strategy, for each card's Ready for Live checklist (the same figures as the Price check box).
  const priceCheck = usePriceCheck(30, true);
  const checks = useMemo(() => {
    const m = new Map<string, CheckResult>();
    for (const r of priceCheck.data?.rows ?? []) {
      const k = r.strategy.toLowerCase();
      // Pre-match only: the in-play figures leave out every pick a goal settled within the 5 minutes, so the strategies
      // that win quickest look worst (Second Pour, the best Live strategy, shows about -17%). Not a fair verdict.
      if (r.kind === "ko") m.set(k, { picks: r.picks, vsTypical: r.edge, kickOff: true });
    }
    return m;
  }, [priceCheck.data]);
  // Today's suggestions, so each card says the same as Today (one set of rules, in the engine).
  const today = useToday();
  const allAdvice = useMemo<StrategyAdvice[]>(() => today.data?.advice ?? [], [today.data]);
  // Strategies with no alert for INACTIVE_DAYS (retired, or deleted in InPlayGuru) and not Live: listed apart.
  const [loadedAt] = useState(() => Date.now());
  const isInactive = (r: AdminStrategy) => !r.sendingOn && (!r.lastAlertAt || loadedAt - Date.parse(r.lastAlertAt) > INACTIVE_DAYS * 86_400_000);
  const names = useStrategyNames();
  const adviceOf = useMemo(() => new Map(allAdvice.filter((a) => a.kind !== "league-block").map((a) => [a.key.toLowerCase(), a])), [allAdvice]);
  const betOf = useMemo(() => {
    const map = new Map<string, SendingStrategy>();
    for (const s of sending.data?.strategies ?? []) map.set(s.label.toLowerCase(), s);
    return (label: string) => map.get(label.toLowerCase());
  }, [sending.data]);
  const ignore = useIgnoreStrategy();
  const removeMany = useDeleteStrategy();
  const dialog = useDialog();
  const { data: freshAt } = useFreshStart();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("adjusted");
  // Each card shows its own mode's figures (Live strategies their Live bets, Sim ones their Sim picks) unless one is chosen.
  const [view, setView] = useState<View>("own");
  // Weekly (the default): one row per strategy, £ week by week; Cards: the full card per strategy.
  const [layout, setLayout] = useState<"weekly" | "cards">("weekly");
  // Back bets, or the LAY section (lays bet against something, so they get their own view).
  const [side, setSide] = useState<"back" | "lay">("back");
  const [showOptions, setShowOptions] = useState(false);
  const weeksData = useStrategyWeeks();
  const strategies = useMemo(() => data?.strategies ?? [], [data]);
  const inactive = strategies.filter((r) => isInactive(r) && !isLayRow(r));
  const ignored = data?.ignored ?? [];

  const includesOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of strategies) {
      if (r.mergedInto) map.set(r.mergedInto.toLowerCase(), [...(map.get(r.mergedInto.toLowerCase()) ?? []), r.label]);
    }
    return map;
  }, [strategies]);

  function deleteStrategy(row: AdminStrategy) {
    void remove.run(row.label, { alerts: row.alerts, sent: row.sent });
  }

  const [bulkBusy, setBulkBusy] = useState(false);
  const busy = merge.isPending || remove.isPending || ignore.isPending || bulkBusy;
  const failed = merge.error ?? remove.error ?? ignore.error ?? removeMany.error;

  const deletable = strategies.filter((s) => !s.sendingOn);
  const toggle = (label: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  async function deleteSelected() {
    const chosen = strategies.filter((s) => picked.has(s.label) && !s.sendingOn);
    if (chosen.length === 0) return;
    const alerts = chosen.reduce((n, s) => n + s.alerts, 0);
    const sent = chosen.reduce((n, s) => n + s.sent, 0);
    const many = `${chosen.length} strateg${chosen.length === 1 ? "y" : "ies"}`;
    const ok = await dialog.confirm({
      title: `Delete ${many}?`,
      tone: "danger",
      confirmLabel: `Delete ${many}`,
      details: chosen.map((s) => ({ label: s.label, value: `${s.alerts} alert${s.alerts === 1 ? "" : "s"}` })),
      body: (
        <>
          <p>
            Their {alerts} saved alert{alerts === 1 ? "" : "s"} are deleted for good, so they disappear from the Dashboard, Live, Strategies, Trade
            Log and Profit.
          </p>
          {sent > 0 && (
            <p>
              <strong>{sent} were already sent to bet.</strong> Those are kept as records but taken out of every result and figure (unless sent in
              the last 2 hours).
            </p>
          )}
          <p>If one of these names ever arrives again, it will reappear.</p>
        </>
      ),
    });
    if (!ok) return;
    const includeSent =
      sent > 0 &&
      (await dialog.confirm({
        title: `Also delete the ${sent} sent record${sent === 1 ? "" : "s"}?`,
        tone: "danger",
        confirmLabel: `Delete ${sent} sent record${sent === 1 ? "" : "s"}`,
        cancelLabel: "Keep as records",
        body: <p>Deleting them makes these strategies disappear completely from every list. Records of picks sent today are kept until tomorrow.</p>,
      }));
    setBulkBusy(true);
    setBulkMessage(null);
    let done = 0;
    let removedAlerts = 0;
    try {
      for (const s of chosen) {
        const r = await removeMany.mutateAsync({ label: s.label, ignoreFuture: false, includeSent });
        removedAlerts += r.removed;
        done++;
      }
      setBulkMessage(`${done} strateg${done === 1 ? "y" : "ies"} deleted (${removedAlerts} alert${removedAlerts === 1 ? "" : "s"}).`);
      stopSelecting();
    } catch {
      setBulkMessage(`Stopped after ${done} of ${chosen.length}. See the error above, then try again.`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function clearIgnored() {
    if (ignored.length === 0) return;
    const ok = await dialog.confirm({
      title: "Clear the ignored list?",
      confirmLabel: `Stop ignoring ${ignored.length}`,
      body: (
        <>
          <ul className="list-disc pl-5 text-ink">
            {ignored.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p>New alerts with these names would be stored again. Only do this if they will never be used.</p>
        </>
      ),
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      for (const name of ignored) await ignore.mutateAsync({ label: name, ignored: false });
    } catch {
      // the error shows above; the rest stay on the list
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Strategies"
        subtitle={
          <>
            Each strategy&apos;s results and Live / Sim switch; tap one for its stake and limits. Overall limits are on{" "}
            <Link href="/more/admin/sending?tab=limits" className="text-accent underline">
              Betting
            </Link>
            .
          </>
        }
      />

      {/* Suggestions first, where they can't be missed: the same list as Today, each with Apply. */}
      {allAdvice.length > 0 && (
        <section aria-label="Suggestions" className="rounded-xl border-2 border-accent bg-accent/5 p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            Suggestions
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">{allAdvice.length}</span>
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">From each strategy&apos;s results since its rules last changed. Nothing changes until you press the button and confirm.</p>
          <ul className="mt-3 space-y-3 text-sm">
            {allAdvice.map((a) => (
              <AdviceRow key={`${a.key}:${a.kind}:${a.league?.key ?? ""}`} a={a} name={a.league ? `${names.name(a.key)} in ${a.league.name}` : names.name(a.key)} link={!!a.league} />
            ))}
          </ul>
        </section>
      )}

      <Segmented
        label="Bets"
        value={side}
        onChange={setSide}
        options={[
          { value: "back", label: "Back bets" },
          { value: "lay", label: `LAY bets${strategies.some(isLayRow) ? ` · ${strategies.filter(isLayRow).length}` : ""}` },
        ]}
      />

      {side === "lay" && data && <LaySection rows={strategies.filter(isLayRow)} all={strategies} betOf={betOf} settings={sending.data?.settings} bank={sending.data?.bank} />}

      {/* The view switches sit behind one button on every screen (27 Oct 2026 tidy-up), with what's chosen written on it, so the strategies come first. */}
      {side !== "lay" && (
        <button
          type="button"
          aria-expanded={showOptions}
          onClick={() => setShowOptions((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5 text-left text-xs font-medium text-ink"
        >
          <span className="min-w-0 truncate">
            {showOptions ? "Hide view options" : "View options"}
            {!showOptions && (
              <span className="font-normal text-ink-muted">
                {" "}
                · {layout === "weekly" ? "Weekly" : `Cards, ${PERIODS.find((p) => p.value === period)?.label ?? period}`} · {VIEWS.find((v) => v.value === view)?.label ?? view} · by {SORTS.find((s) => s.value === sortBy)?.label ?? sortBy}
              </span>
            )}
          </span>
          <ChevronDown size={14} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${showOptions ? "rotate-180" : ""}`} />
        </button>
      )}
      <div className={`flex-wrap items-center gap-3 ${side === "lay" ? "hidden" : showOptions ? "flex" : "hidden"}`}>
        <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ value: "weekly", label: "Weekly" }, { value: "cards", label: "Cards" }]} />
        {layout === "cards" && <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />}
        <Segmented label="Whose figures" value={view} onChange={setView} options={VIEWS} />
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          Sort by
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Sort strategies by">
            {SORTS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={sortBy === o.value}
                onClick={() => setSortBy(o.value)}
                className={`rounded px-2.5 py-1 font-medium ${sortBy === o.value ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface-2"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {period !== "ALL" && (
        <p className={`text-xs text-ink-muted ${isPlaceholderData ? "animate-pulse" : ""}`}>
          {period === "YTD" ? "Since 1 January" : period === "1D" ? "Today (since midnight)" : `Last ${period === "7D" ? "7 days" : "30 days"}`} only. Figures from
          fewer than {SAMPLE} priced picks are faded. Suggestions (the same as on Today) use their own windows, whatever the period here; the equity curve is always all time.
        </p>
      )}

      {data && strategies.length > 0 && <PriceCheck />}

      {/* Deleting several at once is rare: its button lives with the view options, and stays out once you're mid-selection. */}
      {data && strategies.length > 0 && (showOptions || selecting) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              disabled={bulkBusy}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              {selecting ? "Cancel" : "Select several to delete"}
            </button>
            {selecting && (
              <>
                <button
                  type="button"
                  onClick={() => setPicked(new Set(deletable.map((s) => s.label)))}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                >
                  Select all
                </button>
                {freshAt && (
                  <button
                    type="button"
                    onClick={() => setPicked(new Set(deletable.filter((s) => s.alertsSince === 0).map((s) => s.label)))}
                    className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                  >
                    Select unused since fresh start
                  </button>
                )}
                <button type="button" onClick={() => setPicked(new Set())} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2">
                  Select none
                </button>
              </>
            )}
          </div>
          {selecting && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-2.5">
              <p className="text-xs text-ink">
                {picked.size} selected
                {strategies.some((s) => s.sendingOn) && <span className="text-ink-muted"> · Live ones can’t be picked</span>}
              </p>
              <button
                type="button"
                disabled={picked.size === 0 || bulkBusy}
                onClick={() => void deleteSelected()}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-danger-ink disabled:opacity-40"
              >
                {bulkBusy ? "Deleting…" : `Delete ${picked.size || ""} selected`.replace("  ", " ")}
              </button>
            </div>
          )}
          {bulkMessage && <p className="text-xs text-ink">{bulkMessage}</p>}
        </div>
      )}

      {side === "lay" ? null : error ? (
        <QueryError error={error} next="/more/admin/strategies" />
      ) : isLoading || !data ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : strategies.length === 0 && ignored.length === 0 ? (
        <p className="text-sm text-ink-muted">Strategies appear here once alerts arrive.</p>
      ) : (
        <>
          {failed && <p className="rounded-md border border-line bg-surface p-2 text-xs text-destructive">{failed.message}</p>}
          {(["live", "sim"] as const).map((m) => {
            // Best first by the chosen figure (in the section's own mode), so what to act on is at the top and bottom.
            const valueOf = (r: AdminStrategy) => sortValue(r, view === "own" ? ownMode(r).mode : m, sortBy) ?? -Infinity;
            const group = strategies
              .filter((r) => modeOf(r) === m && !isLayRow(r) && !isInactive(r))
              .sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label));
            if (group.length === 0) return null;
            const renderCard = (r: AdminStrategy) => (
              <StrategyCard
                key={r.label}
                row={r}
                mode={view === "own" ? ownMode(r).mode : view}
                ownView={view === "own"}
                borrowed={view === "own" && ownMode(r).borrowed}
                all={strategies}
                sortBy={sortBy}
                includes={includesOf.get(r.label.toLowerCase()) ?? []}
                busy={busy}
                selecting={selecting}
                selected={picked.has(r.label)}
                onToggle={() => toggle(r.label)}
                onMerge={(into) => merge.mutate({ from: r.label, into })}
                onDelete={() => deleteStrategy(r)}
                bet={betOf(r.label)}
                settings={sending.data?.settings}
                bank={sending.data?.bank}
                check={checks.get(r.label.toLowerCase())}
                advice={adviceOf.get(r.label.toLowerCase())}
                last7={weeksData.data?.strategies[r.label.toLowerCase()]?.last7[view === "own" ? ownMode(r).mode : view]}
                prev28={weeksData.data?.strategies[r.label.toLowerCase()]?.prev28[view === "own" ? ownMode(r).mode : view]}
              />
            );
            const byKey = new Map(group.map((r) => [r.label.toLowerCase(), r]));
            return (
              <section key={m} className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {m === "live" ? "Live strategies" : "Simulation strategies"}{" "}
                    <span className="text-sm font-normal text-ink-muted">· {group.length}</span>
                  </h3>
                  <p className="text-xs text-ink-muted">{m === "live" ? "Bet with real money." : "Recorded as if bet; no money placed."}</p>
                </div>
                {layout === "weekly" ? (
                  <StrategyWeekly
                    rows={group}
                    data={weeksData.data}
                    modeOf={(label) => (label === "__all__" ? (view === "own" ? "all" : view) : view === "own" ? ownMode(byKey.get(label.toLowerCase())!).mode : view)}
                    renderCard={(key) => (byKey.has(key) ? renderCard(byKey.get(key)!) : null)}
                    showTotal={m === "sim"}
                    // The "each row is its own mode" note once, on the first section shown, not repeated on both.
                    showHelp={m === "live" || !strategies.some((r) => modeOf(r) === "live" && !isLayRow(r) && !isInactive(r))}
                    sliceLabels={Object.fromEntries(strategies.flatMap((x) => (x.returns?.segments ?? []).map((s) => [`${x.label.toLowerCase()}#${s.id}`, s.label])))}
                  />
                ) : (
                <ul className="space-y-2">{group.filter((r) => hasPicks(r, m)).map(renderCard)}</ul>
                )}
                {/* No alert for 14 days (retired or deleted in InPlayGuru): out of the way, record kept. */}
                {m === "sim" && inactive.length > 0 && (
                  <details className="rounded-xl border border-line bg-surface p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      Inactive <span className="font-normal text-ink-muted">· {inactive.length} · no alerts for {INACTIVE_DAYS}+ days</span>
                    </summary>
                    <ul className="mt-2 space-y-2">{inactive.map(renderCard)}</ul>
                  </details>
                )}
                {layout === "cards" && group.some((r) => !hasPicks(r, m)) && (
                  <details className="rounded-xl border border-line bg-surface p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      No data yet <span className="font-normal text-ink-muted">· {group.filter((r) => !hasPicks(r, m)).length}</span>
                    </summary>
                    <p className="mt-1 text-xs text-ink-muted">Nothing settled in this period, so there is no return to rank.</p>
                    <ul className="mt-2 space-y-2">{group.filter((r) => !hasPicks(r, m)).map(renderCard)}</ul>
                  </details>
                )}
              </section>
            );
          })}

          {ignored.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">Ignored strategies</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">New alerts with these names are dropped on arrival, so they never come back.</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearIgnored()}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-destructive hover:bg-surface-2 disabled:opacity-50"
                >
                  Clear list
                </button>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {ignored.map((name) => (
                  <li key={name} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 break-words text-sm text-ink">{name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => ignore.mutate({ label: name, ignored: false })}
                      className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      Stop ignoring
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

