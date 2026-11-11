"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import { useDialog } from "@/components/ui/ConfirmDialog";
import type { StrategyAdvice } from "@/server/engine-client";
import { ClashSummary } from "@/components/admin/ClashSummary";
import { ClampedText } from "@/components/ui/ClampedText";
import { tidyText } from "@/lib/format";

/**
 * Strategy suggestions (strategy-advice.ts in the engine): shown on Today and on Strategies, each with its own Apply.
 * Nothing changes until Apply is pressed and confirmed, since it changes real-money betting.
 */
export const ADVICE_LABEL: Record<StrategyAdvice["kind"], string> = {
  "try-live": "ready to try Live",
  "back-to-sim": "consider putting back to Sim",
  "stake-up": "worth a bigger stake",
  "stake-down": "worth a smaller stake",
  "league-block": "losing in one league",
  "slice-live": "slice ready to try Live",
  "slice-sim": "slice losing: consider Sim",
  "slice-stake-up": "slice worth a bigger stake",
  "slice-stake-down": "slice worth a smaller stake",
};

/** A suggestion that would bet more (go Live, a bigger stake), as against one that would bet less. */
export const isGoodAdvice = (a: StrategyAdvice) => a.kind === "try-live" || a.kind === "stake-up" || a.kind === "slice-live" || a.kind === "slice-stake-up";

/** What to call a suggestion: a slice's own name, a league stop's strategy in its league, else the strategy. */
export const adviceTitle = (a: StrategyAdvice, strategyName: (key: string) => string) => a.name ?? (a.league ? `${strategyName(a.key)} in ${a.league.name}` : strategyName(a.key));

/** The Apply button for one suggestion: asks first, then shows what was done. */
export function ApplyAdvice({ a, name, size = "sm" }: { a: StrategyAdvice; name: string; size?: "sm" | "md" }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [done, setDone] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/advice/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: a.key, kind: a.kind, expect: { to: (a as { to?: unknown }).to ?? null }, ...(a.league ? { league: a.league.key } : {}) }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't apply that.");
    },
    onSuccess: () => {
      setDone(a.action ?? "Done");
      void qc.invalidateQueries();
    },
  });
  if (!a.action) return null;
  if (done) return <span className="shrink-0 text-xs text-hit">Done: {done}</span>;
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={apply.isPending}
        onClick={async (e) => {
          e.stopPropagation();
          const body = (
            <>
              <p>{tidyText(a.reason)}</p>
              {a.kind === "try-live" && <ClashSummary strategyKey={a.key} />}
              {a.kind === "slice-live" && a.slice && <ClashSummary strategyKey={a.slice.strategyKey} compact />}
            </>
          );
          if (await dialog.confirm({ title: `${name}: ${a.action}?`, tone: "money", confirmLabel: a.action!, body })) apply.mutate();
        }}
        className={`rounded-md bg-accent font-semibold text-accent-ink disabled:opacity-50 ${size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"}`}
      >
        {apply.isPending ? "Applying…" : a.action}
      </button>
      {apply.error && <span className="text-xs text-destructive">{apply.error.message}</span>}
    </span>
  );
}

/** One suggestion in a list: who, what, why, and Apply. */
export function AdviceRow({ a, name, link = true }: { a: StrategyAdvice; name: string; link?: boolean }) {
  const good = isGoodAdvice(a);
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      {/* On a phone the text gets the full width and the two buttons sit on their own row under it. */}
      <span className="min-w-0 flex-1 basis-full sm:basis-0">
        {link ? (
          <Link href={a.league ? "/more/admin/leagues?tab=profit" : "/more/admin/strategies"} className="font-medium text-ink underline decoration-line">
            {name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{name}</span>
        )}{" "}
        <span className={good ? "text-hit" : "text-warn"}>{ADVICE_LABEL[a.kind]}</span>
        {/* Two lines, the rest a tap away: on a phone a long reason pushed everything else down a screen. */}
        <ClampedText text={tidyText(a.reason)} lines={2} className="block text-xs text-ink-muted" />
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <IgnoreAdvice a={a} />
        <ApplyAdvice a={a} name={name} />
      </span>
    </li>
  );
}

