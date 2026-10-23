"use client";

import { useId, useState } from "react";
import { ClashSummary } from "@/components/admin/ClashSummary";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { SegmentLabel } from "@/components/ui/SegmentLabel";
import { useSaveSending, type SendingSettings } from "@/queries/use-sending";
import { useGolden } from "@/queries/use-golden";

/** The stake range this box accepts, % of the balance (the engine allows up to 25%; nothing here is meant to go near that). */
const MIN_PCT = 0.1;
const MAX_PCT = 10;

/** The stake box's text as a stake: null = the strategy's own stake (left empty), undefined = not a usable number. */
export function parseStake(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= MIN_PCT && n <= MAX_PCT ? Math.round(n * 100) / 100 : undefined;
}

/**
 * Bet a watched slice on its own (e.g. Second Pour's Golden alerts): its own Live / Sim switch and stake (% of the
 * balance). "Follow the strategy" removes it, so the slice is bet like the rest of the strategy again.
 */
export function SegmentBetting({
  strategyKey,
  strategyName,
  segment,
  settings,
  strategyLive,
}: {
  strategyKey: string;
  strategyName: string;
  segment: { id: string; label: string };
  settings: SendingSettings;
  strategyLive: boolean;
}) {
  const key = `${strategyKey}#${segment.id}`;
  const cfg = settings.segmentBets?.[key] ?? null;
  const save = useSaveSending();
  const dialog = useDialog();
  const golden = useGolden();
  const statusId = useId();
  const [pct, setPct] = useState(cfg?.stakePct != null ? String(cfg.stakePct) : "");
  const [bad, setBad] = useState(false);
  const name = segment.label.replace(/ since .*$/, "");
  const live = cfg ? cfg.live === true : strategyLive;
  const sliceStatus = golden.data?.slices.find((s) => s.strategyKey === strategyKey && s.id === segment.id)?.status ?? null;
  const safety = golden.data?.safety;
  const savedPct = cfg?.stakePct != null ? String(cfg.stakePct) : "";
  const stakeChanged = pct.trim() !== savedPct;
  const stakeText = (p: number | null) => (p != null ? `${p}% of the balance` : "the strategy's stake");

  /** The stake typed in, or undefined (with the box marked) when it isn't one this box accepts. */
  function readStake(): number | null | undefined {
    const p = parseStake(pct);
    setBad(p === undefined);
    return p;
  }

  async function setLive(next: boolean) {
    const p = readStake();
    if (p === undefined) return;
    if (next) {
      const ok = await dialog.confirm({
        title: `Bet ${name} alerts Live?`,
        tone: "money",
        confirmLabel: "Bet them Live",
        body: (
          <>
            <p>
              {strategyName}&apos;s {name} alerts will be bet with real money at {stakeText(p)}, whether {strategyName} itself is Live or in Sim. Your highest stake,
              match limit, daily loss stop and its stop loss still apply.
            </p>
            <p className="text-xs text-ink-muted">For all of {strategyName}&apos;s picks (this slice is a part of them):</p>
            <ClashSummary strategyKey={strategyKey} compact />
          </>
        ),
      });
      if (!ok) return;
    }
    save.mutate({ segmentBets: { [key]: { live: next, stakePct: p } } });
  }

  /** Saves a new stake and keeps the slice Live or Sim as it is now (asking first when it bets real money). */
  async function saveStake() {
    const p = readStake();
    if (p === undefined) return;
    if (live) {
      const ok = await dialog.confirm({
        title: `Change the ${name} stake?`,
        tone: "money",
        confirmLabel: `Bet at ${p != null ? `${p}%` : "the strategy's stake"}`,
        body: (
          <p>
            {strategyName}&apos;s {name} alerts are bet with real money. New ones will be bet at {stakeText(p)}. Your highest stake, match limit, daily loss stop and its
            stop loss still apply.
          </p>
        ),
      });
      if (!ok) return;
    }
    // Without its own setting yet, the slice keeps doing what its strategy does (Live or Sim), now at this stake.
    save.mutate({ segmentBets: { [key]: cfg ? { stakePct: p } : { live: strategyLive, stakePct: p } } });
  }

  /** Arrow keys move between Sim and Live, as in any radio group. */
  function onArrow(e: React.KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = !(cfg !== null && live);
    void setLive(next);
    const group = e.currentTarget as HTMLElement;
    group.querySelectorAll<HTMLButtonElement>("[role=radio]")[next ? 1 : 0]?.focus();
  }

  return (
    <div className="rounded-md bg-surface-2 p-2.5 text-xs">
      <p className="font-medium text-ink">
        Bet <SegmentLabel label={name} status={sliceStatus} /> alerts separately
      </p>
      <p id={statusId} className="mt-0.5 text-ink-muted">
        {cfg
          ? `${live ? "Live" : "Sim"}${cfg.stakePct != null ? ` at ${cfg.stakePct}% of the balance` : cfg.stake != null ? ` at £${cfg.stake}` : " at the strategy's stake"}, whatever ${strategyName} itself is set to.`
          : `Following ${strategyName} (${strategyLive ? "Live" : "Sim"}, its stake). Set its own switch and stake here.`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-ink-muted">
          Stake
          <input
            value={pct}
            onChange={(e) => {
              setPct(e.target.value);
              setBad(false);
            }}
            inputMode="decimal"
            placeholder="strategy's"
            aria-invalid={bad || undefined}
            className={`w-20 rounded-md border bg-surface px-2 py-1 text-ink ${bad ? "border-destructive" : "border-line"}`}
            aria-label={`${name} stake, % of the balance`}
          />
          % of balance
        </label>
        {stakeChanged && (
          <button type="button" disabled={save.isPending} onClick={() => void saveStake()} className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-ink disabled:opacity-40">
            Save stake
          </button>
        )}
        <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label={`${name}: Sim or Live`} aria-describedby={statusId} onKeyDown={onArrow}>
          {([false, true] as const).map((v) => {
            const checked = cfg !== null && live === v;
            // One stop in the tab order: the chosen option, or Sim while neither is chosen (following the strategy).
            const tabStop = checked || (cfg === null && !v);
            return (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={tabStop ? 0 : -1}
                disabled={save.isPending}
                onClick={() => void setLive(v)}
                className={`rounded px-2.5 py-1 font-medium ${checked ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface"}`}
              >
                {v ? "Live" : "Sim"}
              </button>
            );
          })}
        </div>
        {cfg && (
          <button type="button" disabled={save.isPending} onClick={() => save.mutate({ segmentBets: { [key]: null } })} className="rounded-md border border-line px-2.5 py-1 font-medium text-ink">
            Follow the strategy
          </button>
        )}
      </div>
      {bad && (
        <p className="mt-1 text-destructive">
          Enter a stake from {MIN_PCT}% to {MAX_PCT}% of the balance, or leave it empty for the strategy&apos;s stake.
        </p>
      )}
      {live && cfg && (
        <p className="mt-1 text-ink-muted">
          Safety: goes back to Sim by itself if it stops being Golden, or its own Live bets lose more than {Math.abs((safety?.worstRoi ?? -0.05) * 100)}% per £1 over{" "}
          {safety?.minBets ?? 30}+ bets.
        </p>
      )}
      {save.error && <p className="mt-1 text-destructive">{save.error.message}</p>}
    </div>
  );
}
