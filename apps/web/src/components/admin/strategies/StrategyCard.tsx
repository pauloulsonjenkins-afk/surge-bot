"use client";

import { useState } from "react";
import { type AdminStrategy, type StrategyReturn } from "@/queries/use-strategies";
import { trendOf } from "@/components/admin/StrategyWeekly";
import { SegmentBetting } from "@/components/admin/SegmentBetting";
import type { WeekTally } from "@/server/engine-client";
import { marketName } from "@/lib/markets";
import { gbp } from "@/lib/format";
import { ModeBadge } from "@/components/ui/ModeToggle";
import { roiText } from "@/lib/hit-rate";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { ChevronDown } from "lucide-react";
import { BreakevenBar } from "@/components/ui/BreakevenBar";
import { StrategyName } from "@/components/ui/StrategyName";
import { type SendingSettings, type SendingState } from "@/queries/use-sending";
import { BetSettings, betSummary, LiveSimSwitch, type SendingStrategy } from "@/components/admin/StrategyBetting";
import type { StrategyAdvice } from "@/server/engine-client";
import { ADVICE_LABEL, ApplyAdvice, isGoodAdvice } from "@/components/admin/Advice";
import { Sparkline } from "@/components/ui/Sparkline";
import { EquityCurve, lastSeen, ChangeCompare, FormParagraph, record, modeOf, OWN_FROM, CheckResult, ReadyForLive, judged, PriceCheckLine, ByBetLine, SegmentLines, SAMPLE, roiTone, returnsFor, SortBy, shortDay, adjustedRoi, OddsContext, AboutStrategy, LiveSimToday } from "@/components/admin/strategies/strategy-parts";

