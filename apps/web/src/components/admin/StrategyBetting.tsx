"use client";

import { useState } from "react";
import { marketName } from "@/lib/markets";
import { StopLossControls } from "@/components/admin/StopLossControls";
import { useSaveSending, type SendingSettings, type SendingState } from "@/queries/use-sending";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useStrategyNames } from "@/queries/use-strategy-names";

/**
 * One strategy's betting controls, shown on the Strategies page: the Live / Sim switch, and (when opened) its stake,
 * minimum odds and stop loss. The settings that apply to every strategy (the master switch, safety limits, bet
 * wording) stay on Sending.
 */
export type SendingStrategy = SendingState["strategies"][number];

const SENDABLE = new Set(["OVER_1_5", "NEXT_GOAL", "BOTH_TEAMS_TO_SCORE", "UNDERDOG_DOUBLE_CHANCE", "FAVOURITE_TO_WIN", "FIRST_HALF_GOALS"]);

/** Whether this strategy's market can be bet (some need a Betfair market code set under Sending > Bet wording first). */
export function canBet(s: SendingStrategy, settings: SendingSettings): boolean {
  return (
    s.market !== null &&
    (SENDABLE.has(s.market) ||
      (s.market === "FIRST_HALF_CORNERS" && !!settings.firstHalfCornersMarketType) ||
      (s.market === "FAVOURITE_TO_SCORE" && !!settings.favouriteScoresHomeMarketType && !!settings.favouriteScoresAwayMarketType))
  );
}

/** "Next goal · £2.00 · min odds 1.50 · stop loss set", or why it can't be bet. */
export function betSummary(s: SendingStrategy, settings: SendingSettings): { text: string; warn: boolean } {
  if (!s.market) return { text: "No market set", warn: true };
  if (!canBet(s, settings)) return { text: "Can't be bet yet: set its market under Sending → Bet wording", warn: true };
  const hasStop = s.stopLoss !== null && (s.stopLoss.dailyLoss !== null || s.stopLoss.lossRun !== null);
  const parts = [marketName(s.market), s.stake !== null ? `£${s.stake.toFixed(2)}` : "No stake yet", s.minOdds !== null ? `min odds ${s.minOdds.toFixed(2)}` : null, hasStop ? "stop loss set" : null];
  return { text: parts.filter(Boolean).join(" · "), warn: s.stake === null };
}

