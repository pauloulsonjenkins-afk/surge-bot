"use client";

import { useState } from "react";
import type { AdminStrategy, StrategyReturn } from "@/server/engine-client";
import type { SendingSettings, SendingState } from "@/queries/use-sending";
import { useLayGroupAction, useLayGroups, type LayIdea } from "@/queries/use-lay-groups";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { ModeBadge } from "@/components/ui/ModeToggle";
import { GoldenBadge } from "@/components/ui/SegmentLabel";
import type { LayGroupInfo } from "@/server/engine-client";
import { ClashSummary } from "@/components/admin/ClashSummary";
import { BetSettings, LiveSimSwitch, type SendingStrategy } from "@/components/admin/StrategyBetting";
import { gbp } from "@/lib/format";

/** The markets that are LAY bets: GoalBrew's own lay groups, and InPlayGuru's Away Win Lay. */
const LAY_MARKETS = new Set(["NEXT_GOAL_LAY", "HOME_WIN_LAY", "AWAY_WIN_LAY"]);
export const isLayRow = (r: { market: string | null }) => LAY_MARKETS.has(r.market ?? "");

const pct = (n: number | null | undefined) => (n == null ? "–" : `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`);
const tone = (n: number | null | undefined) => (n == null ? "text-ink-muted" : n >= 0 ? "text-hit" : "text-destructive");