export function StrategyCard({
  row,
  mode: pickMode,
  ownView = false,
  borrowed = false,
  last7,
  prev28,
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
  check,
  advice,
}: {
  /** Its kick-off price check result (pre-match strategies), for the Ready for Live checklist. */
  check?: CheckResult;
  /** Today's suggestion for it (Live / Sim or the stake ladder), if any: the one place those rules live. */
  advice?: StrategyAdvice;
  /** Its betting controls (from Sending); missing while they load. */
  bet: SendingStrategy | undefined;
  settings: SendingSettings | undefined;
  /** The Betfair balance percentage stakes work from. */
  bank?: SendingState["bank"];
  row: AdminStrategy;
  /** Whose figures the card shows: its own mode, or the one chosen at the top of the page. */
  mode: "all" | "live" | "sim";
  /** True when `mode` is "Own mode" auto-following the strategy's current switch, not an explicit Live/Sim/All pick: the headline then counts from when that switch was last flipped, not that mode's whole history (see `row.sinceMode`). */
  ownView?: boolean;
  /** Own mode is showing the other mode's record, because its current mode has too few priced picks yet. */
  borrowed?: boolean;
  /** Its last 7 days and the 28 before, in the card's mode (Strategies → Weekly data), for the collapsed card. */
  last7?: WeekTally;
  prev28?: WeekTally;
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
  const live = record(row.liveHits ?? 0, row.liveMisses ?? 0);
  const sim = record(row.simHits ?? 0, row.simMisses ?? 0);
  /**
   * Own mode (not an explicit Live/Sim/All pick, and not borrowing the other mode for want of data): counted from
   * when this mode was last switched on, not its whole history. Reported 27 Oct 2026 - switching a strategy to Sim
   * immediately showed its big, mostly pre-switch Sim record as if it were evidence the switch had already paid off.
   * Null (falls back to the whole-history figure below) for a strategy whose switch predates this, or that's never
   * been flipped since.
   */
  const sinceSwitch = ownView && !borrowed && pickMode !== "all" ? (row.sinceMode ?? null) : null;
  // The headline figures follow the All / Live / Sim choice, or since-switch when that applies.
  const shown = sinceSwitch ? record(sinceSwitch.hits ?? 0, sinceSwitch.settled - (sinceSwitch.hits ?? 0)) : pickMode === "live" ? live : pickMode === "sim" ? sim : record(row.hits, row.misses);
  const { hits, misses, settled, hitRate } = shown;
  const money = sinceSwitch ?? returnsFor(row, pickMode);
  // The rule change's "before" figures in the same mode (the headline counts from the change). Not shown alongside
  // since-switch figures: that "before" is about a rule change, a different event from the mode switch.
  const beforeAll = row.returns?.before;
  const before = sinceSwitch ? null : beforeAll ? (pickMode === "all" ? (beforeAll.all ?? null) : beforeAll[pickMode]) : null;
  const good = advice ? isGoodAdvice(advice) : false;
  const options = all.filter((o) => o.label !== row.label);
  const names = useStrategyNames();
  const info = names.info(row.label);
  const shownName = names.name(row.label);
  const [about, setAbout] = useState(false);
  const [open, setOpen] = useState(false);

  const ret = money as StrategyReturn | null;
  const judge = judged(ret, hitRate, settled);
  // The headline is the return on each £1 staked (what decides whether a strategy is worth betting), or the £ total
  // when sorting by it.
  const adj = money ? adjustedRoi(money.roi, money.counted) : null;
  /**
   * The headline can show Live or Sim (Own mode) or either chosen explicitly: whichever it is, the OTHER one is a
   * different pool of money that can easily disagree (a bad recent Live spell with a long, better Sim record, or the
   * reverse). Shown alongside whenever it has a real sample and points the other way, so the big colour is never read
   * as "the verdict" on its own — the fix for the "mixed messages" confusion reported 27 Oct 2026.
   */
  const other = pickMode === "live" ? "sim" : pickMode === "sim" ? "live" : null;
  const otherMoney = other ? row.returns?.[other] : null;
  const otherNote =
    otherMoney && otherMoney.counted >= SAMPLE && otherMoney.roi !== null && money && money.roi !== null && (otherMoney.roi > 0) !== (money.roi > 0)
      ? `${other === "live" ? "Live" : "Sim"} ${roiText(otherMoney.roi)} (${otherMoney.counted})`
      : null;
  const sinceDay = sinceSwitch && row.modeSince ? shortDay.format(new Date(row.modeSince)) : null;
  const sinceTag = sinceDay ? ` since ${sinceDay}` : "";
  const headline =
    sortBy === "adjusted"
      ? {
          value: roiText(adj),
          tone: roiTone(adj),
          sub: money && money.staked > 0 ? `adjusted · ${roiText(money.roi)} on ${money.counted} priced${sinceTag}` : `adjusted return per £1${sinceTag || " (too few picks since)"}`,
        }
      : sortBy === "profit"
      ? {
          value: money && money.staked > 0 ? gbp(money.profit) : "–",
          tone: roiTone(money && money.staked > 0 ? money.profit : null),
          sub: money && money.staked > 0 ? `${roiText(money.roi)} return${sinceTag}` : `profit${sinceTag || " (too few picks since)"}`,
        }
      : {
          value: roiText(money?.roi ?? null),
          tone: roiTone(money?.roi ?? null),
          sub: money && money.staked > 0 ? `${gbp(money.profit)} on ${gbp(money.staked, false)}${sinceTag}` : `return per £1${sinceTag || (sinceSwitch ? " (too few picks since)" : "")}`,
        };
  // Too few priced picks to act on: the figures still show, but faded.
  const thin = (money?.counted ?? 0) < SAMPLE;

  return (
    <li
      className={`card-hover overflow-hidden rounded-xl border transition-colors ${open ? "card-open" : "bg-surface"} ${selected ? "border-accent" : "border-line"} ${advice ? (good ? "ring-2 ring-hit/70" : "ring-2 ring-warn/70") : ""}`}
    >
      {/* The row to compare by: name, record and hit rate against break-even on the left, the headline figure on the right. */}
      {/* Wraps on a narrow screen: the Live / Sim switch drops to its own line instead of squeezing the name to one letter wide. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
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
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-[1_1_100%] flex-wrap items-center gap-x-3 gap-y-1 text-left sm:flex-1">
          <span className="min-w-[9rem] flex-1">
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
            {last7 && (
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                Last 7 days:{" "}
                <span className={last7.counted > 0 ? roiTone(last7.profit) : ""}>{last7.counted > 0 ? gbp(last7.profit) : "–"}</span> · {last7.picks} bet
                {last7.picks === 1 ? "" : "s"}
                {prev28 && (() => {
                  const t = trendOf(last7, prev28);
                  return <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${t.cls}`}>{t.label}</span>;
                })()}
              </span>
            )}
            <LiveSimToday row={row} />
            {borrowed && (
              <span className="mt-1 block text-xs text-warn">
                Showing its {pickMode === "live" ? "Live" : "Sim"} record: it&apos;s now in {modeOf(row) === "live" ? "Live" : "Sim"}, with fewer than {OWN_FROM} priced picks there yet.
              </span>
            )}
          </span>
          {row.spark && row.spark.length >= 5 && (
            <span className="block shrink-0" title={`Running profit over its last ${row.spark.length} bets (Live and Sim): ${gbp(row.spark[row.spark.length - 1]!)}`}>
              <Sparkline values={row.spark} />
            </span>
          )}
          <span className={`shrink-0 text-right ${thin ? "opacity-60" : ""}`} title={thin ? `Fewer than ${SAMPLE} priced picks: too few to act on yet` : undefined}>
            <span className={`block font-display text-xl font-bold tabular-nums [font-stretch:108%] ${headline.tone}`}>{headline.value}</span>
            <span className="block text-xs text-ink-muted">{headline.sub}</span>
            {otherNote && (
              <span className="block text-xs text-warn" title="A different pool of money, over a different time span: this isn't the same figure the big one above is.">
                but {otherNote}
              </span>
            )}
            {thin && sortBy !== "adjusted" && money && money.counted > 0 && <span className="block text-xs text-ink-muted">{money.counted} priced</span>}
          </span>
          <ChevronDown size={16} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {bet && settings && !selecting && (
          <span className="ml-auto shrink-0">
            <LiveSimSwitch s={bet} settings={settings} />
          </span>
        )}
      </div>
      {/* A suggestion for this strategy (the same as at the top of the page and on Today), with its own Apply. */}
      {advice && (
        <div className={`mx-3.5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${good ? "border-hit/40 bg-hit/10" : "border-warn/40 bg-warn/10"}`}>
          <span className="min-w-0 flex-1 text-xs">
            <span className={`font-semibold ${good ? "text-hit" : "text-warn"}`}>Suggested: {ADVICE_LABEL[advice.kind]}</span>
            <span className="block text-ink-muted">{advice.reason}</span>
          </span>
          <ApplyAdvice a={advice} name={shownName} />
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-line px-3.5 py-3">
          {bet && settings && (() => {
            const b = betSummary(bet, settings);
            return <p className={`text-xs ${b.warn ? "text-warn" : "text-ink-muted"}`}>Bet: {b.text}</p>;
          })()}
          <SegmentLines row={row} mode={pickMode} />
          {info?.description && <p className="text-xs text-ink">{info.description}</p>}
          {/* The detail behind the headline: hit rate against break-even, and the slices being watched. */}
          <div className="space-y-1">
            <span className="block max-w-xs">
              <BreakevenBar hitRate={judge.hitRate} breakeven={judge.breakeven} range={judge.range} settled={judge.settled} noun="priced pick" since={row.recordFrom ? `since ${shortDay.format(new Date(row.recordFrom))}` : undefined} />
            </span>
            {check && check.picks > 0 && <PriceCheckLine check={check} />}
            {before && before.counted > 0 && (
              <span className="block text-xs text-ink-muted">
                Before {shortDay.format(new Date(row.recordFrom!))}: {roiText(before.roi)} on {before.counted}
              </span>
            )}
            <ByBetLine row={row} mode={pickMode} />
            {row.returns?.byHand && row.returns.byHand.settled > 0 && (
              <span className="mt-1 block text-xs text-ink-muted" title="Sim picks you bet for real from the Live tab. They stay in this strategy's Sim record and are left out of its Live record (the stake ladder and back-to-Sim judge that), so your own picking doesn't skew it.">
                Bet by hand: {row.returns.byHand.settled} · won {row.returns.byHand.hits ?? 0}–{row.returns.byHand.settled - (row.returns.byHand.hits ?? 0)}
                {row.returns.byHand.staked > 0 && <span className={roiTone(row.returns.byHand.profit)}> · {gbp(row.returns.byHand.profit)}</span>}
              </span>
            )}
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="mb-1 text-xs font-medium text-ink-muted">Recent form: last 20 picks</p>
            <FormParagraph row={row} kind="recent" />
            <p className="mb-1 mt-2 text-xs font-medium text-ink-muted">Last 7 days</p>
            <FormParagraph row={row} kind="week" />
          </div>
          {modeOf(row) === "sim" && (
            <ReadyForLive row={row} check={check} hasStop={!!bet?.stopLoss && (bet.stopLoss.dailyLoss !== null || bet.stopLoss.lossRun !== null)} />
          )}
          {bet && settings && <BetSettings s={bet} settings={settings} bank={bank} />}
          {settings && (row.returns?.segments ?? []).map((s) => (
            <SegmentBetting key={s.id} strategyKey={row.label.toLowerCase()} strategyName={names.name(row.label)} segment={s} settings={settings} strategyLive={modeOf(row) === "live"} />
          ))}
          <p className="text-xs text-ink-muted">
            {pickMode === "all" && `${row.alertsSince} alert${row.alertsSince === 1 ? "" : "s"} · `}
            {settled > 0 && settled < SAMPLE ? "small sample · " : ""}last alert {lastSeen.format(new Date(row.lastAlertAt))}
          </p>
          {row.form?.change && <ChangeCompare c={row.form.change} />}
          {row.recordFrom && (
            <p className="text-xs text-warn">
              Its rules changed on {lastSeen.format(new Date(row.recordFrom))}, so its record, money and warnings count only alerts from then. The figures
              from before the change are shown as &quot;Before&quot;.
            </p>
          )}
          {money && money.settled > 0 && <OddsContext hitRate={hitRate} settled={settled} money={money} />}
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
              {about ? "Close" : "About and members' name"}
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
                The Dashboard and stats then treat both as one strategy, and nothing is deleted. Betting is not affected: each strategy keeps its own
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

