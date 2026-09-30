"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, PageHeader } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { WinLossLines, gbp, type LineSeries } from "@/components/admin/WinLossLines";
import { DailyPnlChart } from "@/components/admin/DailyPnlChart";
import { marketName } from "@/lib/markets";
import { useSaveSending } from "@/queries/use-sending";
import { useSaveWinLoss, useWinLoss, type WinLossState } from "@/queries/use-winloss";
import { ModeToggle, usePickMode } from "@/components/ui/ModeToggle";
import type { PickMode } from "@/server/engine-client";

type PeriodKey = "d1" | "d7" | "mtd" | "ytd";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "d1", label: "1D" },
  { key: "d7", label: "7D" },
  { key: "mtd", label: "MTD" },
  { key: "ytd", label: "YTD" },
];

// Distinct on both the light and dark themes.
const PALETTE = ["#d98a00", "#0fa37f", "#3f7ce0", "#a266d9", "#d6497a", "#2ea3b5"];

const inputCls = "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink";

function Money({ value, className = "" }: { value: number; className?: string }) {
  const tone = value > 0 ? "text-hit" : value < 0 ? "text-loss" : "text-ink-muted";
  return <span className={`tabular-nums ${tone} ${className}`}>{value === 0 ? "\u00a30.00" : gbp(value)}</span>;
}

