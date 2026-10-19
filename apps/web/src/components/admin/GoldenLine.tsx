"use client";

import { useGolden } from "@/queries/use-golden";
import { useSending } from "@/queries/use-sending";
import { SegmentLabel } from "@/components/ui/SegmentLabel";
import { strategyKey } from "@/queries/use-strategy-names";
import type { PublicPick } from "@/server/engine-client";

/**
 * Under a Golden alert on Live (admin): which slice it's in, that slice's status, and in plain words what happens to
 * it: bet as Golden at its own stake, bet with its strategy, or Sim only.
 */
export function GoldenLine({ pick }: { pick: PublicPick }) {
  const golden = useGolden();
  const sending = useSending(60_000);
  const key = strategyKey(pick.strategy);
  const settings = sending.data?.settings;
  return (
    <>
      {(pick.segments ?? []).map((seg) => {
        const slice = golden.data?.slices.find((s) => s.strategyKey === key && s.id === seg.id);
        const cfg = settings?.segmentBets?.[`${key}#${seg.id}`] ?? null;
        const strategyLive = !!settings?.enabled && settings.strategies[key] === true;
        const stakeOf = () => {
          const p = settings?.stakePct[key];
          const f = settings?.stakes[key];
          return p != null ? `${p}%` : f != null ? `£${f}` : "its stake";
        };
        const what = cfg
          ? cfg.live
            ? `Bet as Golden: Live at ${cfg.stakePct != null ? `${cfg.stakePct}%` : cfg.stake != null ? `£${cfg.stake}` : stakeOf()}`
            : "Golden set to Sim: not bet"
          : strategyLive
            ? `Bet with its strategy at ${stakeOf()}`
            : "Sim only: not bet";
        const status = !slice
          ? "being watched"
          : slice.status === "golden"
            ? "confirmed Golden"
            : slice.status === "not holding up"
              ? "not holding up"
              : `candidate, ${slice.slice.all.counted} of ${golden.data?.confirmFrom ?? 50}`;
        return (
          <p key={seg.id} className="text-xs text-ink-muted">
            <SegmentLabel label={seg.label} /> · {status} · <span className={cfg?.live || (!cfg && strategyLive) ? "font-medium text-ink" : ""}>{what}</span>
          </p>
        );
      })}
    </>
  );
}
