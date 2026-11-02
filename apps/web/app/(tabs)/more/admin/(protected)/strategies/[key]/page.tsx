"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useAdminStrategies, useMergeStrategy, useStrategyWeeks } from "@/queries/use-strategies";
import { useSetArchive } from "@/queries/use-archive";
import { useSending } from "@/queries/use-sending";
import { usePriceCheck } from "@/queries/use-price-check";
import { useToday } from "@/queries/use-today";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { useDeleteStrategyFlow } from "@/components/admin/useDeleteStrategyFlow";
import { AdviceRow, adviceTitle } from "@/components/admin/Advice";
import { trendOf } from "@/components/admin/StrategyWeekly";
import { StrategyCard } from "@/components/admin/strategies/StrategyCard";
import { SAMPLE, adjustedRoi, ownMode, returnsFor, roiTone, type CheckResult } from "@/components/admin/strategies/strategy-parts";
import { roiText } from "@/lib/hit-rate";
import { units as formatUnits } from "@/lib/format";

function Tile({ label, value, sub, tone = "text-ink" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-medium tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/**
 * One strategy's own page (2 Nov 2026 redesign): the numbers that matter first, what the system suggests for it, then its
 * full card (curve, stake, limits, slices) already open. Archiving is here too.
 */
export default function StrategyPage() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(params.key ?? "").toLowerCase();
  const { data, isLoading, error } = useAdminStrategies(null);
  const weeks = useStrategyWeeks();
  const sending = useSending();
  const today = useToday();
  const names = useStrategyNames();
  const priceCheck = usePriceCheck(30, true);
  const merge = useMergeStrategy();
  const remove = useDeleteStrategyFlow();
  const archive = useSetArchive();
  const dialog = useDialog();

  const row = data?.strategies.find((r) => r.label.toLowerCase() === key);
  const check = useMemo<CheckResult | undefined>(() => {
    const r = priceCheck.data?.rows.find((x) => x.strategy.toLowerCase() === key && x.kind === "ko");
    return r ? { picks: r.picks, vsTypical: r.edge, kickOff: true } : undefined;
  }, [priceCheck.data, key]);

  if (error) return <QueryError error={error} next={`/more/admin/strategies/${encodeURIComponent(key)}`} />;
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  if (!row) {
    return (
      <div className="space-y-3">
        <Link href="/more/admin/strategies" className="inline-flex items-center gap-1 text-sm text-ink-muted">
          <ChevronLeft size={16} aria-hidden /> Strategies
        </Link>
        <p className="text-sm text-ink">No strategy called &ldquo;{key}&rdquo;. It may be archived: see the Archive page.</p>
      </div>
    );
  }

  const mode = ownMode(row).mode;
  const money = returnsFor(row, mode);
  const other = mode === "live" ? "sim" : "live";
  const otherMoney = row.returns?.[other] ?? null;
  const w = weeks.data?.strategies[key];
  const last7 = w?.last7[mode];
  const prev28 = w?.prev28[mode];
  const trend = last7 && prev28 ? trendOf(last7, prev28) : null;
  const adj = money ? adjustedRoi(money.roi, money.counted) : null;
  const advice = (today.data?.advice ?? []).filter((a) => a.key.toLowerCase() === key);
  const bet = sending.data?.strategies.find((s) => s.label.toLowerCase() === key);

  async function archiveIt() {
    const ok = await dialog.confirm({
      title: `Archive ${names.name(row!.label)}?`,
      confirmLabel: "Archive",
      body: <p>It disappears from the lists and goes back to Sim if it is Live. Its bets still count in every total. You can restore it from the Archive page.</p>,
    });
    if (ok) archive.mutate({ label: row!.label, archived: true, note: "Archived from its page." });
  }

  return (
    <div className="space-y-4">
      <Link href="/more/admin/strategies" className="inline-flex min-h-11 items-center gap-1 text-sm text-ink-muted">
        <ChevronLeft size={16} aria-hidden /> Strategies
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-ink">{names.name(row.label)}</h2>
          <p className="text-sm text-ink-muted">
            {mode === "live" ? "Live: real money" : "Sim: recorded as if bet"}
            {trend && trend.label !== "Too few bets" && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${trend.cls}`}>{trend.label}</span>}
          </p>
        </div>
        <button type="button" onClick={() => void archiveIt()} disabled={archive.isPending} className="shrink-0 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink">
          Archive
        </button>
      </div>
      {archive.isSuccess && <p className="text-sm text-ink">Archived. It is now on the Archive page.</p>}
      {archive.error && <p className="text-sm text-destructive">{archive.error.message}</p>}

      <div className="grid grid-cols-2 gap-2">
        <Tile label={mode === "live" ? "Live, per £1" : "Sim, per £1"} value={money && money.counted > 0 ? roiText(money.roi) : "–"} tone={roiTone(money?.roi ?? null)} sub={`${money?.counted ?? 0} bets${(money?.counted ?? 0) < SAMPLE ? " · too few to be sure" : adj !== null ? ` · ${roiText(adj)} adjusted` : ""}`} />
        <Tile label="Last 7 days" value={last7 && last7.counted > 0 ? formatUnits(last7.units ?? 0) : "–"} tone={roiTone(last7?.units ?? null)} sub={`${last7?.counted ?? 0} bets`} />
        <Tile label="The 4 weeks before" value={prev28 && prev28.counted > 0 ? formatUnits(prev28.units ?? 0) : "–"} tone={roiTone(prev28?.units ?? null)} sub={`${prev28?.counted ?? 0} bets`} />
        <Tile label={other === "live" ? "Live, per £1" : "Sim, per £1"} value={otherMoney && otherMoney.counted > 0 ? roiText(otherMoney.roi) : "–"} tone={roiTone(otherMoney?.roi ?? null)} sub={`${otherMoney?.counted ?? 0} bets · the other side, for comparison`} />
      </div>

      {advice.length > 0 && (
        <section className="rounded-xl border-2 border-accent bg-accent/5 p-3.5">
          <h3 className="text-sm font-semibold text-ink">Suggested for this strategy</h3>
          <ul className="mt-2 space-y-3 text-sm">
            {advice.map((a) => (
              <AdviceRow key={`${a.kind}:${a.league?.key ?? ""}:${a.name ?? ""}`} a={a} name={adviceTitle(a, names.name)} link={false} />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-base font-semibold text-ink">Settings and full detail</h3>
        <ul>
          <StrategyCard
            row={row}
            mode={mode}
            ownView
            all={data.strategies}
            sortBy="adjusted"
            includes={[]}
            busy={merge.isPending || remove.isPending}
            selecting={false}
            selected={false}
            onToggle={() => {}}
            onMerge={(into) => merge.mutate({ from: row.label, into })}
            onDelete={() => void remove.run(row.label, { alerts: row.alerts, sent: row.sent })}
            bet={bet}
            settings={sending.data?.settings}
            bank={sending.data?.bank}
            check={check}
            advice={advice.find((a) => !a.kind.startsWith("slice") && a.kind !== "league-block")}
            last7={last7}
            prev28={prev28}
            defaultOpen
          />
        </ul>
      </section>
    </div>
  );
}