/** One line of figures: a name, then the 1D / 7D / MTD / YTD amounts in four equal cells. */
function Figures({ title, values, bold, muted }: { title: string; values: Array<number | null>; bold?: boolean; muted?: boolean }) {
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <p className={`text-sm ${bold ? "font-medium text-ink" : muted ? "text-ink-muted" : "text-ink"}`}>{title}</p>
      <div className="mt-1.5 grid grid-cols-4 gap-2">
        {PERIODS.map((p, i) => {
          const v = values[i];
          return (
            <div key={p.key}>
              <p className="text-xs uppercase tracking-wide text-ink-muted">{p.label}</p>
              {v === null || v === undefined ? (
                <p className="text-xs text-ink-muted">{"\u2013"}</p>
              ) : muted ? (
                <p className="text-xs tabular-nums text-ink-muted">{gbp(v)}</p>
              ) : (
                <Money value={v} className={`text-xs ${bold ? "font-medium" : ""}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function dateLabel(l: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(l)
    ? new Date(`${l}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : l;
}

function monthName(ym: string): string {
  return new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function WinLossPage() {
  const mode = usePickMode();
  const { data, isLoading, error } = useWinLoss(mode);

  if (error) return <QueryError error={error} next="/more/admin/winloss" />;
  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <WinLoss state={data} mode={mode} />;
}

const MODE_NOTE: Record<PickMode, string> = {
  all: "Every settled pick, bet or not.",
  live: "Live: only picks that were sent to your betting software, at the stake they were sent with.",
  sim: "Sim: only picks that were recorded but not sent, priced at each strategy's stake as if they had been.",
};

function WinLoss({ state, mode }: { state: WinLossState; mode: PickMode }) {
  const qc = useQueryClient();
  const saveSending = useSaveSending();
  const saveWinLoss = useSaveWinLoss(mode);
  const [period, setPeriod] = useState<PeriodKey>("mtd");
  const [stakeDraft, setStakeDraft] = useState<Record<string, string>>({});
  const [oddsDraft, setOddsDraft] = useState<Record<string, string>>({});
  const [commission, setCommission] = useState(String(state.settings.commission));
  const [monthly, setMonthly] = useState(String(state.settings.expenditure.monthly));
  const [startMonth, setStartMonth] = useState(state.settings.expenditure.startMonth ?? "");
  const [message, setMessage] = useState<string | null>(null);
  // Which strategy rows are opened up to edit.
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) =>
    setOpenRows((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const ex = state.settings.expenditure;
  // `strategies` are the originals (their stake and odds are settings). `lines` are what the figures and graph show,
  // with merged strategies added together. An engine that isn't updated yet has no `reported`, so fall back to the originals.
  const strategies = state.strategies;
  const lines = state.reported ?? strategies;

  // Keep the expenditure boxes in step with what the engine has saved (e.g. the start month it filled in on first tick).
  useEffect(() => {
    setMonthly(String(ex.monthly));
    setStartMonth(ex.startMonth ?? "");
  }, [ex.monthly, ex.startMonth]);

  const anyMoney = strategies.some((s) => s.counted > 0);
  const points = state.series[period];
  // The monthly cost is a real cost: it comes off Live and All, never Sim.
  const costsApply = ex.enabled && mode !== "sim";
  const showAfter = costsApply && (period === "mtd" || period === "ytd");

  const combinedSeries: LineSeries[] = showAfter
    ? [
        { key: "total", name: "Before expenditure", color: "var(--ink-muted)", dashed: true },
        { key: "after", name: "After expenditure", color: "var(--chart)" },
      ]
    : [{ key: "total", name: "Profit / loss", color: "var(--chart)" }];
  const combinedData = points.map((p) => ({ label: dateLabel(p.label), total: p.total, after: p.totalAfter }));

  const strategySeries: LineSeries[] = lines.map((s, i) => ({ key: `k${i}`, name: s.label, color: PALETTE[i % PALETTE.length]! }));
  const strategyData = points.map((p) => {
    const row: Record<string, number | string> = { label: dateLabel(p.label) };
    lines.forEach((s, i) => (row[`k${i}`] = p.s[s.key] ?? 0));
    return row;
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["winloss"] });
    qc.invalidateQueries({ queryKey: ["sending"] });
  }

  function setStake(key: string) {
    const n = Number((stakeDraft[key] ?? "").replace(/^\u00a3/, ""));
    if (!Number.isFinite(n) || n <= 0 || n > 500) {
      setMessage("Enter a stake above zero, for example 2 or 2.50.");
      return;
    }
    setMessage(null);
    saveSending.mutate(
      { stakes: { [key]: n } },
      {
        onSuccess: () => {
          setStakeDraft((d) => {
            const c = { ...d };
            delete c[key];
            return c;
          });
          refresh();
        },
      },
    );
  }

  function setOdds(key: string) {
    const n = Number(oddsDraft[key] ?? "");
    if (!Number.isFinite(n) || n < 1.01 || n > 1000) {
      setMessage("Enter decimal odds of 1.01 or more, for example 1.85.");
      return;
    }
    setMessage(null);
    saveWinLoss.mutate(
      { assumedOdds: { [key]: n } },
      {
        onSuccess: () =>
          setOddsDraft((d) => {
            const c = { ...d };
            delete c[key];
            return c;
          }),
      },
    );
  }

  const expenditureRows = costsApply;

  return (
    <div className="space-y-3">
      <PageHeader
        as="h2"
        title="Win / Loss"
        subtitle={
          <>
          An estimate in pounds, from the odds printed in each alert and the stake set for its strategy. It is not taken
          from the bets your betting software actually matched, so expect small differences from your real account.
          </>
        }
      />

      <div className="space-y-1.5">
        <ModeToggle />
        <p className="text-xs text-ink-muted">{MODE_NOTE[mode]}</p>
      </div>

      {message && <p className="text-sm text-destructive">{message}</p>}
      {(saveSending.error || saveWinLoss.error) && (
        <p className="text-sm text-destructive">{(saveSending.error ?? saveWinLoss.error)?.message}</p>
      )}

      {/* ---- figures ---- */}
      <Card title="Profit and loss" subtitle="Settled picks only. Today, last 7 days, month to date and year to date.">
        {lines.length === 0 ? (
          <EmptyState
            title={mode === "live" ? "No live picks settled yet" : mode === "sim" ? "No simulation picks settled yet" : "Nothing settled yet"}
            detail="Figures appear once picks have results."
          />
        ) : (
          <div>
            {lines.map((s) => (
              <Figures key={s.key} title={s.label} values={PERIODS.map((p) => state.periods[p.key].strategies[s.key] ?? 0)} />
            ))}
            <Figures
              title={mode === "live" ? "Live total" : mode === "sim" ? "Sim total" : "Total"}
              bold
              values={PERIODS.map((p) => state.periods[p.key].total)}
            />
            {expenditureRows && (
              <>
                <Figures
                  title="Expenditure"
                  muted
                  values={PERIODS.map((p) => (state.periods[p.key].expenditure > 0 ? -state.periods[p.key].expenditure : null))}
                />
                <Figures title="Total after expenditure" bold values={PERIODS.map((p) => state.periods[p.key].totalAfter)} />
              </>
            )}
          </div>
        )}
        {lines.length > 0 && !anyMoney && (
          <p className="mt-3 text-xs text-warn">
            No pick has both a stake and odds yet, so every figure is £0.00. Set a stake (and odds where the alert has
            none) under Strategies below.
          </p>
        )}
      </Card>

      {/* ---- daily performance: one bar per day, this month ---- */}
      {state.mtdDaily && (
        <Card title="Daily performance" subtitle="Month to date · P&L per day">
          {state.mtdDaily.every((d) => d.pnl === 0) ? (
            <EmptyState title="Nothing settled this month yet" detail="A bar appears for each day once picks have a stake, odds and a result." />
          ) : (
            <DailyPnlChart days={state.mtdDaily} />
          )}
        </Card>
      )}

      {/* ---- graphs ---- */}
      <div role="tablist" aria-label="Graph period" className="inline-flex gap-1 rounded-lg border border-line bg-surface p-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={period === p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${period === p.key ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Card title="Overall" subtitle="All strategies combined, running total.">
        {points.length < 2 ? (
          <EmptyState title="Nothing to draw yet" detail="A line appears once there are results with a stake and odds in this period." />
        ) : (
          <WinLossLines data={combinedData} series={combinedSeries} />
        )}
        {ex.enabled && (period === "d1" || period === "d7") && (
          <p className="mt-2 text-xs text-ink-muted">Expenditure is monthly, so it only shows on the MTD and YTD views.</p>
        )}
      </Card>

      <Card title="By strategy" subtitle="One line per strategy, running total.">
        {points.length < 2 ? (
          <EmptyState title="Nothing to draw yet" detail="A line appears once there are results with a stake and odds in this period." />
        ) : (
          <WinLossLines data={strategyData} series={strategySeries} />
        )}
      </Card>

      {/* ---- inputs ---- */}
      <Card
        title="Strategies"
        subtitle="Tap a strategy to set the stake and, where an alert carries no odds, the odds to assume. Rows needing attention are marked."
      >
        {strategies.length === 0 ? (
          <p className="text-xs text-ink-muted">Strategies appear here once they have settled picks this year.</p>
        ) : (
          <ul className="divide-y divide-line">
            {strategies.map((s) => {
              const stakeShown = stakeDraft[s.key] ?? (s.stake !== null ? s.stake.toFixed(2) : "");
              const stakeDirty = stakeDraft[s.key] !== undefined && stakeDraft[s.key]!.trim() !== (s.stake !== null ? s.stake.toFixed(2) : "");
              const oddsShown = oddsDraft[s.key] ?? (s.assumedOdds !== null ? s.assumedOdds.toFixed(2) : "");
              const oddsDirty = oddsDraft[s.key] !== undefined && oddsDraft[s.key]!.trim() !== (s.assumedOdds !== null ? s.assumedOdds.toFixed(2) : "");
              const needsOdds = s.market !== "NEXT_GOAL" || s.noOdds > 0 || s.assumedOdds !== null;
              const overMax = s.stake !== null && s.stake > state.maxStake;
              const isOpen = openRows.has(s.key);
              const leftOut = s.noStake + s.noOdds;
              const summary = [
                s.stake !== null ? `£${s.stake.toFixed(2)}` : null,
                s.assumedOdds !== null ? `odds ${s.assumedOdds.toFixed(2)}` : null,
                `${s.counted} of ${s.settled} counted`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={s.key} className="py-2.5">
                  <button type="button" onClick={() => toggleRow(s.key)} aria-expanded={isOpen} className="flex w-full items-center gap-2 text-left">
                    <span className={`shrink-0 text-xs text-ink-muted transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                      ▸
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{s.label}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {marketName(s.market) ?? "No market set"} · {summary}
                      </span>
                    </span>
                    {leftOut > 0 && (
                      <span className="shrink-0 rounded-full bg-warn px-2 py-0.5 text-xs font-medium text-warn-ink">{leftOut} left out</span>
                    )}
                  </button>

                  {isOpen && (
                  <div className="pl-5">
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-2 text-xs text-ink-muted">
                      <span className="whitespace-nowrap">Stake £</span>
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-20 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink"
                        value={stakeShown}
                        onChange={(e) => setStakeDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      />
                      {stakeDirty && (
                        <button type="button" onClick={() => setStake(s.key)} className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink">
                          Set
                        </button>
                      )}
                    </label>

                    {needsOdds && (
                      <label className="flex items-center gap-2 text-xs text-ink-muted">
                        <span className="whitespace-nowrap">Odds if none in alert</span>
                        <input
                          inputMode="decimal"
                          placeholder="1.85"
                          className="w-16 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink"
                          value={oddsShown}
                          onChange={(e) => setOddsDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                        />
                        {oddsDirty && (
                          <button type="button" onClick={() => setOdds(s.key)} className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink">
                            Set
                          </button>
                        )}
                      </label>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-ink-muted">
                    {s.counted} of {s.settled} settled picks this year counted
                    {s.usedAlertOdds > 0 ? ` (${s.usedAlertOdds} at the alert's own odds)` : ""}
                    {s.noStake > 0 ? ` · ${s.noStake} left out: no stake set` : ""}
                    {s.noOdds > 0 ? ` · ${s.noOdds} left out: no odds` : ""}
                    {(s.notPlaced ?? 0) > 0 ? ` · ${s.notPlaced} Sim pick${s.notPlaced === 1 ? "" : "s"} not placed (minimum odds, stop loss or daily limit)` : ""}
                  </p>
                  {overMax && (
                    <p className="mt-1 text-xs text-ink-muted">
                      This stake is above your highest stake allowed (£{state.maxStake}). It counts here, but a stake that high is never sent to bet.
                    </p>
                  )}
                  </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <span>Commission on winnings, %</span>
            <input
              inputMode="decimal"
              className="w-16 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
            {Number(commission) !== state.settings.commission && (
              <button
                type="button"
                onClick={() => saveWinLoss.mutate({ commission: Number(commission) })}
                className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
              >
                Save
              </button>
            )}
          </label>
          <p className="mt-1 text-xs text-ink-muted">Left at 0 unless you set it. Betfair takes commission from winning bets.</p>
        </div>
      </Card>

      {/* ---- expenditure: last, and off unless ticked ---- */}
      <Card title="Expenditure" subtitle="Your running costs, taken off the total so you can see if you are still profitable.">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={ex.enabled}
            disabled={saveWinLoss.isPending}
            onChange={(e) => saveWinLoss.mutate({ expenditure: { enabled: e.target.checked } })}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-sm text-ink">
            Include monthly expenditure
            <span className="block text-xs text-ink-muted">Off unless you tick it.</span>
          </span>
        </label>

        {ex.enabled && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-ink-muted">
                Cost per month (£)
                <input inputMode="decimal" className={`${inputCls} mt-1`} value={monthly} onChange={(e) => setMonthly(e.target.value)} />
              </label>
              <label className="text-xs text-ink-muted">
                Starting from
                <input type="month" className={`${inputCls} mt-1`} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
              </label>
            </div>
            {(Number(monthly) !== ex.monthly || startMonth !== (ex.startMonth ?? "")) && (
              <button
                type="button"
                disabled={saveWinLoss.isPending}
                onClick={() => saveWinLoss.mutate({ expenditure: { monthly: Number(monthly), ...(startMonth ? { startMonth } : {}) } })}
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
              >
                Save
              </button>
            )}
            <p className="text-xs text-ink-muted">
              {gbp(-ex.monthly, false)} is taken off on the 1st of every month
              {ex.startMonth ? `, starting ${monthName(ex.startMonth)}` : ""}. Month to date:{" "}
              <span className="tabular-nums text-ink">{gbp(-state.periods.mtd.expenditure, false)}</span>. Year to date:{" "}
              <span className="tabular-nums text-ink">{gbp(-state.periods.ytd.expenditure, false)}</span>. It applies to the MTD and
              YTD figures only.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
