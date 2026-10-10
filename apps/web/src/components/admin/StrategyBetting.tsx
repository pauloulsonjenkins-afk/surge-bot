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

const SENDABLE = new Set(["OVER_1_5", "NEXT_GOAL", "BOTH_TEAMS_TO_SCORE", "UNDERDOG_DOUBLE_CHANCE", "FAVOURITE_TO_WIN", "FIRST_HALF_GOALS", "AWAY_WIN_LAY"]);

/** A strategy that LAYS (Away Win Lay): its stake is the liability, and it has a maximum lay price, not minimum odds. */
const isLay = (s: SendingStrategy) => s.market === "AWAY_WIN_LAY";

/** Whether this strategy's market can be bet (some need a Betfair market code set under Sending > Bet wording first). */
export function canBet(s: SendingStrategy, settings: SendingSettings): boolean {
  return (
    s.market !== null &&
    (SENDABLE.has(s.market) ||
      (s.market === "FIRST_HALF_CORNERS" && !!settings.firstHalfCornersMarketType) ||
      (s.market === "FAVOURITE_TO_SCORE" && !!settings.favouriteScoresHomeMarketType && !!settings.favouriteScoresAwayMarketType))
  );
}

/** "£2.00", or "2% of balance (£5.00 now)" for a percentage stake. */
export function stakeText(s: SendingStrategy): string | null {
  if (s.stakePct != null) return s.stakeNow != null ? `${s.stakePct}% of balance (£${s.stakeNow.toFixed(2)} now)` : `${s.stakePct}% of balance`;
  return s.stake !== null ? `£${s.stake.toFixed(2)}` : null;
}

const hasStake = (s: SendingStrategy) => s.stake !== null || s.stakePct != null;

/** "Next goal · £2.00 · min odds 1.50 · stop loss set", or why it can't be bet. */
export function betSummary(s: SendingStrategy, settings: SendingSettings): { text: string; warn: boolean } {
  if (!s.market) return { text: "No market set", warn: true };
  // A lay: the stake is the liability (the most one bet can lose), capped by a maximum lay price.
  if (isLay(s)) {
    const hasStop = s.stopLoss !== null && (s.stopLoss.dailyLoss !== null || s.stopLoss.lossRun !== null);
    const parts = [marketName(s.market), stakeText(s) ? `${stakeText(s)} liability` : "No liability set yet", s.maxLayOdds != null ? `max lay ${s.maxLayOdds.toFixed(2)}` : null, hasStop ? "stop loss set" : null];
    return { text: parts.filter(Boolean).join(" · "), warn: !hasStake(s) };
  }
  if (!canBet(s, settings)) return { text: "Can't be bet yet: set its market under Sending → Bet wording", warn: true };
  const hasStop = s.stopLoss !== null && (s.stopLoss.dailyLoss !== null || s.stopLoss.lossRun !== null);
  const parts = [
    marketName(s.market),
    stakeText(s) ?? "No stake yet",
    s.minOdds !== null ? `min odds ${s.minOdds.toFixed(2)}` : null,
    hasStop ? "stop loss set" : null,
    settings.modelFilter?.[s.label.toLowerCase()] ? "goal model filter on" : null,
  ];
  return { text: parts.filter(Boolean).join(" · "), warn: !hasStake(s) };
}

/**
 * The goal model filter for a next-goal strategy: when on, a pick only goes ahead if the goal model rates it 3+ points
 * above what Betfair's price needs (Results > Goal model). Off by default; meant to be turned on once the model has
 * proved itself in shadow (you get a notification). Works in Sim too, so its effect can be watched first.
 */
