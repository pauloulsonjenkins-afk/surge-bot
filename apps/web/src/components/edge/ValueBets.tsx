"use client";

/**
 * Best Value Cuppa's picks that can still be bet, each with a stake and a Bet button. Bet hands the pick to GoalBrew's
 * direct betting, which places it on Betfair with every usual check (minimum odds, spread, a stale price, the daily
 * stake limit, the highest-stake limit, not after kick-off) and shows how it went on Betting → Bets. Admin only.
 */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import { useDialog } from "@/components/ui/ConfirmDialog";
import type { BettableValuePick } from "@/server/engine-client";

const KEY = ["value-bets"];
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" });

export function ValueBets({ withinHours, empty }: { withinHours?: number; empty?: string }) {
  // Fixed when the box opens (the list refreshes every minute anyway).
  const [now] = useState(() => Date.now());
  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => getJson<{ picks: BettableValuePick[] }>("/api/admin/edge/bettable", "the value bets", signal),
    refetchInterval: 60_000,
  });
  if (error) return <p className="text-xs text-destructive">{error.message}</p>;
  if (!data) return null;
  const cutoff = withinHours ? now + withinHours * 3_600_000 : Infinity;
  const picks = data.picks.filter((p) => Date.parse(p.kickoff) <= cutoff);
  if (picks.length === 0) return empty ? <p className="text-xs text-ink-muted">{empty}</p> : null;
  return (
    <ul className="divide-y divide-line">
      {picks.map((p) => (
        <Row key={p.id} p={p} />
      ))}
    </ul>
  );
}

function Row({ p }: { p: BettableValuePick }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [stake, setStake] = useState("1");
  const bet = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/edge/bet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pickId: p.id, stake: Number(stake) }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; picks?: BettableValuePick[] };
      if (!res.ok) throw new Error(body.error ?? "Couldn't place that.");
      return body;
    },
    onSuccess: (body) => qc.setQueryData(KEY, { picks: body.picks ?? [] }),
  });
  const s = p.sent;
  const status = !s
    ? null
    : s.state === "placed" && (s.matched ?? 0) > 0
      ? `Matched £${s.matched!.toFixed(2)}${s.avgPrice ? ` at ${s.avgPrice.toFixed(2)}` : ""}`
      : s.state === "failed"
        ? `Not placed: ${s.reason ?? "refused"}`
        : s.reason ?? "Sent to bet: placing…";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">
          {p.home} v {p.away}
        </span>
        <span className="block text-xs text-ink-muted">
          {time.format(new Date(p.kickoff))} · {p.league} · <span className="text-ink">{p.selection}</span> · {p.price.toFixed(2)} when found
        </span>
        <span className="block text-xs text-ink-muted">{p.trend}</span>
        {bet.error && <span className="block text-xs text-destructive">{bet.error.message}</span>}
      </span>
      {s ? (
        <Link href="/more/admin/sending" className={`shrink-0 text-xs underline ${s.state === "failed" ? "text-warn" : "text-hit"}`}>
          {status}
        </Link>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-ink-muted">£</span>
          <input
            aria-label="Stake in pounds"
            type="number"
            inputMode="decimal"
            min={1}
            step={0.5}
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="w-16 rounded-md border border-line bg-surface-2 px-2 py-1 text-sm tabular-nums text-ink"
          />
          <button
            type="button"
            disabled={bet.isPending || !(Number(stake) >= 1)}
            onClick={async () => {
              const ok = await dialog.confirm({
                title: `Bet £${Number(stake).toFixed(2)} on ${p.selection}?`,
                tone: "money",
                confirmLabel: `Bet £${Number(stake).toFixed(2)}`,
                body: (
                  <p>
                    {p.home} v {p.away}, kick-off {time.format(new Date(p.kickoff))}. GoalBrew places it on Betfair at the best price on offer, with its usual checks
                    (it waits if the price has dropped too far). {p.price.toFixed(2)} when found.
                  </p>
                ),
              });
              if (ok) bet.mutate();
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
          >
            {bet.isPending ? "Sending…" : "Bet"}
          </button>
        </span>
      )}
    </li>
  );
}
