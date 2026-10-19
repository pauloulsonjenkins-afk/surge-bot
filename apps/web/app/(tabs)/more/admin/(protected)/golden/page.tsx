"use client";

import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { SegmentLabel, GOLD } from "@/components/ui/SegmentLabel";
import { useGolden, useGoldenAction, type GoldenSlice, type GoldenSuggestion } from "@/queries/use-golden";
import type { StrategyReturn } from "@/server/engine-client";

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const pct = (n: number | null | undefined) => (n == null ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n * 1000) / 10)}%`);
const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-ink" : n > 0 ? "text-hit" : "text-loss");

function Record({ r, name }: { r: StrategyReturn; name: string }) {
  const hits = r.hits ?? 0;
  return (
    <span>
      {name}: {hits}–{r.settled - hits}
      {r.counted > 0 && (
        <span className={tone(r.roi)}>
          {" "}
          {pct(r.roi)} on {r.counted}
        </span>
      )}
    </span>
  );
}

function StatusChip({ s, confirmFrom }: { s: GoldenSlice; confirmFrom: number }) {
  if (s.status === "golden")
    return (
      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: GOLD, background: "color-mix(in srgb, #C9A227 16%, transparent)" }}>
        Golden
      </span>
    );
  if (s.status === "not holding up") return <span className="rounded-full bg-loss/15 px-2 py-0.5 text-[11px] font-medium text-loss">Not holding up</span>;
  return (
    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
      Candidate · {s.slice.all.counted} of {confirmFrom}
    </span>
  );
}

function betText(s: GoldenSlice): string {
  if (!s.bet) return `Bet like the rest of ${s.strategy}: ${s.strategyLive ? "Live" : "Sim"}.`;
  const stake = s.bet.stakePct != null ? `${s.bet.stakePct}% of the balance` : s.bet.stake != null ? `£${s.bet.stake}` : `${s.strategy}'s stake`;
  return `Bet on its own: ${s.bet.live ? "Live" : "Sim"} at ${stake}.`;
}

/**
 * Golden: the parts of a strategy that may be worth more than the rest. Each is counted from the day it started being
 * watched, and its bets are part of its strategy's bets, never extra. The finder suggests new ones to watch.
 */
export default function GoldenPage() {
  const { data, isLoading, error } = useGolden();
  const act = useGoldenAction();
  const dialog = useDialog();

  const watch = async (g: GoldenSuggestion) => {
    const ok = await dialog.confirm({
      title: `Watch ${g.label.replace(/^Golden: /, "")} for ${g.strategy}?`,
      confirmLabel: "Watch it",
      body: <p>It&apos;s counted from today, on new matches only, so the matches that suggested it can&apos;t also prove it. Nothing is bet differently.</p>,
    });
    if (ok) act.mutate({ action: "watch", strategyKey: g.strategyKey, rule: g.rule });
  };
  const stop = async (s: GoldenSlice) => {
    const ok = await dialog.confirm({ title: `Stop watching ${s.label.replace(/^Golden: /, "")}?`, confirmLabel: "Stop watching", body: <p>Its record is kept in the strategy&apos;s figures; only this line goes.</p> });
    if (ok) act.mutate({ action: "unwatch", strategyKey: s.strategyKey, id: s.id });
  };

  return (
    <div className="space-y-5 px-4 py-4">
      <PageHeader
        title="Golden"
        subtitle={
          <>
            Parts of a strategy that may be worth more than the rest, such as Second Pour at 0-0. Each is counted from the day it started being watched,
            on new matches only. Its bets are <b>part of its strategy&apos;s bets</b>, not extra ones: the figures show that part against the rest of the same
            strategy. It&apos;s a <b>candidate</b> until {data?.confirmFrom ?? 50} priced picks, then <b>Golden</b> if it&apos;s making +3% or more and beating the rest.
            Live and Sim picks together.
          </>
        }
      />
      {error ? (
        <QueryError error={error} next="/more/admin/golden" />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card title="Being watched" subtitle="Bet one on its own from its strategy's card (Strategies → Cards → tap the strategy).">
            {data.slices.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing settled since the watched slices started yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.slices.map((s) => (
                  <li key={`${s.strategyKey}#${s.id}`} className="space-y-1 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{s.strategy}</span>
                      <StatusChip s={s} confirmFrom={data.confirmFrom} />
                    </div>
                    <p className="text-ink">
                      <SegmentLabel label={s.label} /> <span className="text-xs text-ink-muted">· since {day.format(new Date(s.since))}</span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      Of {s.strategy}&apos;s picks since then: <Record r={s.slice.all} name="this part" /> · <Record r={s.rest.all} name="the rest" />
                    </p>
                    <p className="text-xs text-ink-muted">
                      {betText(s)}{" "}
                      <Link href="/more/admin/strategies" className="text-accent underline">
                        Change it
                      </Link>
                      {s.custom && (
                        <button type="button" disabled={act.isPending} onClick={() => void stop(s)} className="ml-3 text-ink-muted underline">
                          Stop watching
                        </button>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Suggested by the Golden finder"
            subtitle={`Slices of a strategy that beat the rest in both the older and the newer half of its record. Some will be luck, so they're only ever watched from the day you add them. Checked every 6 hours (last ${new Date(data.suggestions.at).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}).`}
          >
            {data.suggestions.list.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing new stands out right now. You&apos;ll get a notification when it does.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.suggestions.list.map((g) => (
                  <li key={`${g.strategyKey}#${g.rule.join("+")}`} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-ink">{g.strategy}</span>
                      <span className="block">
                        <SegmentLabel label={g.label} />
                      </span>
                      <span className="block text-xs text-ink-muted">
                        <span className={tone(g.slice.roi)}>{pct(g.slice.roi)}</span> per £1 over {g.slice.n} picks ({Math.round((g.slice.hits / g.slice.n) * 100)}% won, likely{" "}
                        {pct(g.slice.low)} or better) · the rest <span className={tone(g.rest.roi)}>{pct(g.rest.roi)}</span> over {g.rest.n}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        Older half {pct(g.halves[0]?.slice)} vs {pct(g.halves[0]?.rest)} · newer half {pct(g.halves[1]?.slice)} vs {pct(g.halves[1]?.rest)}
                      </span>
                    </span>
                    <button type="button" disabled={act.isPending} onClick={() => void watch(g)} className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink">
                      Watch it
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {act.error && <p className="mt-2 text-xs text-destructive">{act.error.message}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