function ModelFilterSwitch({ s, settings }: { s: SendingStrategy; settings: SendingSettings }) {
  const save = useSaveSending();
  const dialog = useDialog();
  const names = useStrategyNames();
  const key = s.label.toLowerCase();
  const on = settings.modelFilter?.[key] === true;
  async function set(next: boolean) {
    if (next === on) return;
    if (next) {
      const ok = await dialog.confirm({
        title: `Turn the goal model filter on for ${names.name(s.label)}?`,
        tone: "money",
        confirmLabel: "Turn the filter on",
        body: (
          <>
            <p>
              From now on, this strategy&apos;s next-goal picks only go ahead when the goal model rates them 3+ points above what the price needs. The rest are
              held back and show why under Skipped (in Sim, as not placed).
            </p>
            <p>Only do this once the model has proved itself in shadow: check Results → Goal model, or wait for the notification. You can turn it off any time.</p>
          </>
        ),
      });
      if (!ok) return;
    }
    save.mutate({ modelFilter: { [key]: next } });
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-2.5 py-2">
      <span className="text-xs text-ink-muted">
        <span className="font-medium text-ink">Goal model filter</span> · only bet picks the model rates above the price.{" "}
        <a href="/more/admin/goal-model" className="text-accent underline">
          Is it proved?
        </a>
      </span>
      <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label={`Goal model filter for ${names.name(s.label)}`}>
        {(
          [
            [false, "Off"],
            [true, "On"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={on === v}
            disabled={save.isPending}
            onClick={() => void set(v)}
            className={`rounded px-2.5 py-1 text-xs font-medium ${on === v ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface-2"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The highest price a lay strategy lays at: laying high risks a lot to win a little. */
function MaxLayPrice({ s }: { s: SendingStrategy }) {
  const save = useSaveSending();
  const key = s.label.toLowerCase();
  const saved = s.maxLayOdds != null ? s.maxLayOdds.toFixed(2) : "";
  const [v, setV] = useState<string | undefined>();
  const shown = v ?? saved;
  const dirty = v !== undefined && v.trim() !== saved;
  const [err, setErr] = useState<string | null>(null);
  function set() {
    const raw = (v ?? "").trim();
    if (raw === "") {
      setErr(null);
      save.mutate({ maxLayOdds: { [key]: null } }, { onSuccess: () => setV(undefined) });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1.01 || n > 100) return setErr("Enter a price such as 6.0.");
    setErr(null);
    save.mutate({ maxLayOdds: { [key]: n } }, { onSuccess: () => setV(undefined) });
  }
  return (
    <label className="text-xs text-ink-muted">
      Maximum lay price
      <div className="mt-1 flex gap-1.5">
        <input inputMode="decimal" placeholder="none" className={inputCls} value={shown} onChange={(e) => setV(e.target.value)} />
        {dirty && (
          <button type="button" onClick={set} disabled={save.isPending} className="rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink disabled:opacity-50">
            {v!.trim() === "" ? "Clear" : "Set"}
          </button>
        )}
      </div>
      {err && <span className="mt-1 block text-destructive">{err}</span>}
      {!dirty && <span className="mt-1 block">{s.maxLayOdds != null ? `Never lays above ${s.maxLayOdds.toFixed(2)}.` : "Optional, but recommended (e.g. 6.0)."}</span>}
    </label>
  );
}

export function LiveSimSwitch({ s, settings }: { s: SendingStrategy; settings: SendingSettings }) {
  const save = useSaveSending();
  const dialog = useDialog();
  const names = useStrategyNames();
  const key = s.label.toLowerCase();
  const supported = canBet(s, settings);
  const canGoLive = supported && hasStake(s) && !save.isPending;

  function confirmLive(): Promise<boolean> {
    const stake = s.stakeNow ?? s.stake ?? 0;
    const stop = s.stopLoss;
    const hasStop = stop !== null && (stop.dailyLoss !== null || stop.lossRun !== null);
    return dialog.confirm({
      title: `Put ${names.name(s.label)} Live?`,
      tone: "money",
      confirmLabel: s.stakePct != null ? `Put Live at ${s.stakePct}% of balance` : `Put Live at £${stake.toFixed(2)}`,
      details: [
        isLay(s)
          ? { label: "Liability per bet (most it can lose)", value: stakeText(s) ?? `£${stake.toFixed(2)}` }
          : { label: "Stake per bet", value: stakeText(s) ?? `£${stake.toFixed(2)}` },
        isLay(s)
          ? { label: "Maximum lay price", value: s.maxLayOdds != null ? s.maxLayOdds.toFixed(2) : <span className="text-warn">None set</span> }
          : { label: "Minimum odds", value: s.minOdds !== null ? s.minOdds.toFixed(2) : "None" },
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
          {isLay(s) && (
            <p>
              These are LAY bets: each one wins a small amount on a home win or draw, and loses the full liability if the away side wins. They are placed only
              by GoalBrew&apos;s direct betting, so Sending → Betting on Betfair must be Live.
            </p>
          )}
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
        title={!supported ? "This strategy can't be bet yet, so it stays in Sim" : !hasStake(s) ? "Set a stake before going Live" : undefined}
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
export function BetSettings({ s, settings, bank }: { s: SendingStrategy; settings: SendingSettings; bank?: SendingState["bank"] }) {
  const save = useSaveSending();
  const key = s.label.toLowerCase();
  const supported = canBet(s, settings);
  // A flat £ stake or a percentage of the Betfair balance; saving one replaces the other.
  const [mode, setMode] = useState<"flat" | "pct">(s.stakePct != null ? "pct" : "flat");
  const [pct, setPct] = useState<string | undefined>();
  const savedPct = s.stakePct != null ? String(s.stakePct) : "";
  const pctShown = pct ?? savedPct;
  const pctDirty = pct !== undefined && pct.trim() !== savedPct;
  const savedStake = s.stakePct == null && s.stake !== null ? s.stake.toFixed(2) : "";
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

  function savePct() {
    const n = Number((pct ?? "").trim().replace(/%$/, ""));
    if (!Number.isFinite(n) || n < 0.1 || n > 25) return setError("Enter a percentage between 0.1 and 25, for example 1 or 2.5.");
    setError(null);
    save.mutate({ stakePct: { [key]: n } }, { onSuccess: () => setPct(undefined) });
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
        <div className="text-xs text-ink-muted">
          <div className="flex items-center justify-between gap-2">
            <span>Stake</span>
            <div role="group" aria-label="Stake type" className="inline-flex gap-0.5 rounded-md border border-line bg-surface p-0.5">
              {(["flat", "pct"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${mode === m ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"}`}
                >
                  {m === "flat" ? "£" : "% of balance"}
                </button>
              ))}
            </div>
          </div>
          {mode === "flat" ? (
            <>
              <div className="mt-1 flex gap-1.5">
                <input aria-label="Stake in pounds" inputMode="decimal" placeholder="0.00" className={inputCls} value={stakeShown} onChange={(e) => setStake(e.target.value)} />
                {stakeDirty && (
                  <button type="button" onClick={saveStake} disabled={save.isPending} className="rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink disabled:opacity-50">
                    Set
                  </button>
                )}
              </div>
              {s.stakePct != null && !stakeDirty && <span className="mt-1 block">Currently {s.stakePct}% of balance. Setting a £ amount replaces it.</span>}
              {!stakeDirty && !hasStake(s) && <span className="mt-1 block text-warn">Needed to go Live, and for Sim profit</span>}
            </>
          ) : (
            <>
              <div className="mt-1 flex items-center gap-1.5">
                <input aria-label="Stake as a percentage of the balance" inputMode="decimal" placeholder="e.g. 1" className={inputCls} value={pctShown} onChange={(e) => setPct(e.target.value)} />
                <span className="text-sm text-ink-muted">%</span>
                {pctDirty && (
                  <button type="button" onClick={savePct} disabled={save.isPending} className="rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink disabled:opacity-50">
                    Set
                  </button>
                )}
              </div>
              <span className="mt-1 block">
                {bank?.total != null
                  ? `Balance £${bank.total.toFixed(2)}${bank.at ? `, read ${new Date(bank.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}` : ""}.`
                  : "Betfair balance not read yet."}
                {(() => {
                  const n = Number(pctShown);
                  if (!bank?.total || !Number.isFinite(n) || n <= 0) return null;
                  const raw = Math.round(((bank.total * n) / 100) * 100) / 100;
                  const capped = raw > settings.maxStake;
                  return <span className="text-ink"> {n}% = £{(capped ? settings.maxStake : raw).toFixed(2)}{capped ? ` (held to your £${settings.maxStake} limit)` : ""}{raw < 1 ? ", below Betfair's £1 minimum" : ""} per bet now.</span>;
                })()}
              </span>
              {s.stakePct == null && !pctDirty && s.stake !== null && <span className="mt-1 block">Currently a flat £{s.stake.toFixed(2)}. Setting a percentage replaces it.</span>}
              <span className="mt-1 block">Worked out when each bet is placed from the balance then; bets already placed keep their stake. Your highest-stake limit still applies.</span>
            </>
          )}
        </div>
        {supported && isLay(s) && <MaxLayPrice s={s} />}
        {supported && !isLay(s) && (
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
      {supported && isLay(s) && (
        <p className="text-xs text-ink-muted">
          The stake is the <strong className="text-ink">liability</strong>: the most one bet can lose (if the away side wins). A win pays about liability ÷ (price −
          1), e.g. £5 at 4.50 wins £1.43. Betfair needs a lay stake of at least £1, so at 4.50 the liability must be at least £3.50.
        </p>
      )}
      {supported && !isLay(s) && (
        <p className="text-xs text-ink-muted">
          {s.minOdds !== null ? `Only bet at odds of ${s.minOdds.toFixed(2)} or better. Applies to new picks.` : "Minimum odds are optional: no bet is placed below this price."}
        </p>
      )}
      {supported && <StopLossControls status={s.stopLoss} busy={save.isPending} onSave={(patch) => save.mutate({ stopLoss: { [key]: patch } })} />}
      {supported && s.market === "NEXT_GOAL" && <ModelFilterSwitch s={s} settings={settings} />}
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
