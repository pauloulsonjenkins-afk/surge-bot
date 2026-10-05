"use client";

import { useMembersAction } from "@/queries/use-members";
import type { StrategyItem } from "@/lib/members/types";
import { btn, btnPrimary } from "./ui";

/** Follow a strategy in simulation (bets placed automatically on each alert), or stop following. */
export default function FollowControl({ s }: { s: Pick<StrategyItem, "key" | "name" | "following"> }) {
  const follow = useMembersAction("follow");
  const on = Boolean(s.following);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={follow.isPending}
        onClick={() => follow.mutate(on ? { strategy: s.key, off: true } : { strategy: s.key, mode: "sim", auto: true })}
        className={on ? btn : btnPrimary}
        aria-label={on ? `Stop following ${s.name}` : `Follow ${s.name} in simulation`}
      >
        {on ? (s.following?.mode === "live" ? "Following · Live" : "Following · Sim") : "Follow (sim)"}
      </button>
      {follow.error && <span className="max-w-[14rem] text-right text-xs text-destructive">{follow.error.message}</span>}
    </span>
  );
}
