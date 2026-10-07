"use client";

import { PageHeader, Segmented } from "@/components/ui/Card";
import { useMemo, useState } from "react";
import { useAdminStrategies, useDeleteStrategy, useIgnoreStrategy, useMergeStrategy, type AdminStrategy, type StrategyReturn } from "@/queries/use-strategies";
import { useFreshStart } from "@/queries/use-fresh-start";
import { useDeleteStrategyFlow } from "@/components/admin/useDeleteStrategyFlow";
import { marketName } from "@/lib/markets";
import { gbp } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { ModeBadge, ModeToggle, usePickMode } from "@/components/ui/ModeToggle";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { againstBreakeven, rangeText, roiText } from "@/lib/hit-rate";
import { EquityCurve } from "@/components/admin/EquityCurve";
import { strategyKey, useSaveStrategyName, useStrategyNames } from "@/queries/use-strategy-names";
import { ChevronDown } from "lucide-react";
import { BreakevenBar } from "@/components/ui/BreakevenBar";
import { StrategyName } from "@/components/ui/StrategyName";
import { ukMidnightIso } from "@/lib/uk-time";
import { useSending, type SendingSettings, type SendingState } from "@/queries/use-sending";
import { BetSettings, betSummary, LiveSimSwitch, type SendingStrategy } from "@/components/admin/StrategyBetting";
import Link from "next/link";

const lastSeen = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function record(hits: number, misses: number) {
  const settled = hits + misses;
  return { hits, misses, settled, hitRate: settled > 0 ? Math.round((hits / settled) * 1000) / 10 : null };
}

/** Live when its picks are bet with real money; Sim when they are only recorded. */
function modeOf(row: AdminStrategy): "live" | "sim" {
  // An engine that isn't updated yet doesn't send `mode`; its switch is then the best guide.
  return row.mode ?? (row.sendingOn ? "live" : "sim");
}

/** True once a strategy has a settled pick in this mode and period; the rest are tucked under "No data yet". */
function hasPicks(row: AdminStrategy, m: "live" | "sim"): boolean {
  const hits = m === "live" ? (row.liveHits ?? 0) : (row.simHits ?? 0);
  const misses = m === "live" ? (row.liveMisses ?? 0) : (row.simMisses ?? 0);
  return hits + misses > 0 || (row.returns?.[m]?.counted ?? 0) > 0;
}

/** Below this many priced picks a return is too noisy to act on. */
const SAMPLE = 50;

function roiTone(roi: number | null): string {
  return roi === null || roi === 0 ? "text-ink" : roi > 0 ? "text-hit" : "text-loss";
}

/** The money figures for the chosen mode; "all" adds live and sim together. */
function returnsFor(row: AdminStrategy, mode: "all" | "live" | "sim") {
  const r = row.returns;
  if (!r) return null;
  if (mode !== "all") return r[mode];
  if (r.all) return r.all;
  // An older engine sends no "all" figures; add the two together.
  const staked = r.live.staked + r.sim.staked;
  const profit = r.live.profit + r.sim.profit;
  return { settled: r.live.settled + r.sim.settled, counted: r.live.counted + r.sim.counted, staked, profit, roi: staked > 0 ? profit / staked : null };
}

type Period = "1D" | "7D" | "30D" | "YTD" | "ALL";

const PERIODS: { value: Period; label: string }[] = [
  { value: "1D", label: "1D" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "YTD", label: "YTD" },
  { value: "ALL", label: "All" },
];

/** Where a period starts: today since UK midnight, 7 / 30 days back (as on the Dashboard), or 1 January UK time for YTD. */
function periodStart(period: Period): string | null {
  if (period === "ALL") return null;
  if (period === "1D") return ukMidnightIso();
  if (period === "YTD") return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString(); // UK is on GMT in January
  const days = period === "7D" ? 7 : 30;
  // Whole minutes, so the request stays the same while the page is open.
  return new Date(Math.floor((Date.now() - days * 86_400_000) / 60_000) * 60_000).toISOString();
}

type SortBy = "roi" | "profit" | "hitRate";

