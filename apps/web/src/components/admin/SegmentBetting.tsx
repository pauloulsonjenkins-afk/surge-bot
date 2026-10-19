"use client";

import { useState } from "react";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { SegmentLabel } from "@/components/ui/SegmentLabel";
import { useSaveSending, type SendingSettings } from "@/queries/use-sending";

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
  const [pct, setPct] = useState(cfg?.stakePct != null ? String(cfg.stakePct) : "");
  const name = segment.label.replace(/ since .*$/, "");
  const live = cfg ? cfg.live === true : strategyLive;

  async function setLive(next: boolean) {
    if (next) {
      const stake = pct.trim() ? `${pct.trim()}% of the balance` : "the strategy's stake";
      const ok = await dialog.confirm({
        title: `Bet ${name} alerts Live?`,
        tone: "money",
        confirmLabel: "Bet them Live",
        body: (
          <p>
            {strategyName}&apos;s {name} alerts will be bet with real money at {stake}, whether {strategyName} itself is Live or in Sim. Your highest stake,
            match limit, daily loss stop and its stop loss still apply.
          </p>
        ),
      });
      if (!ok) return;
    }
    const n = Number(pct);
    save.mutate({ segmentBets: { [key]: { live: next, stakePct: pct.trim() && Number.isFinite(n) && n > 0 ? n : null } } });
  }

  return (
    <div className="rounded-md bg-surface-2 p-2.5 text-xs">
      <p className="font-medium text-ink">
        Bet <SegmentLabel label={name} /> alerts separately
      </p>
      <p className="mt-0.5 text-ink-muted">
        {cfg
          ? `${live ? "Live" : "Sim"}${cfg.stakePct != null ? ` at ${cfg.stakePct}% of the balance` : cfg.stake != null ? ` at £${cfg.stake}` : " at the strategy's stake"}, whatever ${strategyName} itself is set to.`
          : `Following ${strategyName} (${strategyLive ? "Live" : "Sim"}, its stake). Set its own switch and stake here.`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-ink-muted">
          Stake
          <input
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            inputMode="decimal"
            placeholder="strategy's"
            className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-ink"
            aria-label={`${name} stake, % of the balance`}
          />
          % of balance
        </label>
        <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label={`${name}: Sim or Live`}>
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={cfg !== null && live === v}
              disabled={save.isPending}
              onClick={() => void setLive(v)}
              className={`rounded px-2.5 py-1 font-medium ${cfg !== null && live === v ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface"}`}
            >
              {v ? "Live" : "Sim"}
            </button>
          ))}
        </div>
        {cfg && (
          <button type="button" disabled={save.isPending} onClick={() => save.mutate({ segmentBets: { [key]: null } })} className="rounded-md border border-line px-2.5 py-1 font-medium text-ink">
            Follow the strategy
          </button>
        )}
      </div>
      {live && cfg && (
        <p className="mt-1 text-ink-muted">Safety: goes back to Sim by itself if it stops being Golden, or its own Live bets lose more than 5% per £1 over 30+ bets.</p>
      )}
      {save.error && <p className="mt-1 text-destructive">{save.error.message}</p>}
    </div>
  );
}