const snoozeBody = (a: StrategyAdvice, hours: number) => JSON.stringify({ key: a.key, kind: a.kind, hours, ...(a.league ? { league: a.league.key } : {}) });

/**
 * "Ignore for 24 hours" (owner, 8 Nov 2026): sets this suggestion aside, changing nothing. It comes back by itself after a
 * day, or from the "ignored" line under the list.
 */
export function IgnoreAdvice({ a }: { a: StrategyAdvice }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/advice/snooze", { method: "POST", headers: { "Content-Type": "application/json" }, body: snoozeBody(a, 24) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't ignore it.");
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
  return (
    <button
      type="button"
      onClick={() => run.mutate()}
      disabled={run.isPending}
      title="Hide this suggestion for 24 hours. Nothing changes."
      className="inline-flex min-h-9 items-center rounded-md border border-line px-2.5 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
    >
      {run.isPending ? "…" : "Ignore 24h"}
    </button>
  );
}

const untilFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" });

/** The suggestions set aside for now, folded to one line, each with "Show again". Nothing when there are none. */
export function IgnoredAdvice({ nameOf }: { nameOf: (a: StrategyAdvice) => string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["advice-snoozed"],
    queryFn: ({ signal }) => getJson<{ snoozed?: Array<StrategyAdvice & { until: string }> }>("/api/admin/advice", "ignored suggestions", signal),
    staleTime: 30_000,
  });
  const back = useMutation({
    mutationFn: async (a: StrategyAdvice) => {
      await fetch("/api/admin/advice/snooze", { method: "POST", headers: { "Content-Type": "application/json" }, body: snoozeBody(a, 0) });
    },
    onSuccess: () => void qc.invalidateQueries(),
  });
  const list = q.data?.snoozed ?? [];
  if (list.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="min-h-9 cursor-pointer text-ink-muted hover:text-ink">
        <span className="flex-1">
          {list.length} ignored for now
        </span>
      </summary>
      <ul className="space-y-1.5 pb-1">
        {list.map((a) => (
          <li key={`${a.key}:${a.kind}:${a.league?.key ?? ""}`} className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-ink-muted">
              <span className="text-ink">{nameOf(a)}</span> · {ADVICE_LABEL[a.kind]} · back {untilFmt.format(new Date(a.until))}
            </span>
            <button type="button" onClick={() => back.mutate(a)} className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-surface-2">
              Show again
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Applies every suggestion in the list in one go, after showing exactly what each would do. Only worth showing for two or
 * more. League stops are not part of it (each changes where a strategy bets, so each is worth a look).
 */
export function ApplyAllAdvice({ advice, nameOf }: { advice: StrategyAdvice[]; nameOf: (a: StrategyAdvice) => string }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const list = advice.filter((a) => a.kind !== "league-block" && a.action);
  const [result, setResult] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/advice/apply-all", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { applied?: unknown[]; failed?: Array<{ error: string }>; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't apply them.");
      return body;
    },
    onSuccess: (body) => {
      const failed = body.failed?.length ?? 0;
      setResult(`${body.applied?.length ?? 0} applied${failed > 0 ? `, ${failed} no longer applied` : ""}.`);
      void qc.invalidateQueries();
    },
  });
  if (list.length < 2) return null;
  if (result) return <p className="text-xs font-medium text-hit">{result}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={run.isPending}
        onClick={async () => {
          const ok = await dialog.confirm({
            title: `Apply all ${list.length} suggestions?`,
            tone: "money",
            confirmLabel: `Apply all ${list.length}`,
            details: list.map((a) => ({ label: nameOf(a), value: a.action! })),
            body: <p>This changes real-money betting: strategies and slices going Live or back to Sim, and stakes. Each one is the same change its own Apply button makes. League stops are left out.</p>,
          });
          if (ok) run.mutate();
        }}
        className="inline-flex min-h-9 items-center rounded-md border border-line px-3 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        {run.isPending ? "Applying…" : `Apply all ${list.length}`}
      </button>
      {run.error && <span className="text-xs text-destructive">{run.error.message}</span>}
    </div>
  );
}