const SORTS: { value: SortBy; label: string }[] = [
  { value: "roi", label: "Return %" },
  { value: "profit", label: "Profit £" },
  { value: "hitRate", label: "Hit rate %" },
];

/** The figure a strategy is ranked by within its Live or Sim section; null sorts last. */
function sortValue(row: AdminStrategy, m: "live" | "sim", by: SortBy): number | null {
  if (by === "hitRate") return m === "live" ? record(row.liveHits ?? 0, row.liveMisses ?? 0).hitRate : record(row.simHits ?? 0, row.simMisses ?? 0).hitRate;
  const r = row.returns?.[m];
  if (!r) return null;
  if (by === "profit") return r.staked > 0 ? r.profit : null;
  return r.roi;
}

/** A nudge once there are enough picks to go on: a Sim strategy that makes money, or a Live one that loses it. */
function verdict(row: AdminStrategy): { tone: "good" | "warn"; text: string } | null {
  const r = row.returns;
  if (!r) return null;
  if (modeOf(row) === "sim" && r.sim.counted >= SAMPLE && r.sim.roi !== null && r.sim.roi > 0) {
    return { tone: "good", text: `Profitable in Sim over ${r.sim.counted} picks: worth trying Live.` };
  }
  if (modeOf(row) === "live" && r.live.counted >= SAMPLE && r.live.roi !== null && r.live.roi < 0) {
    return { tone: "warn", text: `Losing money over ${r.live.counted} live bets: consider putting it back to Sim.` };
  }
  // A proven winner: enough bets, a clear return and a hit rate above what its odds need. Raising the stake is the
  // biggest profit lever, so say so. A nudge only; the stake itself is changed in Bet settings.
  const live = r.live as StrategyReturn;
  if (modeOf(row) === "live" && live.counted >= SAMPLE && live.roi !== null && live.roi >= 0.05) {
    const hit = record(row.liveHits ?? 0, row.liveMisses ?? 0).hitRate;
    if (hit !== null && typeof live.breakeven === "number" && hit > live.breakeven) {
      return { tone: "good", text: `Clear edge over ${live.counted} live bets: the best place to raise the stake.` };
    }
  }
  return null;
}
/**
 * What the hit rate needs beside it: the odds it was won at, the hit rate those odds need to break even after
 * commission, and the range the true hit rate is probably in, given how few picks there are.
 */
function OddsContext({ hitRate, money }: { hitRate: number | null; money: NonNullable<ReturnType<typeof returnsFor>> }) {
  const m = money as StrategyReturn;
  if (m.avgOdds === undefined) return null; // older engine
  const verdict = againstBreakeven(hitRate, m.breakeven, m.range);
  const range = rangeText(m.range);
  return (
    <p className="mt-1 text-xs text-ink-muted">
      {m.avgOdds === null ? "Odds unknown: set assumed odds on Win/Loss" : `Avg odds ${m.avgOdds.toFixed(2)} · break-even ${m.breakeven}%`}
      {range && ` · likely ${range}`}
      {verdict && <span className={verdict.tone === "hit" ? "text-hit" : verdict.tone === "loss" ? "text-loss" : ""}> · {verdict.text}</span>}
      {m.assumed ? (
        <span className="text-warn">
          {" "}
          · {m.assumed === m.counted ? "All" : `${m.assumed} of ${m.counted}`} priced at the assumed odds set on Win/Loss, not a real
          price, so treat this return as a guess
        </span>
      ) : null}
    </p>
  );
}

/**
 * What a strategy looks for and what it backs (InPlayGuru's rules, in short), and the name and description the app
 * shows for it. InPlayGuru's own name stays the key, so renaming here changes nothing about sending or results.
 */
