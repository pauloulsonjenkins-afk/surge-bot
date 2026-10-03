"use client";

import { Segmented } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { useMe } from "@/queries/use-me";
import { useUiStore } from "@/state/ui.store";
import type { PickMode } from "@/server/engine-client";

export const MODE_LABEL: Record<PickMode, string> = { all: "All", live: "Live", sim: "Sim" };

/**
 * The mode the figures are shown in. For the admin it is the All / Live / Sim choice; everyone else always
 * sees every alert ("all"), because which picks were bet is private.
 */
export function usePickMode(): PickMode {
  const { data: me } = useMe();
  const mode = useUiStore((s) => s.pickMode);
  return me?.admin ? mode : "all";
}

/** All / Live / Sim. Shown to the admin only; the choice is shared by the Dashboard, Win/Loss and Strategies. */
export function ModeToggle({ className = "" }: { className?: string }) {
  const { data: me } = useMe();
  const mode = useUiStore((s) => s.pickMode);
  const setMode = useUiStore((s) => s.setPickMode);
  if (!me?.admin) return null;
  return (
    <Segmented
      label="Live or simulation"
      value={mode}
      onChange={setMode}
      className={className}
      options={[
        { value: "live", label: "Live" },
        { value: "sim", label: "Sim" },
        { value: "all", label: "All" },
      ]}
    />
  );
}

/**
 * A small label for a pick or strategy: Live (money was staked), Sim (recorded only), or Not placed (sent, never bet).
 * Live is a mode, not a result, so it isn't green (green and red are kept for money and results): it gets the brand dot.
 */
export function ModeBadge({ mode }: { mode: "live" | "sim" | "notPlaced" }) {
  if (mode === "notPlaced") return <Chip tone="warn">Not placed</Chip>;
  return mode === "live" ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
      Live
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-line px-2 py-0.5 text-xs font-medium text-ink-muted">
      Sim
    </span>
  );
}