export function LiveSimSwitch({ s, settings }: { s: SendingStrategy; settings: SendingSettings }) {
  const save = useSaveSending();
  const dialog = useDialog();
  const names = useStrategyNames();
  const key = s.label.toLowerCase();
  const supported = canBet(s, settings);
  const canGoLive = supported && s.stake !== null && !save.isPending;

  function confirmLive(): Promise<boolean> {
    const stake = s.stake ?? 0;
    const stop = s.stopLoss;
    const hasStop = stop !== null && (stop.dailyLoss !== null || stop.lossRun !== null);
    return dialog.confirm({
      title: `Put ${names.name(s.label)} Live?`,
      tone: "money",
      confirmLabel: `Put Live at £${stake.toFixed(2)}`,
      details: [
        { label: "Stake per bet", value: `£${stake.toFixed(2)}` },
        { label: "Minimum odds", value: s.minOdds !== null ? s.minOdds.toFixed(2) : "None" },
        { label: "Daily limit (all strategies)", value: `${settings.dailyCap} bets, up to £${(stake * settings.dailyCap).toFixed(2)}` },
        {
          label: "Stop loss",
          value: hasStop ? (
            [stop.dailyLoss !== null ? `down £${stop.dailyLoss.toFixed(2)}` : null, stop.lossRun !== null ? `${stop.lossRun} losses in a row` : null].filter(Boolean).join(" or ")
          ) : (
            <span className="text-warn">None set</span>
          ),
        },
      ],
      body: (
        <>
          <p>Its new picks will be bet with real money{settings.enabled ? "" : " once betting is switched on (Sending)"}.</p>
          {!hasStop && (
            <p>
              <strong>No stop loss is set.</strong> Open this strategy and set one first if it should stop after a bad day.
            </p>
          )}
        </>
      ),
    });
  }

  return (
    <div className="shrink-0">
      <div
        role="radiogroup"
        aria-label={`${names.name(s.label)}: live or simulation`}
        title={!supported ? "This strategy can't be bet yet, so it stays in Sim" : s.stake === null ? "Set a stake before going Live" : undefined}
        className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
      >
        {([false, true] as const).map((live) => {
          const selected = s.enabled === live;
          return (
            <button
              key={String(live)}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={selected || (live && !canGoLive) || save.isPending}
              onClick={async () => {
                if (live && !(await confirmLive())) return;
                save.mutate({ strategies: { [key]: live } });
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default ${
                selected ? (live ? "bg-accent text-accent-ink" : "bg-surface text-ink shadow-sm") : "text-ink-muted hover:text-ink disabled:opacity-40"
              }`}
            >
              {live ? "Live" : "Sim"}
            </button>
          );
        })}
      </div>
      {save.error && <p className="mt-1 max-w-[12rem] text-xs text-destructive">{save.error.message}</p>}
    </div>
  );
}

const inputCls = "w-full rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink";

/** Stake, minimum odds and stop loss for one strategy. */
export function BetSettings({ s, settings }: { s: SendingStrategy; settings: SendingSettings }) {
  const save = useSaveSending();
  const key = s.label.toLowerCase();
  const supported = canBet(s, settings);
  const savedStake = s.stake !== null ? s.stake.toFixed(2) : "";
  const savedMin = s.minOdds !== null ? s.minOdds.toFixed(2) : "";
  const [stake, setStake] = useState<string | undefined>();
  const [min, setMin] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const stakeShown = stake ?? savedStake;
  const minShown = min ?? savedMin;
  const stakeDirty = stake !== undefined && stake.trim() !== savedStake;
  const minDirty = min !== undefined && min.trim() !== savedMin;

  function saveStake() {
    const raw = (stake ?? "").trim().replace(/^£/, "");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) return setError("Enter a stake above zero, for example 2 or 2.50.");
    if (n > settings.maxStake) return setError(`That is above your highest stake allowed (£${settings.maxStake}). Raise that limit on Sending first if you really mean it.`);
    setError(null);
    save.mutate({ stakes: { [key]: n } }, { onSuccess: () => setStake(undefined) });
  }

  function saveMin() {
    const raw = (min ?? "").trim();
    if (raw === "") {
      setError(null);
      save.mutate({ minOdds: { [key]: null } }, { onSuccess: () => setMin(undefined) });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1.01 || n > 1000) return setError("Enter minimum odds between 1.01 and 1000, for example 1.85. Leave the box empty for no minimum.");
    setError(null);
    save.mutate({ minOdds: { [key]: n } }, { onSuccess: () => setMin(undefined) });
  }

  return (
    <div className="space-y-3 rounded-lg bg-surface-2/60 p-2.5">
      <p className="text-xs font-medium text-ink">Bet settings</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
      {!supported && <p className="text-xs text-warn">{betSummary(s, settings).text}. It stays in Sim until then.</p>}
      <div className="grid grid-cols-2 gap-3">
        {/* The stake is asked for every strategy: Sim profit is priced at it even where the market can't be bet. */}
        <label className="text-xs text-ink-muted">
          Stake (£)
          <div className="mt-1 flex gap-1.5">
            <input inputMode="decimal" placeholder="0.00" className={inputCls} value={stakeShown} onChange={(e) => setStake(e.target.value)} />
            {stakeDirty && (
              <button type="button" onClick={saveStake} disabled={save.isPending} className="rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink disabled:opacity-50">
                Set
              </button>
            )}
          </div>
          {!stakeDirty && s.stake === null && <span className="mt-1 block text-warn">Needed to go Live, and for Sim profit</span>}
        </label>
        {supported && (
          <label className="text-xs text-ink-muted">
            Minimum odds
            <div className="mt-1 flex gap-1.5">
              <input inputMode="decimal" placeholder="none" className={inputCls} value={minShown} onChange={(e) => setMin(e.target.value)} />
              {minDirty && (
                <button type="button" onClick={saveMin} disabled={save.isPending} className="rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink disabled:opacity-50">
                  {min!.trim() === "" ? "Clear" : "Set"}
                </button>
              )}
            </div>
          </label>
        )}
      </div>
      {supported && (
        <p className="text-xs text-ink-muted">
          {s.minOdds !== null ? `Only bet at odds of ${s.minOdds.toFixed(2)} or better. Applies to new picks.` : "Minimum odds are optional: no bet is placed below this price."}
        </p>
      )}
      {supported && <StopLossControls status={s.stopLoss} busy={save.isPending} onSave={(patch) => save.mutate({ stopLoss: { [key]: patch } })} />}
      {/* In Sim, the same limits run on the simulated bets, so they can be tuned before going Live. */}
      {!s.enabled && s.simStopLoss && (
        <p className={`rounded-md bg-surface px-2.5 py-1.5 text-xs ${s.simStopLoss.stopped ? "text-warn" : "text-ink-muted"}`}>
          In Sim today: {s.simStopLoss.todayNet < 0 ? "−" : ""}£{Math.abs(s.simStopLoss.todayNet).toFixed(2)} from {s.simStopLoss.settledToday} bet
          {s.simStopLoss.settledToday === 1 ? "" : "s"}
          {s.simStopLoss.todayRun > 0 && `, ${s.simStopLoss.todayRun} loss${s.simStopLoss.todayRun === 1 ? "" : "es"} in a row`}.{" "}
          {s.simStopLoss.stopped ? `If it were Live it would have stopped: ${s.simStopLoss.reason} Its later picks today are recorded as not placed.` : "It hasn't reached either limit."}
        </p>
      )}
      {s.enabled && s.stopLoss?.stopped && <p className="text-xs text-warn">Stopped today by its stop loss.</p>}
    </div>
  );
}