function AboutStrategy({ label }: { label: string }) {
  const names = useStrategyNames();
  const save = useSaveStrategyName();
  const info = names.info(label);
  const [name, setName] = useState(info?.name ?? "");
  const [description, setDescription] = useState(info?.description ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== (info?.name ?? "") || description.trim() !== (info?.description ?? "");
  const submit = (n: string, d: string) =>
    save.mutate(
      { key: label, name: n, description: d },
      {
        onSuccess: (r) => {
          const now = r.names[strategyKey(label)];
          setName(now?.name ?? "");
          setDescription(now?.description ?? "");
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        },
      },
    );
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-surface-2 p-2.5 text-xs">
      {(info?.trigger || info?.bet) && (
        <dl className="space-y-1.5">
          {info?.trigger && (
            <div>
              <dt className="text-ink-muted">When it fires</dt>
              <dd className="text-ink">{info.trigger}</dd>
            </div>
          )}
          {info?.bet && (
            <div>
              <dt className="text-ink-muted">The bet</dt>
              <dd className="text-ink">{info.bet}</dd>
            </div>
          )}
          <div>
            <dt className="text-ink-muted">Original name</dt>
            <dd className="text-ink">{label}</dd>
          </div>
        </dl>
      )}
      <label className="block text-ink-muted">
        Name in the app
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={label}
          className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <label className="block text-ink-muted">
        Description
        <textarea
          value={description}
          maxLength={300}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>
      {save.error && <p className="text-destructive">{save.error.message}</p>}
      <p className="text-ink-muted">Only the name shown in the app changes. Sending, stakes and results keep using the original name.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => submit(name, description)}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          Save
        </button>
        {info?.custom && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => submit("", "")}
            className="rounded-md border border-line px-3 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            Back to the default
          </button>
        )}
        {saved && <span className="text-hit">Saved</span>}
      </div>
    </div>
  );
}

