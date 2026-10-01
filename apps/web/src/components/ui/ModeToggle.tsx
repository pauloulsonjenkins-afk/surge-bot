"use client";

import { Segmented } from "@/components/ui/Card";
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

/** A small label for a pick or strategy: Live (money was staked), Sim (recorded only), or Not placed (sent, never bet). */
export function ModeBadge({ mode }: { mode: "live" | "sim" | "notPlaced" }) {
  if (mode === "notPlaced") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">Not placed</span>
    );
  }
  return mode === "live" ? (
    <span className="inline-flex shrink-0 items-center rounded-full bg-hit/15 px-2 py-0.5 text-xs font-medium text-hit">Live</span>
  ) : (
    <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-line px-2 py-0.5 text-xs font-medium text-ink-muted">
      Sim
    </span>
  );
}