/** One LAY strategy: what it lays and why, the risk, its record next to what it lays, and clashes. */
function LayCard({
  row,
  lays,
  why,
  custom,
  header,
  badge,
  trialFrom,
  fullFrom,
  bet,
  settings,
  bank,
  all,
}: {
  row: AdminStrategy;
  lays: string | null;
  why: string;
  custom: boolean;
  header: string | null;
  badge?: LayGroupInfo["badge"];
  trialFrom: number;
  fullFrom: number;
  bet?: SendingStrategy;
  settings?: SendingSettings;
  bank?: SendingState["bank"];
  all: AdminStrategy[];
}) {
  const names = useStrategyNames();
  const [editing, setEditing] = useState(false);
  const dialog = useDialog();
  const action = useLayGroupAction();
  const live = row.sendingOn;
  const mine: StrategyReturn | undefined = live ? row.returns?.live : row.returns?.all;
  const source = lays ? all.find((r) => r.label.toLowerCase() === lays) : undefined;
  const backed = source?.returns?.all;
  return (
    <li className="space-y-2 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            {names.name(row.label)} <ModeBadge mode={live ? "live" : "sim"} />
            {badge && (
              <GoldenBadge
                status={badge.status}
                candidate={`Candidate · ${badge.n} of ${trialFrom}`}
                trial={`Live trial suggested · ${badge.n} of ${fullFrom}`}
              />
            )}
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">{why || "InPlayGuru's own lay strategy."}</span>
          {/* Live or Sim, as on every strategy card (asks first before real money). */}
          {bet && settings && (
            <span className="mt-2 block">
              <LiveSimSwitch s={bet} settings={settings} />
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className={`block font-display text-xl font-bold tabular-nums ${tone(mine?.roi)}`}>{pct(mine?.roi)}</span>
          <span className="block text-xs text-ink-muted">
            per £1 risked · {mine?.counted ?? 0} {live ? "Live" : ""} bets
          </span>
        </span>
      </div>

      {/* Laid against backed, side by side: if what it lays starts winning, the lay should stop. */}
      {source && (
        <p className="text-xs text-ink-muted">
          Lays <span className="font-medium text-ink">{names.name(source.label)}</span>, which is <span className={tone(backed?.roi)}>{pct(backed?.roi)}</span> per £1 backed over{" "}
          {backed?.counted ?? 0} bets{backed?.roi != null && backed.roi > 0 ? <span className="text-warn"> — now winning when backed, so the lay may have had its day</span> : null}.
        </p>
      )}

      {/* The risk: lays lose big and win small, so this matters more than the hit rate. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Liability per bet</dt>
          <dd className="font-medium text-ink">{bet?.stakeNow != null ? gbp(bet.stakeNow, false) : bet?.stakePct != null ? `${bet.stakePct}%` : "–"}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Highest lay price</dt>
          <dd className={`font-medium ${bet?.maxLayOdds != null ? "text-ink" : "text-warn"}`}>{bet?.maxLayOdds != null ? bet.maxLayOdds.toFixed(2) : "None set"}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Worst losing run</dt>
          <dd className="font-medium text-ink">{mine?.longestLosingRun ?? "–"}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Worst day</dt>
          <dd className={`font-medium ${tone(mine?.worstDay?.profit)}`}>{mine?.worstDay ? gbp(mine.worstDay.profit) : "–"}</dd>
        </div>
      </dl>

      <ClashSummary strategyKey={row.label} compact />

      {/* Its liability, highest lay price and stop loss: the same settings as on every strategy card. */}
      {bet && settings && (
        <div>
          <button type="button" aria-expanded={editing} onClick={() => setEditing((v) => !v)} className="text-xs font-medium text-accent underline">
            {editing ? "Hide bet settings" : "Bet settings: liability, highest lay price, stop loss"}
          </button>
          {editing && (
            <div className="mt-2">
              <BetSettings s={bet} settings={settings} bank={bank} />
            </div>
          )}
        </div>
      )}

      {custom && header && (
        <button
          type="button"
          disabled={action.isPending}
          onClick={async () => {
            if (await dialog.confirm({ title: `Stop laying ${names.name(row.label)}?`, confirmLabel: "Stop laying", body: <p>No new LAY picks are made for it. Its picks so far, and its record, stay.</p> }))
              action.mutate({ action: "unwatch", header });
          }}
          className="text-xs font-medium text-destructive underline disabled:opacity-50"
        >
          Stop laying
        </button>
      )}
      {action.error && <p className="text-xs text-destructive">{action.error.message}</p>}
    </li>
  );
}

function IdeaRow({ idea }: { idea: LayIdea }) {
  const dialog = useDialog();
  const action = useLayGroupAction();
  const [done, setDone] = useState(false);
  const what = idea.source === "HOME_TO_WIN" ? "LAY the home side (wins on a draw or an away win)" : "LAY the next goal (wins if no more goals come)";
  const why = `${idea.strategy}${idea.rule.length > 0 ? `, ${idea.label}` : ""}: ${pct(idea.backedRoi)} per £1 backed over ${idea.n} bets.`;
  return (
    <li className="flex flex-wrap items-start justify-between gap-2">
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-ink">{idea.strategy}</span> <span className="text-ink-muted">· {idea.label}</span>
        <span className="block text-xs text-ink-muted">
          Backed <span className={tone(idea.backedRoi)}>{pct(idea.backedRoi)}</span>, laid about <span className={tone(idea.laidRoi)}>{pct(idea.laidRoi)}</span> per £1 risked over {idea.n} picks
          (older half {pct(idea.halves[0])}, newer {pct(idea.halves[1])}).
        </span>
        {action.error && <span className="block text-xs text-destructive">{action.error.message}</span>}
      </span>
      {done ? (
        <span className="shrink-0 text-xs text-hit">Laying in Sim</span>
      ) : (
        <button
          type="button"
          disabled={action.isPending}
          onClick={async () => {
            const ok = await dialog.confirm({
              title: `Lay ${idea.strategy}${idea.rule.length > 0 ? `, ${idea.label}` : ""}?`,
              confirmLabel: "Lay it in Sim",
              body: (
                <>
                  <p>
                    From now on its alerts get a LAY pick: {what}. It starts in <strong>Sim</strong> at a £2 liability, so nothing is bet until you switch it Live.
                  </p>
                  <p className="text-xs text-ink-muted">Many slices were tried to find this, so some will look good by luck: give it time in Sim first.</p>
                </>
              ),
            });
            if (!ok) return;
            action.mutate({ action: "watch", strategyKey: idea.strategyKey, source: idea.source, rule: idea.rule, why }, { onSuccess: () => setDone(true) });
          }}
          className="shrink-0 rounded-md border border-accent px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-50"
        >
          {action.isPending ? "Adding…" : "Lay it in Sim"}
        </button>
      )}
    </li>
  );
}

/**
 * Strategies → LAY: every LAY strategy with what it lays and why, its risk, its record next to what it lays, and its
 * clashes with what's Live; then the lay ideas (the Golden finder turned round), each one tap from being laid in Sim.
 */
export function LaySection({
  rows,
  all,
  betOf,
  settings,
  bank,
}: {
  rows: AdminStrategy[];
  all: AdminStrategy[];
  betOf: (label: string) => SendingStrategy | undefined;
  settings?: SendingSettings;
  bank?: SendingState["bank"];
}) {
  const lay = useLayGroups();
  const info = new Map((lay.data?.groups ?? []).map((g) => [g.key, g]));
  const sorted = [...rows].sort((a, b) => Number(b.sendingOn) - Number(a.sendingOn) || a.label.localeCompare(b.label));
  const ideas = lay.data?.ideas.list ?? [];
  const trialFrom = lay.data?.trialFrom ?? 300;
  const fullFrom = lay.data?.fullFrom ?? 500;
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-3.5 text-xs text-ink-muted">
        <p className="text-sm font-semibold text-ink">LAY bets</p>
        <p className="mt-1">
          A LAY bets <em>against</em> something: it wins a little when that doesn&apos;t happen, and loses the whole liability when it does. GoalBrew lays groups of
          alerts that kept losing when backed. A LAY is never made, and no Live bet is placed, when it would cancel out a Live bet on the same match.
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-ink-muted">No LAY strategies yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((r) => {
            const g = info.get(r.label.toLowerCase());
            return (
              <LayCard
                key={r.label}
                row={r}
                lays={g?.lays ?? null}
                why={g?.why ?? ""}
                custom={g?.custom ?? false}
                header={g?.header ?? null}
                badge={g?.badge ?? null}
                trialFrom={trialFrom}
                fullFrom={fullFrom}
                bet={betOf(r.label)}
                settings={settings}
                bank={bank}
                all={all}
              />
            );
          })}
        </ul>
      )}

      <section className="rounded-xl border border-line bg-surface p-3.5">
        <h3 className="text-sm font-semibold text-ink">Lay ideas</h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          The Golden finder turned round: strategies, or parts of them, that kept losing when backed and would have made money laid (at the back price plus about two
          ticks, after commission), in both the older and newer half of the record.
        </p>
        {lay.isLoading ? (
          <p className="mt-2 text-xs text-ink-muted">Looking…</p>
        ) : lay.error ? (
          <p className="mt-2 text-xs text-destructive">{lay.error.message}</p>
        ) : ideas.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">No new ideas right now.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {ideas.map((i) => (
              <IdeaRow key={`${i.strategyKey}#${i.rule.join("+")}`} idea={i} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