function StrategyCard({
  row,
  all,
  sortBy,
  includes,
  busy,
  selecting,
  selected,
  onToggle,
  onMerge,
  onDelete,
  bet,
  settings,
  bank,
}: {
  /** Its betting controls (from Sending); missing while they load. */
  bet: SendingStrategy | undefined;
  settings: SendingSettings | undefined;
  /** The Betfair balance percentage stakes work from. */
  bank?: SendingState["bank"];
  row: AdminStrategy;
  all: AdminStrategy[];
  sortBy: SortBy;
  /** Strategies that are reported under this one. */
  includes: string[];
  busy: boolean;
  /** Tick boxes are showing, to delete several strategies at once. */
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onMerge: (into: string | null) => void;
  onDelete: () => void;
}) {
  const [merging, setMerging] = useState(false);
  const [showCurve, setShowCurve] = useState(false);
  const [target, setTarget] = useState("");
  const pickMode = usePickMode();
  const live = record(row.liveHits ?? 0, row.liveMisses ?? 0);
  const sim = record(row.simHits ?? 0, row.simMisses ?? 0);
  // The headline figures follow the All / Live / Sim choice.
  const shown = pickMode === "live" ? live : pickMode === "sim" ? sim : record(row.hits, row.misses);
  const { hits, misses, settled, hitRate } = shown;
  const money = returnsFor(row, pickMode);
  const hint = verdict(row);
  const options = all.filter((o) => o.label !== row.label);
  const names = useStrategyNames();
  const info = names.info(row.label);
  const shownName = names.name(row.label);
  const [about, setAbout] = useState(false);
  const [open, setOpen] = useState(false);

  const ret = money as StrategyReturn | null;
  // The headline is the return on each £1 staked (what decides whether a strategy is worth betting), or the £ total
  // when sorting by it.
  const headline =
    sortBy === "profit"
      ? {
          value: money && money.staked > 0 ? gbp(money.profit) : "–",
          tone: roiTone(money && money.staked > 0 ? money.profit : null),
          sub: money && money.staked > 0 ? `${roiText(money.roi)} return` : "profit",
        }
      : {
          value: roiText(money?.roi ?? null),
          tone: roiTone(money?.roi ?? null),
          sub: money && money.staked > 0 ? `${gbp(money.profit)} on ${gbp(money.staked, false)}` : "return per £1",
        };
  // Too few priced picks to act on: the figures still show, but faded.
  const thin = (money?.counted ?? 0) < SAMPLE;

  return (
    <li className={`card-hover overflow-hidden rounded-xl border transition-colors ${open ? "card-open" : "bg-surface"} ${selected ? "border-accent" : "border-line"}`}>
      {/* The row to compare by: name, record and hit rate against break-even on the left, the headline figure on the right. */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        {selecting && (
          <input
            type="checkbox"
            checked={selected}
            disabled={row.sendingOn || busy}
            onChange={onToggle}
            aria-label={`Select ${shownName}`}
            title={row.sendingOn ? "Put this strategy back to Sim first" : undefined}
            style={{ accentColor: "var(--accent)" }}
            className="h-4 w-4 shrink-0 disabled:opacity-40"
          />
        )}
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              <span className="min-w-0 break-words">
                <StrategyName label={row.label} />
              </span>
              {!bet && <ModeBadge mode={modeOf(row)} />}
              {bet?.enabled && bet.stopLoss?.stopped && <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-medium text-warn-ink">Stopped today</span>}
            </span>
            <span className={`mt-0.5 block truncate text-xs ${row.market ? "text-ink-muted" : "text-warn"}`}>
              {[marketName(row.market) ?? "No market set", settled > 0 ? `${hits}–${misses}` : "no results yet", hitRate !== null ? `${hitRate}%` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="mt-1.5 block max-w-xs">
              <BreakevenBar hitRate={hitRate} breakeven={ret?.breakeven} range={ret?.range} />
            </span>
          </span>
          <span className={`shrink-0 text-right ${thin ? "opacity-60" : ""}`} title={thin ? `Fewer than ${SAMPLE} priced picks: too few to act on yet` : undefined}>
            <span className={`block font-display text-xl font-bold tabular-nums [font-stretch:108%] ${headline.tone}`}>{headline.value}</span>
            <span className="block text-xs text-ink-muted">{headline.sub}</span>
            {thin && money && money.counted > 0 && <span className="block text-xs text-ink-muted">{money.counted} priced</span>}
          </span>
          <ChevronDown size={16} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {bet && settings && !selecting && <LiveSimSwitch s={bet} settings={settings} />}
      </div>
      {bet && settings && (() => {
        const b = betSummary(bet, settings);
        return <p className={`-mt-1.5 px-3.5 pb-2 text-xs ${b.warn ? "text-warn" : "text-ink-muted"}`}>Bet: {b.text}</p>;
      })()}
      {hint && <p className={`-mt-1 px-3.5 pb-3 text-xs ${hint.tone === "good" ? "text-hit" : "text-warn"}`}>{hint.text}</p>}

      {open && (
        <div className="space-y-3 border-t border-line px-3.5 py-3">
          {info?.description && <p className="text-xs text-ink">{info.description}</p>}
          {bet && settings && <BetSettings s={bet} settings={settings} bank={bank} />}
          <p className="text-xs text-ink-muted">
            {pickMode === "all" && `${row.alertsSince} alert${row.alertsSince === 1 ? "" : "s"} · `}
            {settled > 0 && settled < SAMPLE ? "small sample · " : ""}last alert {lastSeen.format(new Date(row.lastAlertAt))}
          </p>
          {money && money.settled > 0 && <OddsContext hitRate={hitRate} money={money} />}
          {/* Live and simulation side by side, so a strategy's real results can be checked against what it does unbet. */}
          {(live.settled > 0 || sim.settled > 0) && (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {(["live", "sim"] as const).map((m) => {
                const rec = m === "live" ? live : sim;
                const r = row.returns?.[m] ?? null;
                return (
                  <div key={m} className="rounded-md bg-surface-2 px-2.5 py-1.5">
                    <dt className="text-ink-muted">{m === "live" ? "Live" : "Sim"}</dt>
                    <dd className="tabular-nums text-ink">
                      {rec.settled === 0 ? (
                        m === "live" ? "No bets yet" : "None"
                      ) : (
                        <>
                          <span className={roiTone(r?.roi ?? null)}>{roiText(r?.roi ?? null)}</span>
                          <span className="text-ink-muted">
                            {" "}
                            · {rec.hits}–{rec.misses} · {rec.hitRate}%{r && r.counted < rec.settled ? ` · ${r.counted} priced` : ""}
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          <div className="flex flex-wrap gap-1.5 text-xs">
            {row.mergedInto && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Counted under “{names.name(row.mergedInto)}”</span>}
            {includes.length > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">Also counts: {includes.map(names.name).join(", ")}</span>}
            {row.sent > 0 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-muted">{row.sent} sent to bet</span>}
          </div>
          {money && money.counted > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={showCurve}
                onClick={() => setShowCurve((v) => !v)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
              >
                {showCurve ? "Hide equity curve" : "Equity curve and drawdown"}
              </button>
              {showCurve && (
                <div className="mt-2">
                  <EquityCurve label={row.label} mode={pickMode} />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-expanded={about}
              onClick={() => setAbout((v) => !v)}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
            >
              {about ? "Close" : "About and rename"}
            </button>
            {row.mergedInto ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onMerge(null)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
              >
                Undo merge
              </button>
            ) : (
              options.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMerging((v) => !v)}
                  className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
                >
                  {merging ? "Cancel merge" : "Merge into another…"}
                </button>
              )
            )}
            {/* A Live strategy can't be deleted (put it back to Sim first), so the button only shows when it can be used. */}
            {!row.sendingOn && (
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-destructive hover:bg-surface-2 disabled:opacity-40"
              >
                Delete strategy
              </button>
            )}
          </div>

          {about && <AboutStrategy label={row.label} />}

          {merging && !row.mergedInto && (
            <div className="space-y-2 rounded-lg bg-surface-2 p-2.5">
              <label className="block text-xs text-ink-muted">
                Count this strategy’s alerts under
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">Choose a strategy…</option>
                  {options.map((o) => (
                    <option key={o.label} value={o.label}>
                      {names.name(o.label)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-ink-muted">
                The Dashboard and stats then treat both as one strategy, and nothing is deleted. Sending is not affected: each strategy keeps its own
                switch and stake.
              </p>
              <button
                type="button"
                disabled={busy || !target}
                onClick={() => {
                  onMerge(target);
                  setMerging(false);
                  setTarget("");
                }}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
              >
                Merge
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function StrategiesPage() {
  const [period, setPeriod] = useState<Period>("ALL");
  const since = useMemo(() => periodStart(period), [period]);
  const { data, isLoading, error, isPlaceholderData } = useAdminStrategies(since);
  const merge = useMergeStrategy();
  const remove = useDeleteStrategyFlow();
  const sending = useSending();
  const betOf = useMemo(() => {
    const map = new Map<string, SendingStrategy>();
    for (const s of sending.data?.strategies ?? []) map.set(s.label.toLowerCase(), s);
    return (label: string) => map.get(label.toLowerCase());
  }, [sending.data]);
  const ignore = useIgnoreStrategy();
  const removeMany = useDeleteStrategy();
  const dialog = useDialog();
  const { data: freshAt } = useFreshStart();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("roi");
  const strategies = useMemo(() => data?.strategies ?? [], [data]);
  const ignored = data?.ignored ?? [];

  const includesOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of strategies) {
      if (r.mergedInto) map.set(r.mergedInto.toLowerCase(), [...(map.get(r.mergedInto.toLowerCase()) ?? []), r.label]);
    }
    return map;
  }, [strategies]);

  function deleteStrategy(row: AdminStrategy) {
    void remove.run(row.label, { alerts: row.alerts, sent: row.sent });
  }

  const [bulkBusy, setBulkBusy] = useState(false);
  const busy = merge.isPending || remove.isPending || ignore.isPending || bulkBusy;
  const failed = merge.error ?? remove.error ?? ignore.error ?? removeMany.error;

  const deletable = strategies.filter((s) => !s.sendingOn);
  const toggle = (label: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  async function deleteSelected() {
    const chosen = strategies.filter((s) => picked.has(s.label) && !s.sendingOn);
    if (chosen.length === 0) return;
    const alerts = chosen.reduce((n, s) => n + s.alerts, 0);
    const sent = chosen.reduce((n, s) => n + s.sent, 0);
    const many = `${chosen.length} strateg${chosen.length === 1 ? "y" : "ies"}`;
    const ok = await dialog.confirm({
      title: `Delete ${many}?`,
      tone: "danger",
      confirmLabel: `Delete ${many}`,
      details: chosen.map((s) => ({ label: s.label, value: `${s.alerts} alert${s.alerts === 1 ? "" : "s"}` })),
      body: (
        <>
          <p>
            Their {alerts} saved alert{alerts === 1 ? "" : "s"} are deleted for good, so they disappear from the Dashboard, Live, Strategies, Trade
            Log and Win/Loss.
          </p>
          {sent > 0 && (
            <p>
              <strong>{sent} were already sent to bet.</strong> Those are kept as records but taken out of every result and figure (unless sent in
              the last 2 hours).
            </p>
          )}
          <p>If one of these names ever arrives again, it will reappear.</p>
        </>
      ),
    });
    if (!ok) return;
    const includeSent =
      sent > 0 &&
      (await dialog.confirm({
        title: `Also delete the ${sent} sent record${sent === 1 ? "" : "s"}?`,
        tone: "danger",
        confirmLabel: `Delete ${sent} sent record${sent === 1 ? "" : "s"}`,
        cancelLabel: "Keep as records",
        body: <p>Deleting them makes these strategies disappear completely from every list. Records of picks sent today are kept until tomorrow.</p>,
      }));
    setBulkBusy(true);
    setBulkMessage(null);
    let done = 0;
    let removedAlerts = 0;
    try {
      for (const s of chosen) {
        const r = await removeMany.mutateAsync({ label: s.label, ignoreFuture: false, includeSent });
        removedAlerts += r.removed;
        done++;
      }
      setBulkMessage(`${done} strateg${done === 1 ? "y" : "ies"} deleted (${removedAlerts} alert${removedAlerts === 1 ? "" : "s"}).`);
      stopSelecting();
    } catch {
      setBulkMessage(`Stopped after ${done} of ${chosen.length}. See the error above, then try again.`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function clearIgnored() {
    if (ignored.length === 0) return;
    const ok = await dialog.confirm({
      title: "Clear the ignored list?",
      confirmLabel: `Stop ignoring ${ignored.length}`,
      body: (
        <>
          <ul className="list-disc pl-5 text-ink">
            {ignored.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p>New alerts with these names would be stored again. Only do this if they will never be used.</p>
        </>
      ),
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      for (const name of ignored) await ignore.mutateAsync({ label: name, ignored: false });
    } catch {
      // the error shows above; the rest stay on the list
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Strategies"
        subtitle={
          <>
            Every strategy in one place: its results, its Live / Sim switch, and (tap it) its stake, minimum odds, stop loss, rename, merge and delete.
            Ranked by the return on each £1 staked. Betting on or off for everything, and the safety limits, are on{" "}
            <Link href="/more/admin/sending" className="text-accent underline">
              Sending
            </Link>
            .
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
        <ModeToggle />
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          Sort by
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Sort strategies by">
            {SORTS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={sortBy === o.value}
                onClick={() => setSortBy(o.value)}
                className={`rounded px-2.5 py-1 font-medium ${sortBy === o.value ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface-2"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {period !== "ALL" && (
        <p className={`text-xs text-ink-muted ${isPlaceholderData ? "animate-pulse" : ""}`}>
          {period === "YTD" ? "Since 1 January" : period === "1D" ? "Today (since midnight)" : `Last ${period === "7D" ? "7 days" : "30 days"}`} only. Figures from
          fewer than {SAMPLE} priced picks are faded and get no Live / Sim suggestion; the equity curve is always all time.
        </p>
      )}

      {data && strategies.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              disabled={bulkBusy}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              {selecting ? "Cancel" : "Select several to delete"}
            </button>
            {selecting && (
              <>
                <button
                  type="button"
                  onClick={() => setPicked(new Set(deletable.map((s) => s.label)))}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                >
                  Select all
                </button>
                {freshAt && (
                  <button
                    type="button"
                    onClick={() => setPicked(new Set(deletable.filter((s) => s.alertsSince === 0).map((s) => s.label)))}
                    className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
                  >
                    Select unused since fresh start
                  </button>
                )}
                <button type="button" onClick={() => setPicked(new Set())} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2">
                  Select none
                </button>
              </>
            )}
          </div>
          {selecting && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-2.5">
              <p className="text-xs text-ink">
                {picked.size} selected
                {strategies.some((s) => s.sendingOn) && <span className="text-ink-muted"> · Live ones can’t be picked</span>}
              </p>
              <button
                type="button"
                disabled={picked.size === 0 || bulkBusy}
                onClick={() => void deleteSelected()}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-danger-ink disabled:opacity-40"
              >
                {bulkBusy ? "Deleting…" : `Delete ${picked.size || ""} selected`.replace("  ", " ")}
              </button>
            </div>
          )}
          {bulkMessage && <p className="text-xs text-ink">{bulkMessage}</p>}
        </div>
      )}

      {error ? (
        <QueryError error={error} next="/more/admin/strategies" />
      ) : isLoading || !data ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : strategies.length === 0 && ignored.length === 0 ? (
        <p className="text-sm text-ink-muted">Strategies appear here once alerts arrive.</p>
      ) : (
        <>
          {failed && <p className="rounded-md border border-line bg-surface p-2 text-xs text-destructive">{failed.message}</p>}
          {(["live", "sim"] as const).map((m) => {
            // Best first by the chosen figure (in the section's own mode), so what to act on is at the top and bottom.
            const valueOf = (r: AdminStrategy) => sortValue(r, m, sortBy) ?? -Infinity;
            const group = strategies
              .filter((r) => modeOf(r) === m)
              .sort((a, b) => valueOf(b) - valueOf(a) || a.label.localeCompare(b.label));
            if (group.length === 0) return null;
            const renderCard = (r: AdminStrategy) => (
              <StrategyCard
                key={r.label}
                row={r}
                all={strategies}
                sortBy={sortBy}
                includes={includesOf.get(r.label.toLowerCase()) ?? []}
                busy={busy}
                selecting={selecting}
                selected={picked.has(r.label)}
                onToggle={() => toggle(r.label)}
                onMerge={(into) => merge.mutate({ from: r.label, into })}
                onDelete={() => deleteStrategy(r)}
                bet={betOf(r.label)}
                settings={sending.data?.settings}
                bank={sending.data?.bank}
              />
            );
            return (
              <section key={m} className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {m === "live" ? "Live strategies" : "Simulation strategies"}{" "}
                    <span className="text-sm font-normal text-ink-muted">· {group.length}</span>
                  </h3>
                  <p className="text-xs text-ink-muted">
                    {m === "live"
                      ? "New picks are bet with real money, at each strategy's stake."
                      : "New picks are recorded and settled as if bet, but no money is placed. Switch one to Live with its Sim / Live switch."}
                  </p>
                </div>
                <ul className="space-y-2">{group.filter((r) => hasPicks(r, m)).map(renderCard)}</ul>
                {group.some((r) => !hasPicks(r, m)) && (
                  <details className="rounded-xl border border-line bg-surface p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink">
                      No data yet <span className="font-normal text-ink-muted">· {group.filter((r) => !hasPicks(r, m)).length}</span>
                    </summary>
                    <p className="mt-1 text-xs text-ink-muted">Nothing settled in this period, so there is no return to rank.</p>
                    <ul className="mt-2 space-y-2">{group.filter((r) => !hasPicks(r, m)).map(renderCard)}</ul>
                  </details>
                )}
              </section>
            );
          })}

          {ignored.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">Ignored strategies</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">New alerts with these names are dropped on arrival, so they never come back.</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearIgnored()}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-destructive hover:bg-surface-2 disabled:opacity-50"
                >
                  Clear list
                </button>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {ignored.map((name) => (
                  <li key={name} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 break-words text-sm text-ink">{name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => ignore.mutate({ label: name, ignored: false })}
                      className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                    >
                      Stop ignoring
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
